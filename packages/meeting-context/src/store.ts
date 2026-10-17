import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sessionDirectoryName, secureMeetingDirectory, secureAudioDirectory, verifyMeetingFile } from './workspace.js'

export type MeetingPhase = 'recording' | 'interrupted' | 'stopped'
export interface SpeakerTurn { readonly startMs: number; readonly endMs: number; readonly speakerId: string | null }
export interface MeetingLine {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
  readonly speakerId: string | null
  readonly turns?: readonly SpeakerTurn[]
}
export interface MeetingSnapshot {
  readonly sessionId: string
  readonly phase: MeetingPhase
  readonly revision: number
  readonly segments: readonly MeetingLine[]
  readonly interruption?: string
}

/** Session IDs are opaque DSH strings, never trusted as filesystem segments. */
export { sessionWorkspaceDirectory, workspaceMeetingRoot, sessionDirectoryName } from './workspace.js'
function validateLine(item: MeetingLine): void {
  if (!Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs)
    || item.startMs < 0 || item.endMs <= item.startMs || item.text.trim() === ''
    || item.text.length > 20_000 || (item.speakerId !== null && !/^Speaker [0-9]+$/.test(item.speakerId))) {
    throw new Error('Invalid meeting line')
  }
  for (const turn of item.turns ?? []) {
    if (!Number.isSafeInteger(turn.startMs) || !Number.isSafeInteger(turn.endMs)
      || turn.startMs < item.startMs || turn.endMs > item.endMs || turn.endMs <= turn.startMs
      || (turn.speakerId !== null && !/^Speaker [0-9]+$/.test(turn.speakerId))) {
      throw new Error('Invalid speaker turn')
    }
  }
}

/** The root is <Session.cwd>/.dsh-meeting, not global DSH_HOME. */
export class MeetingStore {
  private readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly root: string) {}
  directory(id: string): string { return join(this.root, sessionDirectoryName(id)) }
  async prepareAudio(id: string): Promise<string> { return secureAudioDirectory(this.root, id) }

  async read(id: string): Promise<MeetingSnapshot | null> {
    const dir = await secureMeetingDirectory(this.root, id, false)
    if (!dir) return null
    const path = join(dir, 'state.json')
    await verifyMeetingFile(dir, path)
    try {
      const snapshot = JSON.parse(await readFile(path, 'utf8')) as MeetingSnapshot
      if (snapshot.sessionId !== id) throw new Error('Mismatched persisted Session identity')
      return snapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private async update(id: string, mutation: (state: MeetingSnapshot | null) => MeetingSnapshot): Promise<MeetingSnapshot> {
    const prior = this.queues.get(id) ?? Promise.resolve()
    const task = prior.catch(() => undefined).then(async () => {
      const next = mutation(await this.read(id))
      const dir = await secureMeetingDirectory(this.root, id, true)
      if (!dir) throw new Error('Cannot create meeting directory')
      const path = join(dir, 'state.json')
      await verifyMeetingFile(dir, path)
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' })
        await rename(temporary, path)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      return next
    })
    this.queues.set(id, task)
    void task.finally(() => { if (this.queues.get(id) === task) this.queues.delete(id) }).catch(() => undefined)
    return task
  }
  async begin(id: string): Promise<MeetingSnapshot> {
    return this.update(id, state => {
      if (state?.phase === 'recording') throw new Error('Recording already active; use resume')
      if (state) throw new Error('Session meeting already exists; use resume if interrupted')
      return { sessionId: id, phase: 'recording', revision: 0, segments: [] }
    })
  }
  /** Explicitly reclaim a Session whose prior Host no longer owns the capture. */
  async resume(id: string): Promise<MeetingSnapshot> {
    return this.update(id, state => {
      if (!state || state.phase === 'stopped') throw new Error('No resumable meeting in Session')
      return { ...state, phase: 'recording', revision: state.revision + 1, interruption: undefined }
    })
  }
  async append(id: string, line: MeetingLine): Promise<MeetingSnapshot> {
    validateLine(line)
    return this.update(id, state => {
      if (state?.phase !== 'recording') throw new Error('Meeting is not recording')
      if (state.segments.length >= 20_000) throw new Error('Meeting segment limit reached')
      if (line.startMs < (state.segments.at(-1)?.startMs ?? 0)) throw new Error('Nonmonotonic meeting timeline')
      return { ...state, revision: state.revision + 1, segments: [...state.segments, line] }
    })
  }
  async finish(id: string): Promise<MeetingSnapshot> {
    return this.update(id, state => {
      if (!state) throw new Error('Meeting does not exist')
      if (state.phase === 'stopped') return state
      return { ...state, phase: 'stopped', revision: state.revision + 1, interruption: undefined }
    })
  }
  async interrupt(id: string, reason: string): Promise<MeetingSnapshot> {
    return this.update(id, state => {
      if (!state) throw new Error('Meeting does not exist')
      if (state.phase !== 'recording') return state
      return { ...state, phase: 'interrupted', revision: state.revision + 1, interruption: reason.slice(0, 500) }
    })
  }
}
