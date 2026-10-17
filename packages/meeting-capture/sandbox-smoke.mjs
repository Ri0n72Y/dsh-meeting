/**
 * GitHub Actions sandbox: real Cordis/DSH services + all Meeting plugins,
 * with ONLY the actual speech model replaced by a deterministic fixture.
 * No microphone, API keys, network transcription or model downloads.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import MeetingContext from '@ri0n72y/dsh-meeting-context'
import MeetingSpeaker from '@ri0n72y/dsh-meeting-speaker'
import MeetingCapture, { encodeWav, decodeWav, SAMPLE_RATE } from './dist/index.js'

const workspace = await mkdtemp(join(tmpdir(), 'dsh-meeting-online-sandbox-'))
const ctx = new Context()
let recognized = 0
try {
  // The real ToolRuntime requires a system-prompt registry only to accept its
  // contribution. No agent/model prompt is run in this sandbox.
  ctx.provide('systemPrompt', { tools() { return () => {} } })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SpeechToText, { defaultProvider: 'sensevoice-local', language: 'auto' })
  await ctx.plugin(MeetingContext)
  await ctx.plugin(MeetingSpeaker, { modelPath: '', segmentationModelPath: '', threshold: 0.6 })
  await ctx.plugin(MeetingCapture)
  assert.ok(ctx.meetingContext, 'Meeting Context mounted')
  assert.ok(ctx.meetingCapture, 'Meeting Capture mounted')
  assert.ok(ctx.meetingSpeaker, 'Meeting Speaker mounted')
  assert.ok(ctx.tools.get('meeting_status'), 'meeting_status tool registered')
  assert.ok(ctx.tools.get('meeting_capture_file'), 'meeting_capture_file tool registered')

  ctx.speechToText.register({
    info: { id: 'sensevoice-local', name: 'Sandbox deterministic recognizer',
      location: 'host-local', languages: ['auto'] },
    async transcribe({ audio }, signal) {
      signal.throwIfAborted()
      assert.ok(decodeWav(audio).length > 0, 'Speech service receives real WAV bytes')
      recognized++
      return { text: 'Sandbox recognized speech ' + recognized,
        audioSeconds: decodeWav(audio).length / SAMPLE_RATE, inferenceSeconds: 0 }
    },
  })

  const live = ctx.sessions.create('sandbox-host-session', { meta: { cwd: workspace } })
  const capture = await ctx.meetingCapture.start(live.header.id)
  await capture.push(new Float32Array(SAMPLE_RATE * 5).fill(0.2))
  await capture.push(new Float32Array(SAMPLE_RATE))
  const receipt = await ctx.meetingCapture.stop(live.header.id)
  assert.equal(receipt.captured, 2)
  assert.equal(receipt.processed, 1)
  assert.equal(receipt.silent, 1)
  const store = ctx.meetingContext.storeFor(live.header.id)
  const state = await store.read(live.header.id)
  assert.equal(state?.phase, 'stopped')
  assert.equal(state?.segments.length, 1)
  assert.equal(state?.segments[0].text, 'Sandbox recognized speech 1')
  const audioDir = await store.prepareAudio(live.header.id)
  const windows = (await readdir(audioDir)).filter(x => x.endsWith('.wav')).sort()
  assert.deepEqual(windows, ['000000.wav', '000001.wav'])
  assert.deepEqual(await Promise.all(windows.map(async x =>
    decodeWav(await readFile(join(audioDir, x))).length)), [SAMPLE_RATE * 5, SAMPLE_RATE])

  const statusTool = ctx.tools.get('meeting_status')
  const statusText = await statusTool.execute({}, {
    agent: { session: live }, signal: new AbortController().signal,
  })
  assert.equal(JSON.parse(statusText).segments, 1)

  const fileSession = ctx.sessions.create('sandbox-file-tool-session', { meta: { cwd: workspace } })
  const input = join(workspace, 'sandbox-input.wav')
  await writeFile(input, encodeWav(new Float32Array(SAMPLE_RATE * 5).fill(0.3)))
  const fileTool = ctx.tools.get('meeting_capture_file')
  const fileReceipt = JSON.parse(await fileTool.execute({ path: input }, {
    agent: { session: fileSession }, signal: new AbortController().signal,
  }))
  assert.equal(fileReceipt.captured, 1)
  assert.equal(fileReceipt.processed, 1)
  assert.equal(recognized, 2)
  assert.equal((await ctx.meetingContext.storeFor(fileSession.header.id).read(fileSession.header.id)).phase, 'stopped')
  assert.ok(resolve(audioDir).startsWith(resolve(workspace)), 'Audio inside Session Workspace')

  console.log(JSON.stringify({ result: 'PASS', environment: 'github-linux-sandbox',
    plugins: ['meeting-context', 'meeting-speaker', 'meeting-capture'],
    services: ['sessions', 'tools', 'speechToText'], sessions: 2,
    wavWindows: windows.length + fileReceipt.captured, fakeTranscriptions: recognized,
    toolHandlers: ['meeting_status', 'meeting_capture_file'],
    workspaceStorage: '.dsh-meeting/<sha256(sessionId)>/audio', model: 'deterministic-fixture' }, null, 2))
} finally {
  await ctx.fiber.dispose()
  await rm(workspace, { recursive: true, force: true })
}
