import { Context, Service } from "@deepseek-ai/cordis";
declare function sessionWorkspaceDirectory(cwd: string | undefined, host?: string): string;
declare function workspaceMeetingRoot(cwd: string | undefined, host?: string): string;
declare function sessionDirectoryName(id: string): string;
type MeetingPhase = 'recording' | 'interrupted' | 'stopped';
interface SpeakerTurn {
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerId: string | null;
}
interface MeetingLine {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speakerId: string | null;
  readonly turns?: readonly SpeakerTurn[];
}
interface MeetingSnapshot {
  readonly sessionId: string;
  readonly phase: MeetingPhase;
  readonly revision: number;
  readonly segments: readonly MeetingLine[];
  readonly interruption?: string;
}
/** The root is <Session.cwd>/.dsh-meeting, not global DSH_HOME. */
declare class MeetingStore {
  private readonly root;
  private readonly queues;
  constructor(root: string);
  directory(id: string): string;
  prepareAudio(id: string): Promise<string>;
  readDocument(id: string, filename: 'transcript.md' | 'summary.md'): Promise<string>;
  saveSummary(id: string, markdown: string): Promise<void>;
  read(id: string): Promise<MeetingSnapshot | null>;
  private update;
  begin(id: string): Promise<MeetingSnapshot>;
  /** Explicitly reclaim a Session whose prior Host no longer owns the capture. */
  resume(id: string): Promise<MeetingSnapshot>;
  append(id: string, line: MeetingLine): Promise<MeetingSnapshot>;
  finish(id: string): Promise<MeetingSnapshot>;
  interrupt(id: string, reason: string): Promise<MeetingSnapshot>;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    meetingContext: MeetingContext;
  }
}
declare class MeetingContext extends Service {
  static inject: string[];
  private readonly stores;
  constructor(ctx: Context);
  storeFor(sessionId: string): MeetingStore;
}
export { type MeetingLine, type MeetingSnapshot, MeetingStore, MeetingContext as default, sessionDirectoryName, sessionWorkspaceDirectory, workspaceMeetingRoot };