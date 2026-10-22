import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audioCheckpoint, saveAudioWindow } from '../packages/meeting-capture/src/audio-files.js'
import { encodeWav } from '../packages/meeting-capture/src/wav.js'

test('durably saved recordings resume with monotone sample-based time offsets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-windows-'))
  const dir = join(root, 'audio')
  try {
    const signal = new AbortController().signal
    assert.deepEqual(await audioCheckpoint(dir), { nextIndex: 0, offsetSamples: 0 })
    await saveAudioWindow(dir, 0, encodeWav(new Float32Array(80000)), signal)
    await saveAudioWindow(dir, 1, encodeWav(new Float32Array(1600)), signal)
    assert.deepEqual(await audioCheckpoint(dir), { nextIndex: 2, offsetSamples: 81600 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('incomplete sequence fails closed rather than overwriting previous audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-sequence-'))
  try {
    await saveAudioWindow(root, 1, encodeWav(new Float32Array(16000)), new AbortController().signal)
    await assert.rejects(audioCheckpoint(root), /Non-contiguous/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('checkpoint refuses malformed persisted WAV without advancing recovery offset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-corrupt-'))
  try {
    const file = join(root, '000000.wav')
    const original = encodeWav(new Float32Array(1600))
    await writeFile(file, original)
    const invalid = original.slice()
    invalid[24] = 0 // Incorrect sample rate
    await writeFile(file, invalid)
    await assert.rejects(audioCheckpoint(root), /Corrupt persisted meeting audio/)
    assert.deepEqual(await readFile(file), Buffer.from(invalid))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('existing committed audio window cannot be replaced by the same index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-overwrite-'))
  try {
    const signal = new AbortController().signal
    const original = encodeWav(new Float32Array(1600).fill(0.25))
    const replacement = encodeWav(new Float32Array(1600).fill(-0.5))
    await saveAudioWindow(root, 0, original, signal)
    await assert.rejects(saveAudioWindow(root, 0, replacement, signal), /EEXIST/)
    assert.deepEqual(await readFile(join(root, '000000.wav')), Buffer.from(original))
    assert.deepEqual(await audioCheckpoint(root), { nextIndex: 1, offsetSamples: 1600 })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('checkpoint rejects malformed canonical WAV headers without accepting bad resume offsets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-invalid-format-'))
  const file = join(root, '000000.wav')
  try {
    const valid = encodeWav(new Float32Array(1600))
    const changes: Array<[number, number]> = [
      [4, 0],   // RIFF length
      [12, 0],  // fmt chunk marker
      [16, 0],  // fmt chunk size
      [20, 3],  // not PCM encoding
      [22, 2],  // stereo
      [29, 0],  // byte rate (32000 has zero in its low byte)
      [32, 4],  // block align
      [36, 0],  // missing data chunk
    ]
    for (const [offset, value] of changes) {
      const invalid = valid.slice()
      invalid[offset] = value
      await writeFile(file, invalid)
      await assert.rejects(audioCheckpoint(root), /Corrupt persisted meeting audio/, String(offset))
      assert.deepEqual(await readFile(file), Buffer.from(invalid))
    }
    await writeFile(file, valid)
    assert.deepEqual(await audioCheckpoint(root), { nextIndex: 1, offsetSamples: 1600 })
  } finally { await rm(root, { recursive: true, force: true }) }
})
