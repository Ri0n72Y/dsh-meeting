/** Host-only Windows default-output WASAPI loopback. No microphone or browser capture. */
import { createRequire } from 'node:module'

interface NativeLoopback {
  startSystemAudio(onChunk: (pcm48kStereo: Buffer) => void): void
  stop(): void
}
interface LoopbackModule { LoopbackCapture: new () => NativeLoopback }
const require = createRequire(import.meta.url)

/** Signed 16-bit stereo 48 kHz -> mono 16 kHz; 3-frame decimation with averaging.
 * The simple low-pass is intentionally bounded and streaming-safe. */
export function downmix48k(chunk: Buffer): Float32Array {
  if (chunk.byteLength % 12 !== 0) throw new Error('Unexpected WASAPI PCM framing')
  const out = new Float32Array(chunk.length / 12)
  for (let j = 0, i = 0; j < out.length; j++, i += 12) {
    // Average 3 consecutive stereo frames; avoids raw sample dropping.
    let sum = 0
    for (let k = 0; k < 12; k += 4) {
      sum += (chunk.readInt16LE(i + k) + chunk.readInt16LE(i + k + 2)) / 65536
    }
    out[j] = sum / 3
  }
  return out
}

/** Delivery through one awaitable lane, with bounded native callback buffering.
 * Overrun is an explicit failure, not unbounded memory usage or silent data loss. */
export class WindowsLoopback {
  private native: NativeLoopback | undefined
  private readonly queued: Float32Array[] = []
  private pending = 0
  private draining: Promise<void> | null = null
  private error: Error | undefined
  private stopped = false
  private failedIntake = false
  private stopTask: Promise<{ samples: number; error?: string }> | null = null
  private samples = 0
  private carry = Buffer.alloc(0)
  constructor(private readonly push: (samples: Float32Array) => Promise<void>,
    private readonly onError: (error: Error) => void,
    private readonly createNative?: () => NativeLoopback) {}

  start(): void {
    if (!this.createNative && (process.platform !== 'win32' || process.arch !== 'x64')) {
      throw new Error('WASAPI system audio requires Windows x64')
    }
    if (this.createNative) {
      this.native = this.createNative()
    } else {
      let addon: LoopbackModule
      try { addon = require('loopback-capture') as LoopbackModule }
      catch (cause) { throw new Error('WASAPI loopback native package is missing or could not load', { cause }) }
      this.native = new addon.LoopbackCapture()
    }
    try {
      this.native.startSystemAudio((bytes) => {
        if (this.stopped || this.failedIntake) return
        try {
          // Native WASAPI chunks need not end on a 3-stereo-frame boundary.
          const joined = this.carry.length ? Buffer.concat([this.carry, bytes]) : Buffer.from(bytes)
          const whole = Math.floor(joined.length / 12) * 12
          this.carry = Buffer.from(joined.subarray(whole))
          if (!whole) return
          const samples = downmix48k(joined.subarray(0, whole))
          this.pending += samples.length
          if (this.pending > 16_000 * 3) throw new Error('WASAPI delivery exceeded 3 seconds of buffered audio')
          this.queued.push(samples)
          this.startDrain()
        } catch (cause) { this.fail(cause) }
      })
    } catch (error) {
      this.native.stop()
      this.native = undefined
      throw error
    }
  }

  private startDrain(): void {
    if (this.draining) return
    this.draining = this.drain().finally(() => {
      this.draining = null
      if (this.queued.length) this.startDrain()
    })
  }

  private async drain(): Promise<void> {
    while (this.queued.length) {
      const samples = this.queued.shift()!
      try {
        // Accepted PCM must be attempted even after intake failure.
        await this.push(samples)
        this.samples += samples.length
      } catch (error) {
        // A failed disk write is reported, never counted as persisted.
        this.fail(error)
      } finally {
        this.pending -= samples.length
      }
    }
  }

  private fail(cause: unknown): void {
    if (this.error) return
    this.error = cause instanceof Error ? cause : new Error(String(cause))
    this.failedIntake = true
    // MeetingControl stops the source first, then cancels its capture.
    this.onError(this.error)
  }

  stop(): Promise<{ samples: number; error?: string }> {
    return this.stopTask ??= this.finish()
  }

  private async finish(): Promise<{ samples: number; error?: string }> {
    try {
      this.native?.stop()
    } catch (error) {
      // Native failure must not skip the already accepted JS queue.
      this.error ??= error instanceof Error ? error : new Error(String(error))
    } finally {
      this.native = undefined
    }
    // Upstream TSFN does not acknowledge all queued native-to-JS callbacks.
    // This only guarantees draining callbacks already admitted by JS.
    while (this.draining || this.queued.length) {
      if (this.draining) await this.draining
      else this.startDrain()
    }
    this.stopped = true
    if (this.carry.length) {
      const padded = Buffer.alloc(12)
      this.carry.copy(padded)
      this.carry = Buffer.alloc(0)
      try {
        const samples = downmix48k(padded)
        await this.push(samples)
        this.samples += samples.length
      } catch (error) {
        this.error ??= error instanceof Error ? error : new Error(String(error))
      }
    }
    return { samples: this.samples, ...this.error ? { error: this.error.message } : {} }
  }
}
