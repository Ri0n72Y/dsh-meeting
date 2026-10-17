import { createRequire } from 'node:module'
import type { EmbeddingEngine, EmbeddingManager } from './tracker.js'
import type { Segmenter, RelativeTurn } from './timeline.js'

interface SherpaModule {
  SpeakerEmbeddingExtractor: new (config: { model: string; numThreads: number; debug: boolean }) => {
    dim: number
    createStream(): { acceptWaveform(data: { sampleRate: number; samples: Float32Array }): void }
    compute(stream: unknown): Float32Array
  }
  SpeakerEmbeddingManager: new (dim: number) => EmbeddingManager
  OfflineSpeakerDiarization: new (config: object) => {
    process(samples: Float32Array): RelativeTurn[]
  }
}
function module(): SherpaModule {
  return createRequire(import.meta.url)('sherpa-onnx-node') as SherpaModule
}
/** Thin adapters over upstream Node API. No Python server or custom clustering. */
export function createSherpaEngine(modelPath: string): EmbeddingEngine {
  const sherpa = module()
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1, debug: false })
  return {
    embed(samples) {
      const stream = extractor.createStream()
      stream.acceptWaveform({ sampleRate: 16000, samples })
      return extractor.compute(stream)
    },
    manager: () => new sherpa.SpeakerEmbeddingManager(extractor.dim),
  }
}
export function createSherpaSegmentation(segmentationModelPath: string, embeddingModelPath: string): Segmenter {
  const sherpa = module()
  return new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationModelPath, windowShiftRatio: 0.1 } },
    embedding: { model: embeddingModelPath },
    clustering: { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  })
}
