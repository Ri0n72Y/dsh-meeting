import { Context, Service } from "@deepseek-ai/cordis";
interface SpeakerTurn {
  startMs: number;
  endMs: number;
  speakerId: string | null;
}
interface CapturedLine {
  startMs: number;
  endMs: number;
  text: string;
  speakerId: string | null;
  turns?: readonly SpeakerTurn[];
}
interface CapturePorts {
  /** Persist each accepted window before adding it to the bounded ASR queue. */
  persist(wav: Uint8Array, startMs: number, endMs: number, signal: AbortSignal): Promise<void>;
  process(wav: Uint8Array, samples: Float32Array, startMs: number, endMs: number, signal: AbortSignal): Promise<CapturedLine | null>;
}
interface CaptureReceipt {
  captured: number;
  processed: number;
  silent: number;
  interrupted: boolean;
  errors: string[];
  lines: CapturedLine[];
}
interface CaptureOptions {
  /** Total PCM samples durably persisted before a recovered recording starts. */
  offsetSamples?: number;
  /** Maximum simultaneous in-flight + waiting transcription windows. */
  maxQueuedWindows?: number;
  signal?: AbortSignal;
}
/** Await push() for durable ingestion. Recognition runs in a bounded independent lane. */
declare class ContinuousCapture {
  private readonly ports;
  private pending;
  private consumed;
  private readonly queue;
  private worker;
  private feeding;
  private stopTask;
  private readonly controller;
  /** Cancellation stops ASR/intake, never an already accepted audio disk write. */
  private readonly disk;
  private readonly waiters;
  private readonly receipt;
  private readonly capacity;
  private fatal;
  private ended;
  private readonly upstream?;
  constructor(ports: CapturePorts, options?: CaptureOptions);
  private upstreamAbort;
  private get signal();
  private wake;
  private slot;
  private processQueue;
  private acceptWindow;
  /** Drain accepted PCM on cancellation without restarting ASR or relying on the aborted intake signal. */
  private persistCancelledTail;
  /** Caller must await every push; overlapping pushes are explicitly rejected. */
  push(samples: Float32Array): Promise<void>;
  private accept;
  cancel(reason?: unknown): void;
  stop(): Promise<CaptureReceipt>;
  private finish;
}
declare const SAMPLE_RATE = 16000;
declare function encodeWav(samples: Float32Array): Uint8Array;
declare function decodeWav(bytes: Uint8Array): Float32Array;
/** Reconstruct timeline from committed PCM files rather than a stale process counter. */
declare function audioCheckpoint(dir: string): Promise<{
  nextIndex: number;
  offsetSamples: number;
}>;
declare function saveAudioWindow(dir: string, index: number, wav: Uint8Array, signal: AbortSignal): Promise<void>;
interface NativeLoopback {
  startSystemAudio(onChunk: (pcm48kStereo: Buffer | number | null) => void): void;
  stop(): void;
}
/** Signed 16-bit stereo 48 kHz -> mono 16 kHz; 3-frame decimation with averaging.
 * The simple low-pass is intentionally bounded and streaming-safe. */
declare function downmix48k(chunk: Buffer): Float32Array;
/** Delivery through one awaitable lane, with bounded native callback buffering.
 * Overrun is an explicit failure, not unbounded memory usage or silent data loss. */
declare class WindowsLoopback {
  private readonly push;
  private readonly onError;
  private readonly createNative?;
  private native;
  private readonly queued;
  private pending;
  private draining;
  private error;
  private stopped;
  private failedIntake;
  private stopTask;
  private nativeEnd;
  private resolveNativeEnd;
  private samples;
  private carry;
  constructor(push: (samples: Float32Array) => Promise<void>, onError: (error: Error) => void, createNative?: (() => NativeLoopback) | undefined);
  start(): void;
  private queueItem;
  private enqueue;
  /** A native gap is a count of missing 48 kHz frames, not an allocated PCM buffer. */
  private queueSilence;
  private startDrain;
  private drain;
  private fail;
  stop(): Promise<{
    samples: number;
    error?: string;
  }>;
  private finish;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    meetingCapture: MeetingCapture;
  }
}
declare class MeetingCapture extends Service {
  static inject: string[];
  private readonly active;
  private readonly starting;
  private readonly sourceClosers;
  constructor(ctx: Context);
  disposeSession(id: string): Promise<void>;
  registerSourceCloser(id: string, closer: () => Promise<void>): () => void;
  start(sessionId: string, options?: Pick<CaptureOptions, 'signal'>): Promise<ContinuousCapture>;
  /** Await each push for durable audio ingestion and built-in ASR backpressure. */
  push(sessionId: string, samples: Float32Array): Promise<void>;
  stop(sessionId: string): Promise<CaptureReceipt>;
}
export { type CaptureOptions, type CapturePorts, type CaptureReceipt, type CapturedLine, ContinuousCapture, SAMPLE_RATE, type SpeakerTurn, WindowsLoopback, audioCheckpoint, decodeWav, MeetingCapture as default, downmix48k, encodeWav, saveAudioWindow };