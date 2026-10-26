/** Explicit Typert contract for this independently published third-party plugin.
 * Gateway requires strict input codecs; JSON results may use src-json. */
import type { TypertRemoteContribution, InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export interface MeetingView {
  sessionId: string
  phase: 'ready' | 'recording' | 'stopped' | 'interrupted'
  recording: boolean
  startedAt?: number
  transcript: number
  revision: number
  summary: string
  recognizerPhase: string
  transcriptText: string
  summaryUpdatedAt?: number
  nextSummaryAt?: number
  summaryBusy: boolean
  summaryDeferred: boolean
  error?: string
}
const codec = { mode: 'src-json' } as const
const sessionIdCodec = {
  mode: 'strict' as const,
  typeSymbol: '@ri0n72y/dsh-meeting#SessionId',
  create: () => ({
    parse(value: unknown): string {
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('sessionId must be a non-empty string')
      }
      return value
    },
  }),
}
const param = (name: string) => ({ name, wire: name, source: 'json' as const, codec: sessionIdCodec })
const methods: readonly InvocationDescriptor[] = [
  ...['snapshot', 'start', 'stop', 'summarize', 'prepare'].map(method => ({
    id: 'dsh-meeting-control.' + method, service: 'meetingControl', namespace: 'meeting',
    method, invocation: { kind: 'direct' as const }, parameters: [param('sessionId')], result: codec,
  })),
  { id: 'dsh-meeting-control.watch', service: 'meetingControl', namespace: 'meeting',
    method: 'watch', mode: 'stream', invocation: { kind: 'direct' }, parameters: [param('sessionId')],
    cancellation: { parameter: 'signal' }, result: codec },
]
export const contribution: TypertRemoteContribution = {
  package: '@ri0n72y/dsh-meeting',
  descriptors: methods,
}
