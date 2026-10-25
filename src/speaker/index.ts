import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SpeakerTracker } from './tracker.js'
import { SpeakerTimeline, type SpeakerTurn } from './timeline.js'
import { createSherpaEngine, createSherpaSegmentation } from './sherpa.js'
export { SpeakerTracker } from './tracker.js'
export type { EmbeddingEngine, EmbeddingManager } from './tracker.js'
export { SpeakerTimeline } from './timeline.js'
export type { SpeakerTurn, Segmenter } from './timeline.js'
export { createSherpaEngine, createSherpaSegmentation } from './sherpa.js'

declare module '@deepseek-ai/cordis' {
  interface Context { meetingSpeaker: MeetingSpeaker }
}
export interface Config { modelPath: string; segmentationModelPath: string; threshold: number }

export default class MeetingSpeaker extends Service {
  static Config = z.object({
    modelPath: z.string().default(''),
    segmentationModelPath: z.string().default(''),
    threshold: z.number().min(0).max(1).default(0.6),
  })
  private tracker: SpeakerTracker | null = null
  private timeline: SpeakerTimeline | null = null
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'meetingSpeaker') }
  seed(sessionId: string, next: number): void {
    if (!this.config.modelPath.trim()) return
    this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold)
    this.tracker.seed(sessionId, next)
  }
  identify(sessionId: string, samples: Float32Array): string | null {
    if (!this.config.modelPath.trim()) return null
    this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold)
    return this.tracker.identify(sessionId, samples)
  }
  diarize(sessionId: string, samples: Float32Array): SpeakerTurn[] {
    if (!this.config.modelPath.trim() || !this.config.segmentationModelPath.trim()) return []
    this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold)
    this.timeline ??= new SpeakerTimeline(
      createSherpaSegmentation(this.config.segmentationModelPath, this.config.modelPath), this.tracker)
    return this.timeline.diarize(sessionId, samples)
  }
  forget(sessionId: string): void { this.tracker?.close(sessionId) }
}
