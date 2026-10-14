/**
 * Deterministic demonstrations without microphone hardware or installed model.
 * Not evidence of SenseVoice accuracy or sherpa-onnx runtime compatibility.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore } from '../packages/meeting-context/src/store.js'
import { ContinuousCapture } from '../packages/meeting-capture/src/continuous.js'
import { SpeakerTracker } from '../packages/meeting-speaker/src/tracker.js'

const dir = await mkdtemp(join(tmpdir(), 'meeting-proof-'))
try {
  const store = new MeetingStore(dir)
  await store.begin('dsh-session-demo')
  const tracker = new SpeakerTracker({
    embed(samples) { return new Float32Array([samples[0]!]) },
    manager() {
      const names = new Map<number, string>()
      return {
        search({ v }) { return names.get(Math.round(v[0]! * 10)) ?? '' },
        addMulti({ name, v }) { names.set(Math.round(v[0]![0]! * 10), name); return true },
      }
    },
  })
  const capture = new ContinuousCapture({
    async persist() {},
    async process(_wav, samples, startMs, endMs) {
      const speakerId = tracker.identify('dsh-session-demo', samples)
      const line = { startMs, endMs, text: 'Simulated speech; model not invoked', speakerId }
      await store.append('dsh-session-demo', line)
      return line
    },
  })
  capture.push(new Float32Array(80_000).fill(0.1))
  capture.push(new Float32Array(80_000).fill(0.9))
  const result = await capture.stop()
  await store.finish('dsh-session-demo')
  console.log('CAPTURE RECEIPT:', result)
  console.log('SESSION SNAPSHOT:', await store.read('dsh-session-demo'))
} finally { await rm(dir, { recursive: true, force: true }) }
