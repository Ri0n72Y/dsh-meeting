import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type MeetingPhase = 'recording' | 'stopped'
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
}

function validSessionId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid DSH Session id')
}
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

export class MeetingStore {
  private readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly root: string) {}
  private path(id: string): string { validSessionId(id); return join(this.root, id, 'state.json') }
  async read(id: string): Promise<MeetingSnapshot | null> {
    try { return JSON.parse(await readFile(this.path(id), 'utf8')) as MeetingSnapshot }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private async update(id: string, mutation: (state: MeetingSnapshot | null) => MeetingSnapshot): Promise<MeetingSnapshot> {
    const prior = this.queues.get(id) ?? Promise.resolve()
    const task = prior.catch(() => undefined).then(async () => {
      const next = mutation(await this.read(id))
      const path = this.path(id)
      await mkdir(join(this.root, id), { recursive: true })
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' })
        await rename(temporary, path)
      } catch (error) {
        const { rm } = await import('node:fs/promises')
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
      if (state?.phase === 'recording') throw new Error('Recording already active')
      if (state) throw new Error('Session meeting already ended; create another DSH Session')
      return { sessionId: id, phase: 'recording', revision: 0, segments: [] }
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
      return { ...state, phase: 'stopped', revision: state.revision + 1 }
    })
  }
}
