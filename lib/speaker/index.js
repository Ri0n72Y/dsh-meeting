import { createRequire } from "node:module";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
// src/speaker/tracker.ts
var SpeakerTracker = class {
	engine;
	threshold;
	sessions = /* @__PURE__ */ new Map();
	constructor(engine, threshold = .6) {
		this.engine = engine;
		this.threshold = threshold;
	}
	/** After restarting, do not reuse old labels without retaining voice embeddings. */
	seed(sessionId, next) {
		if (!Number.isSafeInteger(next) || next < 1) throw new Error("Invalid next speaker number");
		if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, {
			manager: this.engine.manager(),
			next
		});
	}
	identify(sessionId, samples) {
		if (samples.length < 1600) return null;
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = {
				manager: this.engine.manager(),
				next: 1
			};
			this.sessions.set(sessionId, state);
		}
		const embedding = this.engine.embed(samples);
		if (embedding.length === 0 || !embedding.every(Number.isFinite)) return null;
		const existing = state.manager.search({
			v: embedding,
			threshold: this.threshold
		});
		if (existing) return existing;
		const name = "Speaker " + state.next;
		if (!state.manager.addMulti({
			name,
			v: [embedding]
		})) return null;
		state.next += 1;
		return name;
	}
	close(sessionId) {
		this.sessions.delete(sessionId);
	}
};
// src/speaker/timeline.ts
/** Upstream segmentation boundaries remain authoritative; labels are mapped across windows. */
var SpeakerTimeline = class {
	segmenter;
	tracker;
	constructor(segmenter, tracker) {
		this.segmenter = segmenter;
		this.tracker = tracker;
	}
	diarize(sessionId, samples) {
		return this.segmenter.process(samples).flatMap((turn) => {
			const start = Math.max(0, Math.round(turn.start * 16e3));
			const end = Math.min(samples.length, Math.round(turn.end * 16e3));
			if (end <= start) return [];
			const speakerId = this.tracker.identify(sessionId, samples.subarray(start, end));
			return [{
				startMs: Math.round(start / 16),
				endMs: Math.round(end / 16),
				speakerId
			}];
		});
	}
};
// src/speaker/sherpa.ts
function module() {
	return createRequire(import.meta.url)("sherpa-onnx-node");
}
/** Thin adapters over upstream Node API. No Python server or custom clustering. */
function createSherpaEngine(modelPath) {
	const sherpa = module();
	const extractor = new sherpa.SpeakerEmbeddingExtractor({
		model: modelPath,
		numThreads: 1,
		debug: false
	});
	return {
		embed(samples) {
			const stream = extractor.createStream();
			stream.acceptWaveform({
				sampleRate: 16e3,
				samples
			});
			return extractor.compute(stream);
		},
		manager: () => new sherpa.SpeakerEmbeddingManager(extractor.dim)
	};
}
function createSherpaSegmentation(segmentationModelPath, embeddingModelPath) {
	return new (module()).OfflineSpeakerDiarization({
		segmentation: { pyannote: {
			model: segmentationModelPath,
			windowShiftRatio: .1
		} },
		embedding: { model: embeddingModelPath },
		clustering: {
			numClusters: -1,
			threshold: .5
		},
		minDurationOn: .2,
		minDurationOff: .5
	});
}
// src/speaker/index.ts
var MeetingSpeaker = class extends Service {
	config;
	static Config = z.object({
		modelPath: z.string().default(""),
		segmentationModelPath: z.string().default(""),
		threshold: z.number().min(0).max(1).default(.6)
	});
	tracker = null;
	timeline = null;
	constructor(ctx, config) {
		super(ctx, "meetingSpeaker");
		this.config = config;
	}
	seed(sessionId, next) {
		if (!this.config.modelPath.trim()) return;
		this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold);
		this.tracker.seed(sessionId, next);
	}
	identify(sessionId, samples) {
		if (!this.config.modelPath.trim()) return null;
		this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold);
		return this.tracker.identify(sessionId, samples);
	}
	diarize(sessionId, samples) {
		if (!this.config.modelPath.trim() || !this.config.segmentationModelPath.trim()) return [];
		this.tracker ??= new SpeakerTracker(createSherpaEngine(this.config.modelPath), this.config.threshold);
		this.timeline ??= new SpeakerTimeline(createSherpaSegmentation(this.config.segmentationModelPath, this.config.modelPath), this.tracker);
		return this.timeline.diarize(sessionId, samples);
	}
	forget(sessionId) {
		this.tracker?.close(sessionId);
	}
};
export { SpeakerTimeline, SpeakerTracker, createSherpaEngine, createSherpaSegmentation, MeetingSpeaker as default };
