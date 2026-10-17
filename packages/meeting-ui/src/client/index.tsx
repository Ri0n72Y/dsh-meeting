/** Official DSH Sidebar type and keyed body; no independent window or visual framework. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MeetingBody } from './MeetingBody.js'
import { contribution } from '../remote.js'
import type { MeetingView } from '../remote.js'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export interface MeetingClientRemote {
  snapshot(id: string): Promise<RemoteResult<MeetingView>>
  start(id: string): Promise<RemoteResult<MeetingView>>
  stop(id: string): Promise<RemoteResult<MeetingView>>
  summarize(id: string): Promise<RemoteResult<MeetingView>>
  watch(id: string, signal: AbortSignal): AsyncIterable<RemoteResult<MeetingView>>
}
export const inject = ['slots', 'sidebarRightTabs', 'remote', 'remote.meeting']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.remote.$mount(contribution), 'meeting-ui: typed Remote')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: '@ri0n72y/dsh-meeting-ui', kind: 'meeting', priority: 'extension',
    title: () => '会议',
    guide: [{ id: 'meeting', order: 30, title: () => '会议录音',
      description: () => '录制系统声音，实时查看原文与会议总结' }],
  }), 'meeting-ui: Sidebar tab')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: '@ri0n72y/dsh-meeting-ui',
      inject: () => ({ meetingRemote: (ctx.remote as unknown as { meeting: MeetingClientRemote }).meeting }),
    }, MeetingBody)), 'meeting-ui: Sidebar body')
}
