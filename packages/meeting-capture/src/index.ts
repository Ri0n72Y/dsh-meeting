import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@ri0n72y/dsh-meeting-context'
import type {} from '@ri0n72y/dsh-meeting-speaker'
import { ContinuousCapture, type CaptureReceipt } from './continuous.js'
import { decodeWav, SAMPLE_RATE } from './wav.js'

export { ContinuousCapture } from './continuous.js'
export type { CapturedLine, CaptureReceipt, CapturePorts, SpeakerTurn } from './continuous.js'
export { decodeWav, encodeWav, SAMPLE_RATE } from './wav.js'

declare module '@deepseek-ai/cordis' {
  interface Context { meetingCapture: MeetingCapture }
}
export default class MeetingCapture extends Service {
  static inject = ['meetingContext', 'speechToText', 'tools']
  private readonly active = new Map<string, ContinuousCapture>()
  constructor(ctx: Context) {
    super(ctx, 'meetingCapture')
    ctx.tools.register(defineTool({
      name: 'meeting_capture_file',
      description: 'Transcribe an existing canonical 16 kHz mono PCM16 WAV file into this DSH Session meeting using the official local SenseVoice provider.',
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('Meeting capture requires a DSH Session')
        if (!isAbsolute(args.path)) throw new Error('Provide an absolute WAV path')
        const bytes = await readFile(args.path)
        if (bytes.length > 32 * 1024 * 1024) throw new Error('Demo audio exceeds 32 MiB')
        const samples = decodeWav(bytes)
        const capture = await this.start(exec.agent.id)
        for (let at = 0; at < samples.length; at += SAMPLE_RATE) capture.push(samples.subarray(at, at + SAMPLE_RATE))
        const receipt = await this.stop(exec.agent.id)
        return JSON.stringify(receipt, null, 2)
      },
    }))
  }
  async start(sessionId: string): Promise<ContinuousCapture> {
    if (this.active.has(sessionId)) throw new Error('Session capture already active')
    const speech = this.ctx.speechToText
    const provider = speech.snapshot().providers.find(p => p.id === 'sensevoice-local')
    if (!provider || provider.location !== 'host-local') throw new Error('Local SenseVoice is not registered')
    await this.ctx.meetingContext.store.begin(sessionId)
    let segment = 0
    const dir = dshHomePath('meeting', 'sessions', sessionId, 'audio')
    const capture = new ContinuousCapture({
      persist: async wav => {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, String(segment++).padStart(6, '0') + '.wav'), wav, { flag: 'wx' })
      },
      process: async (wav, samples, startMs, endMs) => {
        const spec = speech.resolve({ audio: wav, providerId: 'sensevoice-local' as SpeechProviderId, language: 'auto' })
        const result = await speech.transcribe(spec, new AbortController().signal)
        if (!result.text.trim()) return null
        let speakerId: string | null = null
        let turns: { startMs: number; endMs: number; speakerId: string | null }[] = []
        try {
          const speaker = this.ctx.get('meetingSpeaker')
          turns = speaker?.diarize(sessionId, samples) ?? []
          const unique = [...new Set(turns.map(turn => turn.speakerId).filter((id): id is string => id !== null))]
          speakerId = unique.length === 1 ? unique[0]! : unique.length > 1 ? null
            : speaker?.identify(sessionId, samples) ?? null
          turns = turns.map(turn => ({ ...turn, startMs: turn.startMs + startMs, endMs: turn.endMs + startMs }))
        } catch (error) { this.ctx.logger('meeting-capture').warn('Speaker identification failed: ' + String(error)) }
        const line = { startMs, endMs, text: result.text, speakerId, ...(turns.length ? { turns } : {}) }
        await this.ctx.meetingContext.store.append(sessionId, line)
        return line
      },
    })
    this.active.set(sessionId, capture)
    return capture
  }
  push(sessionId: string, samples: Float32Array): void {
    const capture = this.active.get(sessionId)
    if (!capture) throw new Error('Session capture is not active')
    capture.push(samples)
  }
  async stop(sessionId: string): Promise<CaptureReceipt> {
    const capture = this.active.get(sessionId)
    if (!capture) throw new Error('Session capture is not active')
    try {
      const receipt = await capture.stop()
      await this.ctx.meetingContext.store.finish(sessionId)
      return receipt
    } finally { this.active.delete(sessionId); this.ctx.get('meetingSpeaker')?.forget(sessionId) }
  }
}
