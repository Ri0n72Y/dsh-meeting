/** Explicit Typert contract for this independently published third-party plugin.
 * src-json codecs use the official Gateway's JSON boundary checks. */
import type { TypertRemoteContribution, InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export interface MeetingView {
  sessionId: string
  phase: 'ready' | 'recording' | 'stopped' | 'interrupted'
  recording: boolean
  startedAt?: number
  transcript: number
  revision: number
  summary: string
  transcriptText: string
  summaryUpdatedAt?: number
  nextSummaryAt?: number
  summaryBusy: boolean
  summaryDeferred: boolean
  error?: string
}
const codec = { mode: 'src-json' } as const
const param = (name: string) => ({ name, wire: name, source: 'json' as const, codec })
const methods: readonly InvocationDescriptor[] = [
  ...['snapshot', 'start', 'stop', 'summarize'].map(method => ({
    id: 'dsh-meeting-control.' + method, service: 'meetingControl', namespace: 'meeting',
    method, invocation: { kind: 'direct' as const }, parameters: [param('sessionId')], result: codec,
  })),
  { id: 'dsh-meeting-control.watch', service: 'meetingControl', namespace: 'meeting',
    method: 'watch', mode: 'stream', invocation: { kind: 'direct' }, parameters: [param('sessionId')],
    cancellation: { parameter: 'signal' }, result: codec },
]
export const contribution: TypertRemoteContribution = {
  package: '@ri0n72y/dsh-meeting-ui',
  descriptors: methods,
}
