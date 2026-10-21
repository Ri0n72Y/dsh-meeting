import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downmix48k, WindowsLoopback } from '../packages/meeting-capture/src/windows-loopback.js'

test('48 kHz stereo 16-bit PCM downmixes into mono 16 kHz', () => {
  const b = Buffer.alloc(12 * 4)
  for (let i = 0; i < b.length; i += 4) { b.writeInt16LE(16384, i); b.writeInt16LE(-8192, i + 2) }
  const pcm = downmix48k(b)
  assert.equal(pcm.length, 4)
  pcm.forEach(value => assert.ok(Math.abs(value - 0.125) < 0.001))
})
test('non-Windows devices are rejected before attempting native imports', () => {
  if (process.platform === 'win32' && process.arch === 'x64') return
  assert.throws(() => new WindowsLoopback(async () => {}, () => {}).start(), /Windows x64/)
})

test('overrun stops intake but persists every PCM block admitted before failure', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let stopCalls = 0
  let finish!: Promise<{ samples: number; error?: string }>
  let resolveFirst!: () => void
  const first = new Promise<void>(resolve => { resolveFirst = resolve })
  const delivered: number[] = []
  let pushes = 0
  const source = new WindowsLoopback(async samples => {
    delivered.push(samples.length)
    if (++pushes === 1) await first
  }, () => { finish = source.stop() }, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { stopCalls++; queueMicrotask(() => callback(null)) },
  }))
  source.start()
  callback(Buffer.alloc(12 * 20_000))
  callback(Buffer.alloc(12 * 20_000))
  callback(Buffer.alloc(12 * 20_000)) // rejected by the 3s buffer limit
  resolveFirst()
  const result = await finish
  assert.equal(result.samples, 40_000)
  assert.deepEqual(delivered, [20_000, 20_000])
  assert.match(result.error ?? '', /exceeded 3 seconds/)
  assert.equal(stopCalls, 1)
})

test('native stop failure still finishes accepted PCM before reporting error', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let release!: () => void
  const block = new Promise<void>(resolve => { release = resolve })
  const delivered: number[] = []
  const source = new WindowsLoopback(async samples => {
    await block
    delivered.push(samples.length)
  }, () => {}, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { throw new Error('native stop failed') },
  }))
  source.start()
  callback(Buffer.alloc(12 * 900))
  const stopping = source.stop()
  release()
  const receipt = await stopping
  assert.deepEqual(delivered, [900])
  assert.equal(receipt.samples, 900)
  assert.match(receipt.error ?? '', /native stop failed/)
})

test('stop waits for the native terminal marker behind the final audio callbacks', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let stopNative = 0
  const writes: number[] = []
  const source = new WindowsLoopback(async samples => {
    writes.push(samples.length)
  }, () => {}, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() {
      stopNative++
      // Native already queued the final PCM then the terminal marker.
      setImmediate(() => {
        callback(Buffer.alloc(12 * 1600))
        callback(null)
      })
    },
  }))
  source.start()
  const stopped = source.stop()
  let finished = false
  void stopped.then(() => { finished = true })
  await new Promise<void>(r => setImmediate(r))
  // Once the native end marker has run, every earlier callback is in JS queue.
  const receipt = await stopped
  assert.equal(finished, true)
  assert.equal(receipt.samples, 1600)
  assert.deepEqual(writes, [1600])
  assert.equal(stopNative, 1)
})

test('silent PCM consumes timeline samples instead of being omitted', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  const observed: Float32Array[] = []
  const source = new WindowsLoopback(async pcm => { observed.push(pcm) }, () => {}, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  source.start()
  callback(Buffer.alloc(12 * 16_000)) // one full second of 48 kHz zero samples
  const receipt = await source.stop()
  assert.equal(receipt.samples, 16_000)
  assert.ok(observed.flatMap(samples => [...samples]).every(sample => sample === 0))
})

test('WASAPI frame-position gaps preserve absolute audio offsets without dense native buffers', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  const writes: Float32Array[] = []
  const source = new WindowsLoopback(async pcm => { writes.push(pcm.slice()) }, () => {}, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  const voiced = Buffer.alloc(24)
  for (let i = 0; i < voiced.length; i += 2) voiced.writeInt16LE(16_384, i)
  source.start()
  callback(voiced)        // two 16 kHz output samples
  callback(48_000)       // one second without WASAPI packets
  callback(voiced)
  const receipt = await source.stop()
  assert.equal(receipt.samples, 16_004)
  assert.deepEqual(writes.map(chunk => chunk.length), [2, 16_000, 2])
  assert.ok(writes[1]!.every(value => value === 0))
  assert.ok(writes[0]!.every(value => value > 0))
  assert.ok(writes[2]!.every(value => value > 0))
})

test('long native silence markers drain in bounded chunks and retain decimator carry', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  const sizes: number[] = []
  let nonzero = 0
  const source = new WindowsLoopback(async pcm => {
    sizes.push(pcm.length)
    if (pcm.some(value => value !== 0)) nonzero++
  }, () => {}, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  source.start()
  // One stereo 48 kHz frame stays in the downmix carry until two more arrive.
  const partial = Buffer.alloc(4)
  partial.writeInt16LE(16_384, 0)
  callback(partial)
  callback(48_000 * 30 + 2)
  const receipt = await source.stop()
  assert.equal(receipt.samples, 16_000 * 30 + 1)
  assert.equal(nonzero, 1)
  assert.deepEqual(sizes, [1, ...Array(6).fill(80_000)])
  assert.ok(sizes.every(size => size <= 80_000))
})
