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
  let callback!: (bytes: Buffer) => void
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
    stop() { stopCalls++ },
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
  let callback!: (bytes: Buffer) => void
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
