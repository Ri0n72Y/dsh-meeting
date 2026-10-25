import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
/** Stateless embeddings in, stable anonymous labels out. One tracker per DSH Session. */
interface EmbeddingManager {
  search(request: {
    v: Float32Array;
    threshold: number;
  }): string;
  addMulti(request: {
    name: string;
    v: readonly Float32Array[];
  }): boolean;
}
interface EmbeddingEngine {
  embed(samples: Float32Array): Float32Array;
  manager(): EmbeddingManager;
}
declare class SpeakerTracker {
  private readonly engine;
  private readonly threshold;
  private readonly sessions;
  constructor(engine: EmbeddingEngine, threshold?: number);
  /** After restarting, do not reuse old labels without retaining voice embeddings. */
  seed(sessionId: string, next: number): void;
  identify(sessionId: string, samples: Float32Array): string | null;
  close(sessionId: string): void;
}
interface RelativeTurn {
  start: number;
  end: number;
  speaker: number;
}
interface SpeakerTurn {
  startMs: number;
  endMs: number;
  speakerId: string | null;
}
interface Segmenter {
  process(samples: Float32Array): readonly RelativeTurn[];
}
/** Upstream segmentation boundaries remain authoritative; labels are mapped across windows. */
declare class SpeakerTimeline {
  private readonly segmenter;
  private readonly tracker;
  constructor(segmenter: Segmenter, tracker: SpeakerTracker);
  diarize(sessionId: string, samples: Float32Array): SpeakerTurn[];
}
/** Thin adapters over upstream Node API. No Python server or custom clustering. */
declare function createSherpaEngine(modelPath: string): EmbeddingEngine;
declare function createSherpaSegmentation(segmentationModelPath: string, embeddingModelPath: string): Segmenter;
declare module '@deepseek-ai/cordis' {
  interface Context {
    meetingSpeaker: MeetingSpeaker;
  }
}
interface Config {
  modelPath: string;
  segmentationModelPath: string;
  threshold: number;
}
declare class MeetingSpeaker extends Service {
  private readonly config;
  static Config: z<Schemastery.ObjectS<NoInfer<{
    modelPath: z<string, string, "defined">;
    segmentationModelPath: z<string, string, "defined">;
    threshold: z<number, number, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    modelPath: z<string, string, "defined">;
    segmentationModelPath: z<string, string, "defined">;
    threshold: z<number, number, "defined">;
  }>>, "plain">;
  private tracker;
  private timeline;
  constructor(ctx: Context, config: Config);
  seed(sessionId: string, next: number): void;
  identify(sessionId: string, samples: Float32Array): string | null;
  diarize(sessionId: string, samples: Float32Array): SpeakerTurn[];
  forget(sessionId: string): void;
}
export { Config, type EmbeddingEngine, type EmbeddingManager, type Segmenter, SpeakerTimeline, SpeakerTracker, type SpeakerTurn, createSherpaEngine, createSherpaSegmentation, MeetingSpeaker as default };