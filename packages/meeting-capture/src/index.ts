import { readFile, realpath, stat } from 'node:fs/promises'
import { join, isAbsolute, relative, sep } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import { sessionWorkspaceDirectory } from '@ri0n72y/dsh-meeting-context'
import type {} from '@ri0n72y/dsh-meeting-speaker'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionCaptureRegistry } from './lifecycle.js'
import { ContinuousCapture, type CaptureReceipt, type CaptureOptions } from './continuous.js'
import { decodeWav, SAMPLE_RATE } from './wav.js'
import { audioCheckpoint, saveAudioWindow } from './audio-files.js'

export { ContinuousCapture } from './continuous.js'
export type { CapturedLine, CaptureReceipt, CapturePorts, SpeakerTurn, CaptureOptions } from './continuous.js'
export { decodeWav, encodeWav, SAMPLE_RATE } from './wav.js'
export { audioCheckpoint, saveAudioWindow } from './audio-files.js'

declare module '@deepseek-ai/cordis' {
  interface Context { meetingCapture: MeetingCapture }
}
export default class MeetingCapture extends Service {
  static inject = ['meetingContext', 'speechToText', 'tools', 'sessions']
  private readonly active = new SessionCaptureRegistry()
  private readonly starting = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'meetingCapture')
    ctx.on('session/disposed', (session) => {
      void this.active.cancel(session.header.id, new Error('DSH Session disposed'))
        .catch(error => ctx.logger('meeting-capture').warn('Session cleanup: ' + String(error)))
    })
    ctx.effect(() => () => this.active.cancelAll(new Error('Meeting capture plugin unloaded')),
      'meeting-capture: drain on unload')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'meeting_capture_file',
      description: 'Transcribe an existing canonical 16 kHz mono PCM16 WAV within the current DSH Session workspace using official local SenseVoice.',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('Meeting capture requires a DSH Session')
        if (!isAbsolute(args.path)) throw new Error('Provide an absolute WAV path')
        const id = exec.agent.session.header.id
        const cwd = sessionWorkspaceDirectory(exec.agent.session.header.cwd)
        const [root, audioPath] = await Promise.all([realpath(cwd), realpath(args.path)])
        const within = relative(root, audioPath)
        if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) {
          throw new Error('Recording must be inside this Session workspace')
        }
        if ((await stat(audioPath)).size > 32 * 1024 * 1024) throw new Error('Demo audio exceeds 32 MiB')
        const bytes = await readFile(audioPath, { signal: exec.signal })
        const samples = decodeWav(bytes)
        const capture = await this.start(id, { signal: exec.signal })
        try {
          for (let at = 0; at < samples.length; at += SAMPLE_RATE) {
            exec.signal.throwIfAborted()
            await capture.push(samples.subarray(at, at + SAMPLE_RATE))
          }
          const result = await this.stop(id)
          exec.signal.throwIfAborted()
          return JSON.stringify(result, null, 2)
        } finally {
          if (this.active.get(id) === capture) {
            capture.cancel(new Error('Meeting file capture interrupted'))
            await this.stop(id)
          }
        }
      },
    })), 'meeting-capture: file proof tool')
  }

  async start(sessionId: string, options: Pick<CaptureOptions, 'signal'> = {}): Promise<ContinuousCapture> {
    if (this.active.has(sessionId) || this.starting.has(sessionId)) {
      throw new Error('Session capture already active or starting')
    }
    this.starting.add(sessionId)
    try {
      options.signal?.throwIfAborted()
      const speech = this.ctx.speechToText
      const provider = speech.snapshot().providers.find(p => p.id === 'sensevoice-local')
      if (!provider || provider.location !== 'host-local') throw new Error('Local SenseVoice is not registered')
      const owner = this.ctx.sessions.get(sessionId as SessionId)
      if (!owner) throw new Error('Meeting requires a live DSH Session')
      const store = this.ctx.meetingContext.storeFor(sessionId)
      const dir = await store.prepareAudio(sessionId)
      const checkpoint = await audioCheckpoint(dir)
      const previous = await store.read(sessionId)
      if (previous?.phase === 'stopped') throw new Error('Meeting already stopped; create a new DSH Session')
      options.signal?.throwIfAborted()
      // Resume preserves all transcript lines and the cumulative audio timeline.
      if (previous) await store.resume(sessionId)
      else await store.begin(sessionId)
      if (this.ctx.sessions.get(sessionId as SessionId) !== owner) {
        await store.interrupt(sessionId, 'Session disposed during capture start')
        throw new Error('Session disposed during capture start')
      }
      const speaker = this.ctx.get('meetingSpeaker')
      if (previous && speaker) {
        const ids = previous.segments.flatMap(line =>
          [line.speakerId, ...(line.turns ?? []).map(turn => turn.speakerId)])
        const highest = Math.max(0, ...ids.map(id => id ? Number(id.slice('Speaker '.length)) || 0 : 0))
        speaker.seed(sessionId, highest + 1)
      }
      let index = checkpoint.nextIndex
      const capture = new ContinuousCapture({
        persist: async (wav, _startMs, _endMs, signal) => {
          // The workspace may be reconfigured between windows; recheck before writes.
          await store.prepareAudio(sessionId)
          await saveAudioWindow(dir, index, wav, signal)
          index++
        },
        process: async (wav, samples, startMs, endMs, signal) => {
          signal.throwIfAborted()
          const spec = speech.resolve({ audio: wav, providerId: 'sensevoice-local' as SpeechProviderId, language: 'auto' })
          const result = await speech.transcribe(spec, signal)
          signal.throwIfAborted()
          if (!result.text.trim()) return null
          let speakerId: string | null = null
          let turns: { startMs: number; endMs: number; speakerId: string | null }[] = []
          try {
            const service = this.ctx.get('meetingSpeaker')
            turns = service?.diarize(sessionId, samples) ?? []
            const unique = [...new Set(turns.map(turn => turn.speakerId).filter((id): id is string => id !== null))]
            speakerId = unique.length === 1 ? unique[0]! : unique.length > 1 ? null
              : service?.identify(sessionId, samples) ?? null
            turns = turns.map(turn => ({ ...turn, startMs: turn.startMs + startMs, endMs: turn.endMs + startMs }))
          } catch (error) { this.ctx.logger('meeting-capture').warn('Speaker identification failed: ' + String(error)) }
          signal.throwIfAborted()
          const line = { startMs, endMs, text: result.text, speakerId, ...(turns.length ? { turns } : {}) }
          await store.append(sessionId, line)
          return line
        },
      }, { offsetSamples: checkpoint.offsetSamples, signal: options.signal })
      if (this.ctx.sessions.get(sessionId as SessionId) !== owner) {
        capture.cancel(new Error('Session disposed during capture start'))
        await store.interrupt(sessionId, 'Session disposed during capture start')
        throw new Error('Session disposed during capture start')
      }
      this.active.add(sessionId, {
        capture,
        async settle(receipt) {
          if (receipt.interrupted) await store.interrupt(sessionId, receipt.errors.at(-1) ?? 'Capture cancelled or interrupted')
          else await store.finish(sessionId)
        },
        release: () => this.ctx.get('meetingSpeaker')?.forget(sessionId),
      })
      return capture
    } finally { this.starting.delete(sessionId) }
  }
  /** Await each push for durable audio ingestion and built-in ASR backpressure. */
  push(sessionId: string, samples: Float32Array): Promise<void> {
    const capture = this.active.get(sessionId)
    if (!capture) return Promise.reject(new Error('Session capture is not active'))
    return capture.push(samples)
  }
  stop(sessionId: string): Promise<CaptureReceipt> {
    return this.active.stop(sessionId)
  }
}
