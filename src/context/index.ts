import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { MeetingStore, sessionDirectoryName, workspaceMeetingRoot } from './store.js'
import { SessionWorkspaceCache } from './cache.js'
export type { MeetingLine, MeetingSnapshot } from './store.js'
export { MeetingStore, sessionWorkspaceDirectory, workspaceMeetingRoot, sessionDirectoryName } from './store.js'
export { transcriptParagraphs, transcriptTimestamp } from './transcript.js'

declare module '@deepseek-ai/cordis' {
  interface Context { meetingContext: MeetingContext }
}
export default class MeetingContext extends Service {
  static inject = ['tools', 'sessions']
  private readonly stores = new SessionWorkspaceCache()
  constructor(ctx: Context) {
    super(ctx, 'meetingContext')
    ctx.on('session/disposed', session => { this.stores.release(session, session.header.id) })
    ctx.effect(() => () => { this.stores.clear() }, 'meeting-context: dispose stores')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'meeting_status',
      description: 'Read the DSH Session meeting phase, segments, speaker labels and recent transcript.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        if (!exec.agent) throw new Error('Meeting status requires a DSH Session')
        const id = exec.agent.session.header.id
        const meeting = await this.storeFor(id).read(id)
        if (!meeting) return 'No meeting has been started in this DSH Session.'
        return JSON.stringify({
          sessionId: meeting.sessionId, phase: meeting.phase, revision: meeting.revision,
          ...(meeting.interruption ? { interruption: meeting.interruption } : {}),
          segments: meeting.segments.length,
          speakers: [...new Set(meeting.segments.flatMap(s =>
            [s.speakerId, ...(s.turns ?? []).map(turn => turn.speakerId)].filter((x): x is string => x !== null)))],
          latest: meeting.segments.slice(-5),
        }, null, 2)
      },
    })), 'meeting-context: status tool')
  }
  storeFor(sessionId: string): MeetingStore {
    sessionDirectoryName(sessionId)
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (!session) throw new Error('Meeting requires a live DSH Session')
    return this.stores.get(session, sessionId, () =>
      new MeetingStore(workspaceMeetingRoot(session.header.cwd)))
  }
}
