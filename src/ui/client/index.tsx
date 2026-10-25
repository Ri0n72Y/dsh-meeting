/** Official right Sidebar extension: mount Remote before dependent tabs. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MeetingBody } from './MeetingBody.js'
import { contribution } from '../remote.js'
import type { MeetingView } from '../remote.js'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'

export interface MeetingClientRemote {
  snapshot(id: string): Promise<RemoteResult<MeetingView>>
  start(id: string): Promise<RemoteResult<MeetingView>>
  stop(id: string): Promise<RemoteResult<MeetingView>>
  summarize(id: string): Promise<RemoteResult<MeetingView>>
  prepare(id: string): Promise<RemoteResult<MeetingView>>
  watch(id: string, signal: AbortSignal): RemoteStreamHandle<MeetingView, never>
}
declare module '@deepseek-ai/cordis' {
  interface Context { 'remote.meeting': MeetingClientRemote }
}
export const inject = ['remote', 'slots', 'sidebarRightTabs']

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: '@ri0n72y/dsh-meeting', kind: 'meeting', priority: 'extension',
    title: () => '会议',
    guide: [{ id: 'meeting', order: 30, title: () => '会议录音',
      description: () => '录制系统声音，实时查看原文与会议总结' }],
  }), 'meeting-ui: Sidebar tab')
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: '@ri0n72y/dsh-meeting',
      inject: () => ({ meetingRemote: (ctx.remote as unknown as { meeting: MeetingClientRemote }).meeting }),
    }, MeetingBody))
}

/** Same two-step lifecycle as official DSH Voice Input client plugin. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.meeting', 'slots', 'sidebarRightTabs'], registerUi)
  try { await ui }
  catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => { await ui.dispose(); await disposeRemote() }
}
