import { Service, type Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { MeetingStore } from './store.js'
export type { MeetingLine, MeetingSnapshot } from './store.js'
export { MeetingStore } from './store.js'

declare module '@deepseek-ai/cordis' {
  interface Context { meetingContext: MeetingContext }
}
export default class MeetingContext extends Service {
  static inject = ['tools']
  readonly store: MeetingStore

  constructor(ctx: Context) {
    super(ctx, 'meetingContext')
    this.store = new MeetingStore(dshHomePath('meeting', 'sessions'))
    ctx.tools.register(defineTool({
      name: 'meeting_status',
      description: 'Read the current DSH Session meeting phase, lines, speaker labels and latest transcript.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        if (!exec.agent) throw new Error('Meeting status requires a DSH Session')
        const meeting = await this.store.read(exec.agent.id)
        if (!meeting) return 'No meeting has been started in this DSH Session.'
        return JSON.stringify({
          sessionId: meeting.sessionId, phase: meeting.phase, revision: meeting.revision,
          segments: meeting.segments.length, speakers: [...new Set(meeting.segments.map(s => s.speakerId).filter(Boolean))],
          latest: meeting.segments.slice(-5),
        }, null, 2)
      },
    }))
  }
}
