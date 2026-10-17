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
