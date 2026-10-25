import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downmix48k, WindowsLoopback } from '../src/capture/windows-loopback.js'

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
  assert.equal(sizes.reduce((a, b) => a + b, 0), receipt.samples)
  assert.ok(sizes.every(size => size > 0 && size <= 16_000 * 5))
})

test('repeated tiny silence markers cannot grow the pending queue without bound', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let unblock!: () => void
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  let stopping!: Promise<{ samples: number; error?: string }>
  let saved = 0
  const source = new WindowsLoopback(async pcm => {
    await blocked
    saved += pcm.length
  }, () => { stopping = source.stop() }, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  source.start()
  for (let i = 0; i < 10_000; i++) callback(3)
  unblock()
  const receipt = await stopping
  assert.match(receipt.error ?? '', /queued packet limit/)
  assert.ok(saved > 0 && saved < 10_000)
  assert.equal(receipt.samples, saved)
})

test('WASAPI adapter output is invariant under byte chunk fragmentation', async () => {
  const frames = 12_007
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE((i % 20) * 900 - 8500, i * 4)
    data.writeInt16LE((i % 17) * 950 - 7600, i * 4 + 2)
  }
  const run = async (cuts: number[]) => {
    let callback!: (bytes: Buffer | number | null) => void
    const chunks: Float32Array[] = []
    const source = new WindowsLoopback(async pcm => { chunks.push(pcm.slice()) }, () => {}, () => ({
      startSystemAudio(cb) { callback = cb },
      stop() { queueMicrotask(() => callback(null)) },
    }))
    source.start()
    let offset = 0
    for (const n of cuts) {
      if (offset >= data.length) break
      callback(data.subarray(offset, offset + n))
      offset += n
    }
    if (offset < data.length) callback(data.subarray(offset))
    const receipt = await source.stop()
    return { values: chunks.flatMap(x => [...x]), receipt }
  }
  const baseline = await run([data.length])
  for (const split of [[1, 11, 2, 7, 13, 3], [40, 7, 999, 1, 4, 7]]) {
    assert.deepEqual(await run(split), baseline)
  }
  assert.equal(baseline.receipt.samples, Math.ceil(frames / 3))
})

test('native queue overrun is an observable failure, not a silent accepted packet', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let finish!: Promise<{ samples: number; error?: string }>
  const source = new WindowsLoopback(async () => {}, () => { finish = source.stop() }, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  source.start()
  callback(Buffer.alloc(12))
  callback(-1) // Native overload status, delivered before terminal marker.
  const receipt = await finish
  assert.match(receipt.error ?? '', /Native WASAPI callback queue overflow/)
  assert.equal(receipt.samples, 1)
})

test('implausibly large device-position silence fails promptly before generating PCM', async () => {
  let callback!: (bytes: Buffer | number | null) => void
  let finish!: Promise<{ samples: number; error?: string }>
  let accepted = 0
  const source = new WindowsLoopback(async pcm => { accepted += pcm.length }, () => { finish = source.stop() }, () => ({
    startSystemAudio(cb) { callback = cb },
    stop() { queueMicrotask(() => callback(null)) },
  }))
  source.start()
  callback(48_000 * 600 + 1)
  const receipt = await finish
  assert.match(receipt.error ?? '', /Invalid or excessive WASAPI silence frame count/)
  assert.equal(receipt.samples, 0)
  assert.equal(accepted, 0)
})
