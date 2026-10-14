import { SAMPLE_RATE, encodeWav } from './wav.js'

export interface SpeakerTurn { startMs: number; endMs: number; speakerId: string | null }
export interface CapturedLine {
  startMs: number
  endMs: number
  text: string
  speakerId: string | null
  turns?: readonly SpeakerTurn[]
}
export interface CapturePorts {
  /** Persist each accepted window before adding it to the bounded ASR queue. */
  persist(wav: Uint8Array, startMs: number, endMs: number, signal: AbortSignal): Promise<void>
  process(wav: Uint8Array, samples: Float32Array, startMs: number, endMs: number, signal: AbortSignal): Promise<CapturedLine | null>
}
export interface CaptureReceipt {
  captured: number
  processed: number
  silent: number
  interrupted: boolean
  errors: string[]
  lines: CapturedLine[]
}
export interface CaptureOptions {
  /** Total PCM samples durably persisted before a recovered recording starts. */
  offsetSamples?: number
  /** Maximum simultaneous in-flight + waiting transcription windows. */
  maxQueuedWindows?: number
  signal?: AbortSignal
}
interface Window { wav: Uint8Array; samples: Float32Array; startMs: number; endMs: number }
const WINDOW = 5 * SAMPLE_RATE
const MAX_INPUT = 10 * SAMPLE_RATE
const MIN_ASR_TAIL = Math.round(0.35 * SAMPLE_RATE)
const RMS_GATE = 0.008

function audible(samples: Float32Array): boolean {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / samples.length) >= RMS_GATE
}

/** Await push() for durable ingestion. Recognition runs in a bounded independent lane. */
export class ContinuousCapture {
  private pending = new Float32Array(0)
  private consumed: number
  private readonly queue: Window[] = []
  private worker: Promise<void> | null = null
  private feeding: Promise<void> | null = null
  private stopTask: Promise<CaptureReceipt> | null = null
  private readonly controller = new AbortController()
  private readonly waiters = new Set<() => void>()
  private readonly receipt: CaptureReceipt = { captured: 0, processed: 0, silent: 0, interrupted: false, errors: [], lines: [] }
  private readonly capacity: number
  private fatal = false
  private ended = false
  private readonly upstream?: AbortSignal

  constructor(private readonly ports: CapturePorts, options: CaptureOptions = {}) {
    this.consumed = options.offsetSamples ?? 0
    this.capacity = options.maxQueuedWindows ?? 4
    if (!Number.isSafeInteger(this.consumed) || this.consumed < 0
      || !Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new Error('Invalid capture options')
    this.upstream = options.signal
    if (options.signal?.aborted) this.cancel(options.signal.reason)
    else options.signal?.addEventListener('abort', this.upstreamAbort, { once: true })
  }
  private upstreamAbort = (): void => { this.cancel(this.upstream?.reason) }
  private get signal(): AbortSignal { return this.controller.signal }
  private wake(): void { for (const wake of this.waiters) wake(); this.waiters.clear() }
  private async slot(): Promise<void> {
    while ((this.worker === null ? 0 : 1) + this.queue.length >= this.capacity) {
      this.signal.throwIfAborted()
      await new Promise<void>(resolve => { this.waiters.add(resolve) })
    }
    this.signal.throwIfAborted()
  }
  private processQueue(): void {
    if (this.worker || this.queue.length === 0) return
    const task = (async () => {
      while (this.queue.length > 0) {
        const { wav, samples, startMs, endMs } = this.queue.shift()!
        try {
          this.signal.throwIfAborted()
          const line = await this.ports.process(wav, samples, startMs, endMs, this.signal)
          this.signal.throwIfAborted()
          this.receipt.processed++
          if (line) this.receipt.lines.push(line)
        } catch (error) {
          if (!this.signal.aborted) this.receipt.errors.push('ASR at ' + startMs + 'ms: ' + String(error))
        } finally { this.wake() }
      }
    })()
    this.worker = task.finally(() => {
      this.worker = null
      this.wake()
      if (this.queue.length > 0) this.processQueue()
    })
  }
  private async acceptWindow(samples: Float32Array): Promise<void> {
    const speech = samples.length >= MIN_ASR_TAIL && audible(samples)
    if (speech) await this.slot()
    this.signal.throwIfAborted()
    const startMs = Math.round(this.consumed * 1000 / SAMPLE_RATE)
    const endMs = Math.round((this.consumed + samples.length) * 1000 / SAMPLE_RATE)
    const wav = encodeWav(samples)
    try {
      await this.ports.persist(wav, startMs, endMs, this.signal)
    } catch (error) {
      this.receipt.errors.push('Audio persistence at ' + startMs + 'ms: ' + String(error))
      this.fatal = true
      this.cancel(error)
      throw error
    }
    this.consumed += samples.length
    this.receipt.captured++
    if (!speech) { this.receipt.silent++; return }
    this.queue.push({ wav, samples, startMs, endMs })
    this.processQueue()
  }
  /** Caller must await every push; overlapping pushes are explicitly rejected. */
  push(samples: Float32Array): Promise<void> {
    if (this.ended) return Promise.reject(new Error('Capture is stopped'))
    if (this.feeding) return Promise.reject(new Error('Concurrent push: await the previous PCM frame'))
    if (samples.length > MAX_INPUT || !samples.every(Number.isFinite)) {
      return Promise.reject(new Error('Invalid PCM frame (max 10 seconds at 16 kHz)'))
    }
    const task = this.accept(samples.slice())
    this.feeding = task
    void task.finally(() => { if (this.feeding === task) this.feeding = null }).catch(() => undefined)
    return task
  }
  private async accept(samples: Float32Array): Promise<void> {
    let cursor = 0
    while (cursor < samples.length) {
      this.signal.throwIfAborted()
      const count = Math.min(WINDOW - this.pending.length, samples.length - cursor)
      const merged = new Float32Array(this.pending.length + count)
      merged.set(this.pending)
      merged.set(samples.subarray(cursor, cursor + count), this.pending.length)
      this.pending = merged
      cursor += count
      if (this.pending.length === WINDOW) {
        const window = this.pending
        this.pending = new Float32Array(0)
        await this.acceptWindow(window)
      }
    }
  }
  cancel(reason?: unknown): void {
    if (!this.signal.aborted) this.controller.abort(reason ?? new Error('Capture cancelled'))
    this.receipt.interrupted = true
    this.wake()
  }
  stop(): Promise<CaptureReceipt> {
    this.stopTask ??= this.finish()
    return this.stopTask
  }
  private async finish(): Promise<CaptureReceipt> {
    this.ended = true
    try {
      await this.feeding?.catch(() => undefined)
      // Persist even a 1-sample tail. Short tails are excluded from ASR only.
      if (this.pending.length && !this.signal.aborted) {
        const tail = this.pending
        this.pending = new Float32Array(0)
        await this.acceptWindow(tail).catch(() => undefined)
      }
      while (this.worker) await this.worker
      if (this.signal.aborted || this.fatal) this.receipt.interrupted = true
      return { ...this.receipt, lines: [...this.receipt.lines], errors: [...this.receipt.errors] }
    } finally { this.upstream?.removeEventListener('abort', this.upstreamAbort) }
  }
}
