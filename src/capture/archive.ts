/** One lossless, compressed meeting audio artifact built from durable PCM windows. */
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { audioCheckpoint } from './audio-files.js'
import { encodeWav } from './wav.js'

/**
 * Archive complete 16 kHz mono PCM16 WAV windows without altering their timeline.
 * The compressed WAV is lossless; silence remains present so SRT cue offsets match.
 * Source windows remain available for recovery if compression or publication fails.
 */
export async function archiveMeetingAudio(audioDir: string): Promise<string | null> {
  const { nextIndex, offsetSamples } = await audioCheckpoint(audioDir)
  if (!nextIndex) return null
  const dataBytes = offsetSamples * 2
  if (!Number.isSafeInteger(dataBytes) || dataBytes + 36 > 0xffffffff) {
    throw new Error('Meeting audio exceeds the standard WAV size limit')
  }
  const output = join(dirname(audioDir), 'meeting.wav.gz')
  const temporary = output + '.' + randomUUID() + '.tmp'
  const header = Buffer.from(encodeWav(new Float32Array(0)))
  header.writeUInt32LE(dataBytes + 36, 4)
  header.writeUInt32LE(dataBytes, 40)
  const compressor = createGzip({ level: 6 })
  const finished = pipeline(compressor, createWriteStream(temporary, { flags: 'wx' }))
  // Attach a rejection handler during long recordings; the caller still awaits finished below.
  void finished.catch(() => undefined)
  const write = async (buffer: Uint8Array): Promise<void> => {
    if (!compressor.write(buffer)) await once(compressor, 'drain')
  }
  try {
    await write(header)
    for (let index = 0; index < nextIndex; index++) {
      const file = join(audioDir, String(index).padStart(6, '0') + '.wav')
      // Checkpoint has already verified that all WAV headers describe contiguous PCM.
      for await (const part of createReadStream(file, { start: 44 })) await write(part)
    }
    compressor.end()
    await finished
    await rename(temporary, output)
    return output
  } catch (error) {
    compressor.destroy()
    await finished.catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
