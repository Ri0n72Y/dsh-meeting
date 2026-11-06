import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { archiveMeetingAudio } from '../src/capture/archive.js'
import { audioCheckpoint, saveAudioWindow } from '../src/capture/audio-files.js'
import { encodeWav, SAMPLE_RATE } from '../src/capture/wav.js'

test('normal-stop archive merges all PCM into one compressed WAV without timing gaps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meeting-archive-'))
  const dir = join(root, 'audio')
  try {
    const parts = [
      new Float32Array(SAMPLE_RATE * 2).fill(0.25),
      new Float32Array(SAMPLE_RATE).fill(0),
      new Float32Array(SAMPLE_RATE).fill(-0.2),
    ]
    for (let i = 0; i < parts.length; i++) {
      await saveAudioWindow(dir, i, encodeWav(parts[i]!), new AbortController().signal)
    }
    const saved = await audioCheckpoint(dir)
    assert.equal(saved.offsetSamples, SAMPLE_RATE * 4)
    const output = await archiveMeetingAudio(dir)
    assert.equal(output, join(root, 'meeting.wav.gz'))
    const merged = gunzipSync(await readFile(output!))
    const expected = new Uint8Array(44 + 2 * saved.offsetSamples)
    expected.set(encodeWav(new Float32Array(0)), 0)
    const header = new DataView(expected.buffer)
    header.setUint32(4, expected.length - 8, true)
    header.setUint32(40, expected.length - 44, true)
    let cursor = 44
    for (const part of parts) {
      const pcm = encodeWav(part).subarray(44)
      expected.set(pcm, cursor)
      cursor += pcm.length
    }
    assert.deepEqual(merged, Buffer.from(expected))
    assert.deepEqual(await audioCheckpoint(dir), saved)
  } finally { await rm(root, { recursive: true, force: true }) }
})
