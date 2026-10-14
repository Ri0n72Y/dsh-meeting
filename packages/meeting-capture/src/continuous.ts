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
  /** Every window is persisted, including silence, before attempting ASR. */
  persist(wav: Uint8Array, startMs: number, endMs: number): Promise<void>
  process(wav: Uint8Array, samples: Float32Array, startMs: number, endMs: number): Promise<CapturedLine | null>
}
export interface CaptureReceipt {
  captured: number
  processed: number
  silent: number
  errors: string[]
  lines: CapturedLine[]
}
const WINDOW = 5 * SAMPLE_RATE
const MIN_TAIL = Math.round(0.35 * SAMPLE_RATE)
const RMS_GATE = 0.008

function audible(samples: Float32Array): boolean {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  return Math.sqrt(energy / samples.length) >= RMS_GATE
}

/** Continuous bounded PCM windows. RMS is a silence gate, NOT a phonetic VAD. */
export class ContinuousCapture {
  private pending = new Float32Array(0)
  private consumed = 0
  private tail: Promise<void> = Promise.resolve()
  private readonly receipt: CaptureReceipt = { captured: 0, processed: 0, silent: 0, errors: [], lines: [] }
  private ended = false
  constructor(private readonly ports: CapturePorts) {}

  push(samples: Float32Array): void {
    if (this.ended) throw new Error('Capture is stopped')
    if (!samples.every(Number.isFinite)) throw new Error('Invalid PCM samples')
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending); merged.set(samples, this.pending.length)
    this.pending = merged
    while (this.pending.length >= WINDOW) {
      const window = this.pending.slice(0, WINDOW)
      this.pending = this.pending.slice(WINDOW)
      this.dispatch(window)
    }
  }
  private dispatch(samples: Float32Array): void {
    const startMs = Math.round(this.consumed * 1000 / SAMPLE_RATE)
    this.consumed += samples.length
    const endMs = Math.round(this.consumed * 1000 / SAMPLE_RATE)
    const wav = encodeWav(samples)
    const speech = audible(samples)
    this.tail = this.tail.then(async () => {
      await this.ports.persist(wav, startMs, endMs)
      this.receipt.captured++
      if (!speech) { this.receipt.silent++; return }
      try {
        const line = await this.ports.process(wav, samples, startMs, endMs)
        this.receipt.processed++
        if (line) this.receipt.lines.push(line)
      } catch (error) {
        this.receipt.errors.push('at ' + startMs + 'ms: ' + String(error))
      }
    })
  }
  async stop(): Promise<CaptureReceipt> {
    if (!this.ended) {
      this.ended = true
      if (this.pending.length >= MIN_TAIL) this.dispatch(this.pending)
      this.pending = new Float32Array(0)
    }
    await this.tail
    return { ...this.receipt, lines: [...this.receipt.lines], errors: [...this.receipt.errors] }
  }
}
