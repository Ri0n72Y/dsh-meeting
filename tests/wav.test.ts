import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeWav, decodeWav, SAMPLE_RATE } from '../packages/meeting-capture/src/wav.js'

test('canonical PCM16 WAV preserves length, sign and 16 kHz format at quantization boundaries', () => {
  assert.equal(SAMPLE_RATE, 16_000)
  for (const values of [[], [-1, -0.5, 0, 0.5, 1], [-3, -0.00002, 0.00002, 3]]) {
    const pcm = Float32Array.from(values)
    const bytes = encodeWav(pcm)
    assert.equal(bytes.length, 44 + 2 * pcm.length)
    const decoded = decodeWav(bytes)
    assert.equal(decoded.length, pcm.length)
    for (let i = 0; i < pcm.length; i++) {
      const expected = Math.max(-1, Math.min(1, pcm[i]!))
      assert.ok(Math.abs(decoded[i]! - expected) <= 1 / 32768, String(i))
    }
  }
})

test('WAV decoder rejects corrupted canonical headers and truncated data', () => {
  const valid = encodeWav(new Float32Array([0.1, -0.2]))
  const corruptions: Array<[number, number]> = [
    [0, 0],        // RIFF signature
    [8, 0],        // WAVE signature
    [12, 0],       // fmt chunk
    [36, 0],       // data chunk
    [20, 3],       // unsupported PCM format
    [22, 2],       // stereo instead of mono
    [24, 0],       // unexpected sample rate
    [34, 8],       // wrong bit depth
    [40, 0],       // inconsistent PCM data length
  ]
  for (const [offset, value] of corruptions) {
    const data = valid.slice()
    data[offset] = value
    assert.throws(() => decodeWav(data), /Expected canonical/, String(offset))
  }
  assert.throws(() => decodeWav(valid.subarray(0, 43)), /Invalid PCM WAV length/)
  assert.throws(() => decodeWav(valid.subarray(0, valid.length - 2)), /Expected canonical/)
})
