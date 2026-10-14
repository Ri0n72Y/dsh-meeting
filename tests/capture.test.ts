import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContinuousCapture } from '../packages/meeting-capture/src/continuous.js'
import { SAMPLE_RATE, decodeWav } from '../packages/meeting-capture/src/wav.js'

test('continuous PCM produces visible timed transcripts and keeps silent audio', async () => {
  const saved: Array<{ start: number; end: number; frames: number }> = []
  const capture = new ContinuousCapture({
    async persist(wav, start, end) {
      saved.push({ start, end, frames: decodeWav(wav).length })
    },
    async process(_wav, _samples, start, end) {
      return { startMs: start, endMs: end, speakerId: null, text: 'recognized segment' }
    },
  })
  capture.push(new Float32Array(SAMPLE_RATE * 5).fill(0.2))
  capture.push(new Float32Array(SAMPLE_RATE * 5))
  capture.push(new Float32Array(SAMPLE_RATE).fill(0.2))
  const result = await capture.stop()
  assert.equal(result.captured, 3)
  assert.equal(result.silent, 1)
  assert.deepEqual(result.lines.map(line => [line.startMs, line.endMs]), [[0, 5000], [10000, 11000]])
  assert.deepEqual(saved.map(x => [x.start, x.end]), [[0, 5000], [5000, 10000], [10000, 11000]])
})

test('failed ASR preserves audio and subsequent windows', async () => {
  let count = 0
  let persisted = 0
  const capture = new ContinuousCapture({
    async persist() { persisted++ },
    async process(_wav, _pcm, startMs, endMs) {
      if (count++ === 0) throw new Error('temporary recognition failure')
      return { startMs, endMs, text: 'recovered', speakerId: null }
    },
  })
  capture.push(new Float32Array(SAMPLE_RATE * 10).fill(0.4))
  const result = await capture.stop()
  assert.equal(persisted, 2)
  assert.equal(result.errors.length, 1)
  assert.equal(result.lines[0]?.text, 'recovered')
})
