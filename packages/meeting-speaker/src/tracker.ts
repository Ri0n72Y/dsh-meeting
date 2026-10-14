/** Stateless embeddings in, stable anonymous labels out. One tracker per DSH Session. */
export interface EmbeddingManager {
  search(request: { v: Float32Array; threshold: number }): string
  addMulti(request: { name: string; v: readonly Float32Array[] }): boolean
}
export interface EmbeddingEngine {
  embed(samples: Float32Array): Float32Array
  manager(): EmbeddingManager
}
export class SpeakerTracker {
  private readonly sessions = new Map<string, { manager: EmbeddingManager; next: number }>()
  constructor(private readonly engine: EmbeddingEngine, private readonly threshold = 0.6) {}
  identify(sessionId: string, samples: Float32Array): string | null {
    if (samples.length < 1600) return null
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { manager: this.engine.manager(), next: 1 }
      this.sessions.set(sessionId, state)
    }
    const embedding = this.engine.embed(samples)
    if (embedding.length === 0 || !embedding.every(Number.isFinite)) return null
    const existing = state.manager.search({ v: embedding, threshold: this.threshold })
    if (existing) return existing
    const name = 'Speaker ' + state.next
    if (!state.manager.addMulti({ name, v: [embedding] })) return null
    state.next += 1
    return name
  }
  close(sessionId: string): void { this.sessions.delete(sessionId) }
}
