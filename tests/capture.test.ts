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

test('cancelled capture persists varied buffered tails and counts true silence', async () => {
  for (const [size, amplitude, silent] of [
    [SAMPLE_RATE, 0.3, 0],
    [SAMPLE_RATE * 4 + Math.floor(SAMPLE_RATE * 0.9), 0.3, 0],
    [SAMPLE_RATE, 0, 1],
  ]) {
    const saved: number[] = []
    const capture = new ContinuousCapture({
      async persist(wav, _start, _end, signal) { signal.throwIfAborted(); saved.push(decodeWav(wav).length) },
      async process() { throw new Error('Cancelled tail must not start ASR') },
    })
    await capture.push(new Float32Array(size).fill(amplitude))
    capture.cancel(new Error('session/disposed'))
    const receipt = await capture.stop()
    assert.deepEqual(saved, [size])
    assert.equal(receipt.captured, 1)
    assert.equal(receipt.silent, silent)
    assert.equal(receipt.processed, 0)
    assert.equal(receipt.interrupted, true)
  }
})

test('cancel while queued behind slow ASR flushes a complete waiting PCM window', async () => {
  const stored: number[] = []
  let entered!: () => void
  const enteredPromise = new Promise<void>(resolve => { entered = resolve })
  const capture = new ContinuousCapture({
    async persist(wav, _from, _to, signal) { signal.throwIfAborted(); stored.push(decodeWav(wav).length) },
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

test('PCM windowing is invariant under arbitrary producer chunk boundaries', async () => {
  const pcm = new Float32Array(SAMPLE_RATE * 11 + 77)
  pcm.fill(0.3, 0, SAMPLE_RATE * 5)
  pcm.fill(0, SAMPLE_RATE * 5, SAMPLE_RATE * 10)
  pcm.fill(-0.2, SAMPLE_RATE * 10)
  const run = async (pieces: number[]) => {
    const persisted: Array<{ from: number; to: number; bytes: Buffer }> = []
    const transcribed: Array<[number, number]> = []
    const capture = new ContinuousCapture({
      async persist(wav, from, to) { persisted.push({ from, to, bytes: Buffer.from(wav) }) },
      async process(_wav, _pcm, from, to) { transcribed.push([from, to]); return null },
    })
    let at = 0
    for (const n of pieces) {
      if (at >= pcm.length) break
      await capture.push(pcm.subarray(at, at + n))
      at += n
    }
    if (at < pcm.length) await capture.push(pcm.subarray(at))
    const receipt = await capture.stop()
    return { persisted, transcribed, receipt }
  }
  const contiguous = await run([SAMPLE_RATE * 10])
  for (const sizes of [[1, 79_999, 1, 31, 16_000, 700], [317, 55_000, 127, 80_000]]) {
    assert.deepEqual(await run(sizes), contiguous)
  }
  assert.equal(contiguous.receipt.captured, 3)
  assert.equal(contiguous.receipt.silent, 1)
})

test('invalid ingestion and options fail at the public capture boundary', async () => {
  const ports = { async persist() {}, async process() { return null } }
  for (const opts of [{ offsetSamples: -1 }, { offsetSamples: 1.5 }, { maxQueuedWindows: 0 }]) {
    assert.throws(() => new ContinuousCapture(ports, opts), /Invalid capture options/)
  }
  const c = new ContinuousCapture(ports)
  await assert.rejects(c.push(new Float32Array(SAMPLE_RATE * 10 + 1)), /Invalid PCM frame/)
  await assert.rejects(c.push(Float32Array.of(Number.NaN)), /Invalid PCM frame/)
  await assert.rejects(c.push(Float32Array.of(Number.POSITIVE_INFINITY)), /Invalid PCM frame/)
  assert.equal((await c.stop()).captured, 0)
  await assert.rejects(c.push(Float32Array.of(0.1)), /Capture is stopped/)
})

test('cancellation during in-flight disk persistence does not abort an accepted window', async () => {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const saved: number[] = []
  const capture = new ContinuousCapture({
    async persist(wav, _start, _end, signal) {
      signal.throwIfAborted()
      entered()
      await gate
      // A cancelled intake signal would fail here; disk write has independent ownership.
      signal.throwIfAborted()
      saved.push(decodeWav(wav).length)
    },
    async process() { throw new Error('cancelled capture must not start ASR') },
  })
  const pushing = capture.push(voiced(5))
  await started
  capture.cancel(new Error('Session disposed during write'))
  release()
  await pushing
  const result = await capture.stop()
  assert.deepEqual(saved, [SAMPLE_RATE * 5])
  assert.equal(result.captured, 1)
  assert.equal(result.processed, 0)
  assert.equal(result.interrupted, true)
})
