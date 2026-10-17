import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContinuousCapture } from '../packages/meeting-capture/src/continuous.js'
import { SAMPLE_RATE, decodeWav } from '../packages/meeting-capture/src/wav.js'

const voiced = (seconds: number): Float32Array => new Float32Array(SAMPLE_RATE * seconds).fill(0.2)

test('continuous PCM produces timed transcripts, silent windows and entire final tail', async () => {
  const saved: Array<{ start: number; end: number; frames: number }> = []
  const capture = new ContinuousCapture({
    async persist(wav, start, end) { saved.push({ start, end, frames: decodeWav(wav).length }) },
    async process(_wav, _samples, start, end) {
      return { startMs: start, endMs: end, speakerId: null, text: 'recognized segment' }
    },
  })
  await capture.push(voiced(5))
  await capture.push(new Float32Array(SAMPLE_RATE * 5))
  await capture.push(voiced(1))
  await capture.push(new Float32Array(Math.round(SAMPLE_RATE * 0.1)).fill(0.2))
  const result = await capture.stop()
  assert.equal(result.captured, 3)
  assert.equal(result.silent, 1)
  assert.equal(result.interrupted, false)
  assert.deepEqual(result.lines.map(line => [line.startMs, line.endMs]), [[0, 5000], [10000, 11100]])
  assert.deepEqual(saved.map(x => [x.start, x.end, x.frames]), [
    [0, 5000, 80000], [5000, 10000, 80000], [10000, 11100, 17600],
  ])
})

test('final 100ms alone is persisted even when too short for ASR', async () => {
  const saved: number[] = []
  const capture = new ContinuousCapture({
    async persist(wav) { saved.push(decodeWav(wav).length) },
    async process() { throw new Error('short tail must not be transcribed') },
  })
  await capture.push(new Float32Array(1600).fill(0.3))
  const result = await capture.stop()
  assert.deepEqual(saved, [1600])
  assert.equal(result.captured, 1)
  assert.equal(result.silent, 1)
  assert.equal(result.processed, 0)
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
  await capture.push(voiced(10))
  const result = await capture.stop()
  assert.equal(persisted, 2)
  assert.equal(result.errors.length, 1)
  assert.equal(result.interrupted, false)
  assert.equal(result.lines[0]?.text, 'recovered')
})

test('persist failure interrupts instead of poisoning all later windows', async () => {
  let calls = 0
  const capture = new ContinuousCapture({
    async persist() { calls++; throw new Error('disk full') },
    async process() { throw new Error('must not recognize unsaved audio') },
  })
  await assert.rejects(capture.push(voiced(5)), /disk full/)
  const result = await capture.stop()
  assert.equal(calls, 1)
  assert.equal(result.captured, 0)
  assert.equal(result.interrupted, true)
  assert.match(result.errors[0]!, /Audio persistence/)
  await assert.rejects(capture.push(voiced(5)), /Capture is stopped/)
})

test('slow ASR applies producer backpressure, not an unbounded audio backlog', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let persisted = 0
  const capture = new ContinuousCapture({
    async persist() { persisted++ },
    async process(_wav, _samples, startMs, endMs) {
      if (startMs === 0) await gate
      return { startMs, endMs, text: 'ok', speakerId: null }
    },
  }, { maxQueuedWindows: 1 })
  await capture.push(voiced(5))
  const pending = capture.push(voiced(5))
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.equal(persisted, 1)
  await assert.rejects(capture.push(voiced(1)), /Concurrent push/)
  release()
  await pending
  assert.equal(persisted, 2)
  assert.equal((await capture.stop()).processed, 2)
})

test('upstream cancellation reaches in-flight recognition and returns interrupted state', async () => {
  const controller = new AbortController()
  let entered!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const capture = new ContinuousCapture({
    async persist() {},
    async process(_wav, _samples, _start, _end, signal) {
      entered()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
      return null
    },
  }, { signal: controller.signal })
  await capture.push(voiced(5))
  await inside
  controller.abort(new Error('user cancelled'))
  const result = await capture.stop()
  assert.equal(result.interrupted, true)
  assert.equal(result.processed, 0)
})

test('short quiet utterance within five-second window reaches ASR', async () => {
  let processed = 0
  const recording = new Float32Array(SAMPLE_RATE * 5)
  // 300ms phrase at amplitude .03 has whole-window RMS ~.00735 (< .008).
  recording.fill(0.03, SAMPLE_RATE, SAMPLE_RATE + 4800)
  const capture = new ContinuousCapture({
    async persist() {},
    async process() { processed++; return null },
  })
  await capture.push(recording)
  const result = await capture.stop()
  assert.equal(result.captured, 1)
  assert.equal(result.silent, 0)
  assert.equal(processed, 1)
})

test('Session disposal keeps every accepted 1s and 4.9s buffered tail', async () => {
  for (const size of [SAMPLE_RATE, SAMPLE_RATE * 4 + Math.floor(SAMPLE_RATE * 0.9)]) {
    const stored: number[] = []
    const capture = new ContinuousCapture({
      async persist(wav) { stored.push(decodeWav(wav).length) },
      async process() { throw new Error('Cancelled tail must not start ASR') },
    })
    await capture.push(new Float32Array(size).fill(0.3))
    capture.cancel(new Error('session/disposed'))
    const receipt = await capture.stop()
    assert.deepEqual(stored, [size])
    assert.equal(receipt.captured, 1)
    assert.equal(receipt.silent, 0)
    assert.equal(receipt.processed, 0)
    assert.equal(receipt.interrupted, true)
  }
})

test('cancelled genuinely silent PCM is still counted as silence', async () => {
  const stored: number[] = []
  const capture = new ContinuousCapture({
    async persist(wav) { stored.push(decodeWav(wav).length) },
    async process() { throw new Error('Cancelled tail must not start ASR') },
  })
  await capture.push(new Float32Array(SAMPLE_RATE))
  capture.cancel(new Error('session/disposed'))
  const receipt = await capture.stop()
  assert.deepEqual(stored, [SAMPLE_RATE])
  assert.equal(receipt.captured, 1)
  assert.equal(receipt.silent, 1)
  assert.equal(receipt.processed, 0)
  assert.equal(receipt.interrupted, true)
})

test('cancel while queued behind slow ASR flushes a complete waiting PCM window', async () => {
  const stored: number[] = []
  let entered!: () => void
  const enteredPromise = new Promise<void>(resolve => { entered = resolve })
  const capture = new ContinuousCapture({
    async persist(wav) { stored.push(decodeWav(wav).length) },
    async process(_wav, _samples, _start, _end, signal) {
      entered()
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return null
    },
  }, { maxQueuedWindows: 1 })
  await capture.push(new Float32Array(SAMPLE_RATE * 5).fill(0.3))
  await enteredPromise
  const feeding = capture.push(new Float32Array(SAMPLE_RATE * 5).fill(0.3))
  capture.cancel(new Error('session/disposed'))
  await assert.rejects(feeding)
  const receipt = await capture.stop()
  assert.deepEqual(stored, [SAMPLE_RATE * 5, SAMPLE_RATE * 5])
  assert.equal(receipt.captured, 2)
  assert.equal(receipt.interrupted, true)
})
