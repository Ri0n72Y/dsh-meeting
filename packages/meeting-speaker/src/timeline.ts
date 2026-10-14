import type { SpeakerTracker } from './tracker.js'
export interface RelativeTurn { start: number; end: number; speaker: number }
export interface SpeakerTurn {
  startMs: number
  endMs: number
  speakerId: string | null
}
export interface Segmenter {
  process(samples: Float32Array): readonly RelativeTurn[]
}
/** Upstream segmentation boundaries remain authoritative; labels are mapped across windows. */
export class SpeakerTimeline {
  constructor(private readonly segmenter: Segmenter, private readonly tracker: SpeakerTracker) {}
  diarize(sessionId: string, samples: Float32Array): SpeakerTurn[] {
    return this.segmenter.process(samples).flatMap(turn => {
      const start = Math.max(0, Math.round(turn.start * 16000))
      const end = Math.min(samples.length, Math.round(turn.end * 16000))
      if (end <= start) return []
      const speakerId = this.tracker.identify(sessionId, samples.subarray(start, end))
      return [{ startMs: Math.round(start / 16), endMs: Math.round(end / 16), speakerId }]
    })
  }
}
