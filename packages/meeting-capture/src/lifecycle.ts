import type { CaptureReceipt } from './continuous.js'
import type { ContinuousCapture } from './continuous.js'

export interface CaptureLease {
  capture: ContinuousCapture
  settle(receipt: CaptureReceipt): Promise<void>
  release(): void
}
/** Session-scoped capture ownership; cleanup can outlive DSH's live Session map. */
export class SessionCaptureRegistry {
  private readonly active = new Map<string, CaptureLease>()
  private readonly stopping = new Map<string, Promise<CaptureReceipt>>()
  get(id: string): ContinuousCapture | undefined { return this.active.get(id)?.capture }
  has(id: string): boolean { return this.active.has(id) }
  keys(): string[] { return [...this.active.keys()] }
  add(id: string, lease: CaptureLease): void {
    if (this.has(id) || this.stopping.has(id)) throw new Error('Session capture already active')
    this.active.set(id, lease)
  }
  stop(id: string): Promise<CaptureReceipt> {
    const inflight = this.stopping.get(id)
    if (inflight) return inflight
    const lease = this.active.get(id)
    if (!lease) return Promise.reject(new Error('Session capture is not active'))
    const task = (async () => {
      try {
        const receipt = await lease.capture.stop()
        await lease.settle(receipt)
        return receipt
      } finally {
        if (this.active.get(id) === lease) this.active.delete(id)
        this.stopping.delete(id)
        lease.release()
      }
    })()
    this.stopping.set(id, task)
    return task
  }
  async cancel(id: string, reason: Error): Promise<void> {
    const lease = this.active.get(id)
    if (!lease) return
    lease.capture.cancel(reason)
    await this.stop(id)
  }
  async cancelAll(reason: Error): Promise<void> {
    await Promise.allSettled(this.keys().map(id => this.cancel(id, reason)))
  }
}
