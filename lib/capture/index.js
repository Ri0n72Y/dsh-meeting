import { createRequire } from "node:module";
import { link, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { sessionWorkspaceDirectory } from "@ri0n72y/dsh-meeting/context";
import { randomUUID } from "node:crypto";
// src/capture/lifecycle.ts
/** Session-scoped capture ownership; cleanup can outlive DSH's live Session map. */
var SessionCaptureRegistry = class {
	active = /* @__PURE__ */ new Map();
	stopping = /* @__PURE__ */ new Map();
	get(id) {
		return this.active.get(id)?.capture;
	}
	has(id) {
		return this.active.has(id);
	}
	keys() {
		return [...this.active.keys()];
	}
	add(id, lease) {
		if (this.has(id) || this.stopping.has(id)) throw new Error("Session capture already active");
		this.active.set(id, lease);
	}
	stop(id) {
		const inflight = this.stopping.get(id);
		if (inflight) return inflight;
		const lease = this.active.get(id);
		if (!lease) return Promise.reject(/* @__PURE__ */ new Error("Session capture is not active"));
		const task = (async () => {
			try {
				const receipt = await lease.capture.stop();
				await lease.settle(receipt);
				return receipt;
			} finally {
				if (this.active.get(id) === lease) this.active.delete(id);
				this.stopping.delete(id);
				lease.release();
			}
		})();
		this.stopping.set(id, task);
		return task;
	}
	async cancel(id, reason) {
		const lease = this.active.get(id);
		if (!lease) return;
		lease.capture.cancel(reason);
		await this.stop(id);
	}
	async cancelAll(reason) {
		await Promise.allSettled(this.keys().map((id) => this.cancel(id, reason)));
	}
};
// src/capture/wav.ts
const SAMPLE_RATE = 16e3;
function encodeWav(samples) {
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	const tag = (offset, value) => {
		for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
	};
	tag(0, "RIFF");
	view.setUint32(4, bytes.length - 8, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	tag(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const value = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
	}
	return bytes;
}
function decodeWav(bytes) {
	if (bytes.length < 44 || bytes.length % 2 !== 0) throw new Error("Invalid PCM WAV length");
	const text = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (text(0) !== "RIFF" || text(8) !== "WAVE" || text(12) !== "fmt " || text(36) !== "data" || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16e3 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44) throw new Error("Expected canonical mono PCM16 16 kHz WAV");
	const samples = new Float32Array((bytes.length - 44) / 2);
	for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
	return samples;
}
// src/capture/continuous.ts
const WINDOW = 5 * SAMPLE_RATE;
const MAX_INPUT = 10 * SAMPLE_RATE;
const MIN_ASR_TAIL = Math.round(.35 * SAMPLE_RATE);
const RMS_GATE = .008;
/** Detect local 100ms activity: whole-window RMS hides isolated phrases. */
function audible(samples) {
	const FRAME = Math.round(SAMPLE_RATE / 10);
	for (let start = 0; start < samples.length; start += FRAME) {
		const end = Math.min(samples.length, start + FRAME);
		let energy = 0;
		for (let i = start; i < end; i++) energy += samples[i] * samples[i];
		if (Math.sqrt(energy / (end - start)) >= RMS_GATE) return true;
	}
	return false;
}
/** Await push() for durable ingestion. Recognition runs in a bounded independent lane. */
var ContinuousCapture = class {
	ports;
	pending = /* @__PURE__ */ new Float32Array(0);
	consumed;
	queue = [];
	worker = null;
	feeding = null;
	stopTask = null;
	controller = new AbortController();
	/** Cancellation stops ASR/intake, never an already accepted audio disk write. */
	disk = new AbortController();
	waiters = /* @__PURE__ */ new Set();
	receipt = {
		captured: 0,
		processed: 0,
		silent: 0,
		interrupted: false,
		errors: [],
		lines: []
	};
	capacity;
	fatal = false;
	ended = false;
	upstream;
	constructor(ports, options = {}) {
		this.ports = ports;
		this.consumed = options.offsetSamples ?? 0;
		this.capacity = options.maxQueuedWindows ?? 4;
		if (!Number.isSafeInteger(this.consumed) || this.consumed < 0 || !Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new Error("Invalid capture options");
		this.upstream = options.signal;
		if (options.signal?.aborted) this.cancel(options.signal.reason);
		else options.signal?.addEventListener("abort", this.upstreamAbort, { once: true });
	}
	upstreamAbort = () => {
		this.cancel(this.upstream?.reason);
	};
	get signal() {
		return this.controller.signal;
	}
	wake() {
		for (const wake of this.waiters) wake();
		this.waiters.clear();
	}
	async slot() {
		while ((this.worker === null ? 0 : 1) + this.queue.length >= this.capacity) {
			this.signal.throwIfAborted();
			await new Promise((resolve) => {
				this.waiters.add(resolve);
			});
		}
		this.signal.throwIfAborted();
	}
	processQueue() {
		if (this.worker || this.queue.length === 0) return;
		const task = (async () => {
			while (this.queue.length > 0) {
				const { wav, samples, startMs, endMs } = this.queue.shift();
				try {
					this.signal.throwIfAborted();
					const line = await this.ports.process(wav, samples, startMs, endMs, this.signal);
					this.signal.throwIfAborted();
					this.receipt.processed++;
					if (line) this.receipt.lines.push(line);
				} catch (error) {
					if (!this.signal.aborted) this.receipt.errors.push("ASR at " + startMs + "ms: " + String(error));
				} finally {
					this.wake();
				}
			}
		})();
		this.worker = task.finally(() => {
			this.worker = null;
			this.wake();
			if (this.queue.length > 0) this.processQueue();
		});
	}
	async acceptWindow(samples) {
		const speech = samples.length >= MIN_ASR_TAIL && audible(samples);
		if (speech) await this.slot();
		this.signal.throwIfAborted();
		const startMs = Math.round(this.consumed * 1e3 / SAMPLE_RATE);
		const endMs = Math.round((this.consumed + samples.length) * 1e3 / SAMPLE_RATE);
		const wav = encodeWav(samples);
		try {
			await this.ports.persist(wav, startMs, endMs, this.disk.signal);
		} catch (error) {
			this.receipt.errors.push("Audio persistence at " + startMs + "ms: " + String(error));
			this.fatal = true;
			this.cancel(error);
			throw error;
		}
		this.consumed += samples.length;
		this.receipt.captured++;
		if (!speech) {
			this.receipt.silent++;
			return;
		}
		this.queue.push({
			wav,
			samples,
			startMs,
			endMs
		});
		this.processQueue();
	}
	/** Drain accepted PCM on cancellation without restarting ASR or relying on the aborted intake signal. */
	async persistCancelledTail(samples) {
		const startMs = Math.round(this.consumed * 1e3 / SAMPLE_RATE);
		const endMs = Math.round((this.consumed + samples.length) * 1e3 / SAMPLE_RATE);
		try {
			await this.ports.persist(encodeWav(samples), startMs, endMs, this.disk.signal);
			this.consumed += samples.length;
			this.receipt.captured++;
			if (!audible(samples)) this.receipt.silent++;
		} catch (error) {
			this.receipt.errors.push("Audio persistence at " + startMs + "ms: " + String(error));
			this.fatal = true;
			this.receipt.interrupted = true;
		}
	}
	/** Caller must await every push; overlapping pushes are explicitly rejected. */
	push(samples) {
		if (this.ended) return Promise.reject(/* @__PURE__ */ new Error("Capture is stopped"));
		if (this.feeding) return Promise.reject(/* @__PURE__ */ new Error("Concurrent push: await the previous PCM frame"));
		if (samples.length > MAX_INPUT || !samples.every(Number.isFinite)) return Promise.reject(/* @__PURE__ */ new Error("Invalid PCM frame (max 10 seconds at 16 kHz)"));
		const task = this.accept(samples.slice());
		this.feeding = task;
		task.finally(() => {
			if (this.feeding === task) this.feeding = null;
		}).catch(() => void 0);
		return task;
	}
	async accept(samples) {
		let cursor = 0;
		while (cursor < samples.length) {
			this.signal.throwIfAborted();
			const count = Math.min(WINDOW - this.pending.length, samples.length - cursor);
			const merged = new Float32Array(this.pending.length + count);
			merged.set(this.pending);
			merged.set(samples.subarray(cursor, cursor + count), this.pending.length);
			this.pending = merged;
			cursor += count;
			if (this.pending.length === WINDOW) {
				const window = this.pending;
				await this.acceptWindow(window);
				this.pending = /* @__PURE__ */ new Float32Array(0);
			}
		}
	}
	cancel(reason) {
		if (!this.signal.aborted) this.controller.abort(reason ?? /* @__PURE__ */ new Error("Capture cancelled"));
		this.receipt.interrupted = true;
		this.wake();
	}
	stop() {
		this.stopTask ??= this.finish();
		return this.stopTask;
	}
	async finish() {
		this.ended = true;
		try {
			await this.feeding?.catch(() => void 0);
			if (this.pending.length && !this.fatal) {
				const tail = this.pending;
				this.pending = /* @__PURE__ */ new Float32Array(0);
				if (this.signal.aborted) await this.persistCancelledTail(tail);
				else await this.acceptWindow(tail).catch(() => void 0);
			}
			while (this.worker) await this.worker;
			if (this.signal.aborted || this.fatal) this.receipt.interrupted = true;
			return {
				...this.receipt,
				lines: [...this.receipt.lines],
				errors: [...this.receipt.errors]
			};
		} finally {
			this.upstream?.removeEventListener("abort", this.upstreamAbort);
		}
	}
};
// src/capture/audio-files.ts
const NAME = /^([0-9]{6})\.wav$/;
/** Reconstruct timeline from committed PCM files rather than a stale process counter. */
async function audioCheckpoint(dir) {
	const files = (await readdir(dir, { withFileTypes: true }).catch((error) => {
		if (error.code === "ENOENT") return [];
		throw error;
	})).filter((item) => item.isFile() && NAME.test(item.name)).map((item) => item.name).sort();
	let offsetSamples = 0;
	for (let i = 0; i < files.length; i++) {
		if (files[i] !== String(i).padStart(6, "0") + ".wav") throw new Error("Non-contiguous meeting audio sequence; refusing unsafe resume");
		const path = join(dir, files[i]);
		const info = await stat(path);
		if (info.size < 44 || (info.size - 44) % 2 !== 0) throw new Error("Invalid persisted meeting PCM length");
		const handle = await open(path, "r");
		try {
			const header = Buffer.alloc(44);
			if ((await handle.read(header, 0, 44, 0)).bytesRead !== 44 || header.toString("ascii", 0, 4) !== "RIFF" || header.readUInt32LE(4) !== info.size - 8 || header.toString("ascii", 8, 12) !== "WAVE" || header.toString("ascii", 12, 16) !== "fmt " || header.readUInt32LE(16) !== 16 || header.readUInt16LE(20) !== 1 || header.readUInt16LE(22) !== 1 || header.readUInt32LE(24) !== 16e3 || header.readUInt32LE(28) !== 32e3 || header.readUInt16LE(32) !== 2 || header.readUInt16LE(34) !== 16 || header.toString("ascii", 36, 40) !== "data" || header.readUInt32LE(40) !== info.size - 44) throw new Error("Corrupt persisted meeting audio: " + files[i]);
		} finally {
			await handle.close();
		}
		offsetSamples += (info.size - 44) / 2;
		if (!Number.isSafeInteger(offsetSamples)) throw new Error("Persisted meeting sample count exceeds safe integer range");
	}
	return {
		nextIndex: files.length,
		offsetSamples
	};
}
async function saveAudioWindow(dir, index, wav, signal) {
	signal.throwIfAborted();
	await mkdir(dir, { recursive: true });
	const target = join(dir, String(index).padStart(6, "0") + ".wav");
	const temporary = target + "." + randomUUID() + ".tmp";
	try {
		await writeFile(temporary, wav, {
			flag: "wx",
			signal
		});
		signal.throwIfAborted();
		await link(temporary, target);
		await rm(temporary, { force: true }).catch(() => void 0);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => void 0);
		throw error;
	}
}
// src/capture/windows-loopback.ts
/** Host-only Windows default-output WASAPI loopback. No microphone or browser capture. */
const require = createRequire(import.meta.url);
/** Signed 16-bit stereo 48 kHz -> mono 16 kHz; 3-frame decimation with averaging.
* The simple low-pass is intentionally bounded and streaming-safe. */
function downmix48k(chunk) {
	if (chunk.byteLength % 12 !== 0) throw new Error("Unexpected WASAPI PCM framing");
	const out = new Float32Array(chunk.length / 12);
	for (let j = 0, i = 0; j < out.length; j++, i += 12) {
		let sum = 0;
		for (let k = 0; k < 12; k += 4) sum += (chunk.readInt16LE(i + k) + chunk.readInt16LE(i + k + 2)) / 65536;
		out[j] = sum / 3;
	}
	return out;
}
/** Delivery through one awaitable lane, with bounded native callback buffering.
* Overrun is an explicit failure, not unbounded memory usage or silent data loss. */
var WindowsLoopback = class {
	push;
	onError;
	createNative;
	native;
	queued = [];
	pending = 0;
	draining = null;
	error;
	stopped = false;
	failedIntake = false;
	stopTask = null;
	nativeEnd;
	resolveNativeEnd;
	samples = 0;
	carry = Buffer.alloc(0);
	constructor(push, onError, createNative) {
		this.push = push;
		this.onError = onError;
		this.createNative = createNative;
	}
	start() {
		if (!this.createNative && (process.platform !== "win32" || process.arch !== "x64")) throw new Error("WASAPI system audio requires Windows x64");
		if (this.createNative) this.native = this.createNative();
		else {
			let addon;
			try {
				addon = require("../../native/build/Release/loopback_capture_addon.node");
			} catch (cause) {
				throw new Error("Meeting WASAPI native addon is not built for Windows x64; build native/", { cause });
			}
			this.native = new addon.LoopbackCapture();
		}
		this.nativeEnd = new Promise((resolve) => {
			this.resolveNativeEnd = resolve;
		});
		try {
			this.native.startSystemAudio((bytes) => {
				if (bytes === null) {
					this.resolveNativeEnd?.();
					return;
				}
				if (this.stopped || this.failedIntake) return;
				try {
					if (bytes === -1) throw new Error("Native WASAPI callback queue overflow");
					if (typeof bytes === "number") {
						this.queueSilence(bytes);
						return;
					}
					const joined = this.carry.length ? Buffer.concat([this.carry, bytes]) : Buffer.from(bytes);
					const whole = Math.floor(joined.length / 12) * 12;
					this.carry = Buffer.from(joined.subarray(whole));
					if (!whole) return;
					this.enqueue(downmix48k(joined.subarray(0, whole)));
				} catch (cause) {
					this.fail(cause);
				}
			});
		} catch (error) {
			this.native.stop();
			this.native = void 0;
			throw error;
		}
	}
	queueItem(item) {
		if (this.queued.length >= 1024) throw new Error("WASAPI delivery exceeded queued packet limit");
		this.queued.push(item);
		this.startDrain();
	}
	enqueue(samples) {
		this.pending += samples.length;
		if (this.pending > 48e3) throw new Error("WASAPI delivery exceeded 3 seconds of buffered audio");
		this.queueItem(samples);
	}
	/** A native gap is a count of missing 48 kHz frames, not an allocated PCM buffer. */
	queueSilence(frames) {
		if (!Number.isSafeInteger(frames) || frames < 1 || frames > 288e5) throw new Error("Invalid or excessive WASAPI silence frame count");
		if (this.carry.length) {
			const needed = (12 - this.carry.length) / 4;
			if (frames < needed) {
				this.carry = Buffer.concat([this.carry, Buffer.alloc(frames * 4)]);
				return;
			}
			const padded = Buffer.alloc(12);
			this.carry.copy(padded);
			this.carry = Buffer.alloc(0);
			this.enqueue(downmix48k(padded));
			frames -= needed;
		}
		const samples = Math.floor(frames / 3);
		if (samples) this.queueItem({ silenceSamples: samples });
		const partial = frames % 3;
		if (partial) this.carry = Buffer.alloc(partial * 4);
	}
	startDrain() {
		if (this.draining) return;
		this.draining = this.drain().finally(() => {
			this.draining = null;
			if (this.queued.length) this.startDrain();
		});
	}
	async drain() {
		while (this.queued.length) {
			const item = this.queued.shift();
			if (item instanceof Float32Array) try {
				await this.push(item);
				this.samples += item.length;
			} catch (error) {
				this.fail(error);
			} finally {
				this.pending -= item.length;
			}
			else {
				const silent = /* @__PURE__ */ new Float32Array(8e4);
				let remaining = item.silenceSamples;
				while (remaining > 0) {
					const count = Math.min(remaining, silent.length);
					try {
						await this.push(silent.subarray(0, count));
						this.samples += count;
					} catch (error) {
						this.fail(error);
					}
					remaining -= count;
				}
			}
		}
	}
	fail(cause) {
		if (this.error) return;
		this.error = cause instanceof Error ? cause : new Error(String(cause));
		this.failedIntake = true;
		this.onError(this.error);
	}
	stop() {
		return this.stopTask ??= this.finish();
	}
	async finish() {
		let deviceStopFailed = false;
		try {
			this.native?.stop();
		} catch (error) {
			deviceStopFailed = true;
			this.error ??= error instanceof Error ? error : new Error(String(error));
		} finally {
			this.native = void 0;
		}
		if (!deviceStopFailed && this.nativeEnd) {
			let timeout;
			try {
				await Promise.race([this.nativeEnd, new Promise((_, reject) => {
					timeout = setTimeout(() => reject(/* @__PURE__ */ new Error("WASAPI native callback drain timed out")), 1e4);
				})]);
			} catch (error) {
				this.error ??= error instanceof Error ? error : new Error(String(error));
			} finally {
				if (timeout) clearTimeout(timeout);
			}
		}
		while (this.draining || this.queued.length) if (this.draining) await this.draining;
		else this.startDrain();
		this.stopped = true;
		if (this.carry.length) {
			const padded = Buffer.alloc(12);
			this.carry.copy(padded);
			this.carry = Buffer.alloc(0);
			try {
				const samples = downmix48k(padded);
				await this.push(samples);
				this.samples += samples.length;
			} catch (error) {
				this.error ??= error instanceof Error ? error : new Error(String(error));
			}
		}
		return {
			samples: this.samples,
			...this.error ? { error: this.error.message } : {}
		};
	}
};
// src/capture/index.ts
var MeetingCapture = class extends Service {
	static inject = [
		"meetingContext",
		"speechToText",
		"tools",
		"sessions"
	];
	active = new SessionCaptureRegistry();
	starting = /* @__PURE__ */ new Set();
	sourceClosers = /* @__PURE__ */ new Map();
	constructor(ctx) {
		super(ctx, "meetingCapture");
		ctx.on("session/disposed", (session) => {
			this.disposeSession(session.header.id).catch((error) => ctx.logger("meeting-capture").warn("Session cleanup: " + String(error)));
		});
		ctx.effect(() => async () => {
			await Promise.allSettled(this.active.keys().map((id) => this.disposeSession(id)));
		}, "meeting-capture: drain on unload");
		ctx.effect(() => ctx.tools.register(defineTool({
			name: "meeting_capture_file",
			description: "Transcribe an existing canonical 16 kHz mono PCM16 WAV within the current DSH Session workspace using official local SenseVoice.",
			parameters: { path: {
				type: "string",
				required: true
			} },
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: value
				}]
			},
			execute: async (args, exec) => {
				if (!exec.agent) throw new Error("Meeting capture requires a DSH Session");
				if (!isAbsolute(args.path)) throw new Error("Provide an absolute WAV path");
				const id = exec.agent.session.header.id;
				const cwd = sessionWorkspaceDirectory(exec.agent.session.header.cwd);
				const [root, audioPath] = await Promise.all([realpath(cwd), realpath(args.path)]);
				const within = relative(root, audioPath);
				if (within === ".." || within.startsWith(".." + sep) || isAbsolute(within)) throw new Error("Recording must be inside this Session workspace");
				if ((await stat(audioPath)).size > 33554432) throw new Error("Demo audio exceeds 32 MiB");
				const samples = decodeWav(await readFile(audioPath, { signal: exec.signal }));
				const capture = await this.start(id, { signal: exec.signal });
				try {
					for (let at = 0; at < samples.length; at += SAMPLE_RATE) {
						exec.signal.throwIfAborted();
						await capture.push(samples.subarray(at, at + SAMPLE_RATE));
					}
					const result = await this.stop(id);
					exec.signal.throwIfAborted();
					return JSON.stringify(result, null, 2);
				} finally {
					if (this.active.get(id) === capture) {
						capture.cancel(/* @__PURE__ */ new Error("Meeting file capture interrupted"));
						await this.stop(id);
					}
				}
			}
		})), "meeting-capture: file proof tool");
	}
	async disposeSession(id) {
		const closeSource = this.sourceClosers.get(id);
		if (closeSource) await closeSource();
		else await this.active.cancel(id, /* @__PURE__ */ new Error("DSH Session disposed"));
	}
	registerSourceCloser(id, closer) {
		if (!this.active.has(id) || this.sourceClosers.has(id)) throw new Error("Meeting source closer requires one active capture");
		this.sourceClosers.set(id, closer);
		return () => {
			if (this.sourceClosers.get(id) === closer) this.sourceClosers.delete(id);
		};
	}
	async start(sessionId, options = {}) {
		if (this.active.has(sessionId) || this.starting.has(sessionId)) throw new Error("Session capture already active or starting");
		this.starting.add(sessionId);
		try {
			options.signal?.throwIfAborted();
			const speech = this.ctx.speechToText;
			const provider = speech.snapshot().providers.find((p) => p.id === "sensevoice-local");
			if (!provider || provider.location !== "host-local") throw new Error("Local SenseVoice is not registered");
			const owner = this.ctx.sessions.get(sessionId);
			if (!owner) throw new Error("Meeting requires a live DSH Session");
			const store = this.ctx.meetingContext.storeFor(sessionId);
			const dir = await store.prepareAudio(sessionId);
			const checkpoint = await audioCheckpoint(dir);
			const previous = await store.read(sessionId);
			if (previous?.phase === "stopped") throw new Error("Meeting already stopped; create a new DSH Session");
			options.signal?.throwIfAborted();
			if (previous) await store.resume(sessionId);
			else await store.begin(sessionId);
			if (this.ctx.sessions.get(sessionId) !== owner) {
				await store.interrupt(sessionId, "Session disposed during capture start");
				throw new Error("Session disposed during capture start");
			}
			const speaker = this.ctx.get("meetingSpeaker");
			if (previous && speaker) {
				const ids = previous.segments.flatMap((line) => [line.speakerId, ...(line.turns ?? []).map((turn) => turn.speakerId)]);
				const highest = Math.max(0, ...ids.map((id) => id ? Number(id.slice(8)) || 0 : 0));
				speaker.seed(sessionId, highest + 1);
			}
			let index = checkpoint.nextIndex;
			const capture = new ContinuousCapture({
				persist: async (wav, _startMs, _endMs, signal) => {
					await store.prepareAudio(sessionId);
					await saveAudioWindow(dir, index, wav, signal);
					index++;
				},
				process: async (wav, samples, startMs, endMs, signal) => {
					signal.throwIfAborted();
					const spec = speech.resolve({
						audio: wav,
						providerId: "sensevoice-local",
						language: "auto"
					});
					const result = await speech.transcribe(spec, signal);
					signal.throwIfAborted();
					if (!result.text.trim()) return null;
					let speakerId = null;
					let turns = [];
					try {
						const service = this.ctx.get("meetingSpeaker");
						turns = service?.diarize(sessionId, samples) ?? [];
						const unique = [...new Set(turns.map((turn) => turn.speakerId).filter((id) => id !== null))];
						speakerId = unique.length === 1 ? unique[0] : unique.length > 1 ? null : service?.identify(sessionId, samples) ?? null;
						turns = turns.map((turn) => ({
							...turn,
							startMs: turn.startMs + startMs,
							endMs: turn.endMs + startMs
						}));
					} catch (error) {
						this.ctx.logger("meeting-capture").warn("Speaker identification failed: " + String(error));
					}
					signal.throwIfAborted();
					const line = {
						startMs,
						endMs,
						text: result.text,
						speakerId,
						...turns.length ? { turns } : {}
					};
					await store.append(sessionId, line);
					return line;
				}
			}, {
				offsetSamples: checkpoint.offsetSamples,
				signal: options.signal
			});
			if (this.ctx.sessions.get(sessionId) !== owner) {
				capture.cancel(/* @__PURE__ */ new Error("Session disposed during capture start"));
				await store.interrupt(sessionId, "Session disposed during capture start");
				throw new Error("Session disposed during capture start");
			}
			this.active.add(sessionId, {
				capture,
				async settle(receipt) {
					if (receipt.interrupted) await store.interrupt(sessionId, receipt.errors.at(-1) ?? "Capture cancelled or interrupted");
					else await store.finish(sessionId);
				},
				release: () => this.ctx.get("meetingSpeaker")?.forget(sessionId)
			});
			return capture;
		} finally {
			this.starting.delete(sessionId);
		}
	}
	/** Await each push for durable audio ingestion and built-in ASR backpressure. */
	push(sessionId, samples) {
		const capture = this.active.get(sessionId);
		if (!capture) return Promise.reject(/* @__PURE__ */ new Error("Session capture is not active"));
		return capture.push(samples);
	}
	stop(sessionId) {
		return this.active.stop(sessionId);
	}
};
export { ContinuousCapture, SAMPLE_RATE, WindowsLoopback, audioCheckpoint, decodeWav, MeetingCapture as default, downmix48k, encodeWav, saveAudioWindow };
