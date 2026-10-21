/** Host-only Windows default-output WASAPI loopback. No microphone or browser capture. */
import { createRequire } from 'node:module'

interface NativeLoopback {
  startSystemAudio(onChunk: (pcm48kStereo: Buffer | number | null) => void): void
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
  private readonly queued: (Float32Array | { silenceSamples: number })[] = []
  private pending = 0
  private draining: Promise<void> | null = null
  private error: Error | undefined
  private stopped = false
  private failedIntake = false
  private stopTask: Promise<{ samples: number; error?: string }> | null = null
  private nativeEnd: Promise<void> | undefined
  private resolveNativeEnd: (() => void) | undefined
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
      try { addon = require('../native/build/Release/loopback_capture_addon.node') as LoopbackModule }
      catch (cause) { throw new Error('Meeting WASAPI native addon is not built for Windows x64; build packages/meeting-capture/native', { cause }) }
      this.native = new addon.LoopbackCapture()
    }
    this.nativeEnd = new Promise<void>(resolve => { this.resolveNativeEnd = resolve })
    try {
      this.native.startSystemAudio((bytes) => {
        if (bytes === null) {
          this.resolveNativeEnd?.()
          return
        }
        if (this.stopped || this.failedIntake) return
        try {
          if (typeof bytes === 'number') {
            this.queueSilence(bytes)
            return
          }
          // Native WASAPI chunks need not end on a 3-stereo-frame boundary.
          const joined = this.carry.length ? Buffer.concat([this.carry, bytes]) : Buffer.from(bytes)
          const whole = Math.floor(joined.length / 12) * 12
          this.carry = Buffer.from(joined.subarray(whole))
          if (!whole) return
          this.enqueue(downmix48k(joined.subarray(0, whole)))
        } catch (cause) { this.fail(cause) }
      })
    } catch (error) {
      this.native.stop()
      this.native = undefined
      throw error
    }
  }

  // Many tiny gap markers must not accumulate unbounded queue objects.
  private queueItem(item: Float32Array | { silenceSamples: number }): void {
    if (this.queued.length >= 1024) throw new Error('WASAPI delivery exceeded queued packet limit')
    this.queued.push(item)
    this.startDrain()
  }

  private enqueue(samples: Float32Array): void {
    this.pending += samples.length
    if (this.pending > 16_000 * 3) throw new Error('WASAPI delivery exceeded 3 seconds of buffered audio')
    this.queueItem(samples)
  }

  /** A native gap is a count of missing 48 kHz frames, not an allocated PCM buffer. */
  private queueSilence(frames: number): void {
    if (!Number.isSafeInteger(frames) || frames < 1) {
      throw new Error('Invalid WASAPI silence frame count')
    }
    if (this.carry.length) {
      const needed = (12 - this.carry.length) / 4
      if (frames < needed) {
        this.carry = Buffer.concat([this.carry, Buffer.alloc(frames * 4)])
        return
      }
      const padded = Buffer.alloc(12)
      this.carry.copy(padded)
      this.carry = Buffer.alloc(0)
      this.enqueue(downmix48k(padded))
      frames -= needed
    }
    const samples = Math.floor(frames / 3)
    if (samples) {
      this.queueItem({ silenceSamples: samples })
    }
    const partial = frames % 3
    if (partial) this.carry = Buffer.alloc(partial * 4)
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
      const item = this.queued.shift()!
      if (item instanceof Float32Array) {
        try {
          await this.push(item)
          this.samples += item.length
        } catch (error) {
          this.fail(error)
        } finally {
          this.pending -= item.length
        }
      } else {
        // Reuse a bounded 5-second zero buffer regardless of meeting length.
        const silent = new Float32Array(16_000 * 5)
        let remaining = item.silenceSamples
        while (remaining > 0) {
          const count = Math.min(remaining, silent.length)
          try {
            await this.push(silent.subarray(0, count))
            this.samples += count
          } catch (error) {
            this.fail(error)
          }
          remaining -= count
        }
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
    let deviceStopFailed = false
    try {
      this.native?.stop()
    } catch (error) {
      deviceStopFailed = true
      this.error ??= error instanceof Error ? error : new Error(String(error))
    } finally {
      this.native = undefined
    }
    if (!deviceStopFailed && this.nativeEnd) {
      // The patched native addon places a null sentinel AFTER all PCM on the
      // same TSFN queue. Its delivery is the only trustworthy drain barrier.
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          this.nativeEnd,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('WASAPI native callback drain timed out')), 10_000)
          }),
        ])
      } catch (error) {
        this.error ??= error instanceof Error ? error : new Error(String(error))
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }
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
