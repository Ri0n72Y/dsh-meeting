/** Deduplicate concurrent summaries per Session; one final pass follows an active checkpoint. */
export class SummaryJobs {
  private readonly active = new Map<string, { task: Promise<void>; final: boolean }>()
  constructor(private readonly generate: (sessionId: string, final: boolean, manual: boolean) => Promise<void>) {}

  async run(sessionId: string, final: boolean, manual = false): Promise<void> {
    const current = this.active.get(sessionId)
    if (current) {
      if (!final || current.final) return current.task
      const task = current.task.then(() => this.generate(sessionId, true, manual))
      const next = { task, final: true }
      this.active.set(sessionId, next)
      try { await task }
      finally { if (this.active.get(sessionId) === next) this.active.delete(sessionId) }
      return
    }
    const task = this.generate(sessionId, final, manual)
    const entry = { task, final }
    this.active.set(sessionId, entry)
    try { await task }
    finally { if (this.active.get(sessionId) === entry) this.active.delete(sessionId) }
  }
}
