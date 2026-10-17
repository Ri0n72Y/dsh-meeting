import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
