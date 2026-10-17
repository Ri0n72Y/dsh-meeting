import type { MeetingStore } from './store.js'

/** Identity-based cache: an opaque Session ID alone cannot own Workspace state. */
export class SessionWorkspaceCache {
  private readonly stores = new Map<string, { owner: object; store: MeetingStore }>()
  get(owner: object, id: string, create: () => MeetingStore): MeetingStore {
    const current = this.stores.get(id)
    if (current?.owner === owner) return current.store
    const store = create()
    this.stores.set(id, { owner, store })
    return store
  }
  release(owner: object, id: string): void {
    if (this.stores.get(id)?.owner === owner) this.stores.delete(id)
  }
  clear(): void { this.stores.clear() }
}
