import z from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
interface MeetingView {
  sessionId: string;
  phase: 'ready' | 'recording' | 'stopped' | 'interrupted';
  recording: boolean;
  startedAt?: number;
  transcript: number;
  revision: number;
  summary: string;
  recognizerPhase: string;
  transcriptText: string;
  summaryUpdatedAt?: number;
  nextSummaryAt?: number;
  summaryBusy: boolean;
  summaryDeferred: boolean;
  error?: string;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    meetingControl: MeetingControl;
  }
}
interface Config {
  summaryIntervalMs: number;
}
declare class MeetingControl extends TypertRemoteService {
  private readonly config;
  static inject: string[];
  static Config: z<Config>;
  private readonly live;
  private readonly summaryJobs;
  private starting;
  private readonly deferredTimers;
  private readonly state;
  constructor(ctx: Context, config: Config);
  snapshot(sessionId: string): Promise<MeetingView>;
  watch(sessionId: string, signal: AbortSignal): AsyncIterable<MeetingView>;
  start(sessionId: string): Promise<MeetingView>;
  private close;
  stop(sessionId: string): Promise<MeetingView>;
  prepare(sessionId: string): Promise<MeetingView>;
  summarize(sessionId: string): Promise<MeetingView>;
  private clearDeferredTimer;
  /** Retry only Agent-busy deferrals; paid model failures require manual retry. */
  private deferSummary;
  private tick;
  private generate;
}
export { Config, MeetingControl as default };