import { mkdir, open, readdir, link, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const NAME = /^([0-9]{6})\.wav$/
/** Reconstruct timeline from committed PCM files rather than a stale process counter. */
export async function audioCheckpoint(dir: string): Promise<{ nextIndex: number; offsetSamples: number }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = entries.filter(item => item.isFile() && NAME.test(item.name)).map(item => item.name).sort()
  let offsetSamples = 0
  for (let i = 0; i < files.length; i++) {
    if (files[i] !== String(i).padStart(6, '0') + '.wav') {
      throw new Error('Non-contiguous meeting audio sequence; refusing unsafe resume')
    }
    const path = join(dir, files[i]!)
    const info = await stat(path)
    if (info.size < 44 || (info.size - 44) % 2 !== 0) throw new Error('Invalid persisted meeting PCM length')
    const handle = await open(path, 'r')
    try {
      const header = Buffer.alloc(44)
      if ((await handle.read(header, 0, 44, 0)).bytesRead !== 44
        || header.toString('ascii', 0, 4) !== 'RIFF'
        || header.readUInt32LE(4) !== info.size - 8
        || header.toString('ascii', 8, 12) !== 'WAVE'
        || header.toString('ascii', 12, 16) !== 'fmt '
        || header.readUInt32LE(16) !== 16
        || header.readUInt16LE(20) !== 1
        || header.readUInt16LE(22) !== 1
        || header.readUInt32LE(24) !== 16000
        || header.readUInt32LE(28) !== 32000
        || header.readUInt16LE(32) !== 2
        || header.readUInt16LE(34) !== 16
        || header.toString('ascii', 36, 40) !== 'data'
        || header.readUInt32LE(40) !== info.size - 44) {
        throw new Error('Corrupt persisted meeting audio: ' + files[i])
      }
    } finally { await handle.close() }
    offsetSamples += (info.size - 44) / 2
    if (!Number.isSafeInteger(offsetSamples)) throw new Error('Persisted meeting sample count exceeds safe integer range')
  }
  return { nextIndex: files.length, offsetSamples }
}
export async function saveAudioWindow(dir: string, index: number, wav: Uint8Array, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await mkdir(dir, { recursive: true })
  const target = join(dir, String(index).padStart(6, '0') + '.wav')
  const temporary = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, wav, { flag: 'wx', signal })
    signal.throwIfAborted()
    // Publish atomically without overwriting an existing committed window.
    await link(temporary, target)
    // A published window is committed even if temporary-file cleanup fails.
    await rm(temporary, { force: true }).catch(() => undefined)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
