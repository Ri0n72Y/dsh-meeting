import z from "@deepseek-ai/schemastery";
import { BlockAssembler } from "@deepseek-ai/dsh-llm";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { WindowsLoopback } from "@ri0n72y/dsh-meeting/capture";
// src/ui/remote.ts
const codec = { mode: "src-json" };
const sessionIdCodec = {
	mode: "strict",
	typeSymbol: "@ri0n72y/dsh-meeting#SessionId",
	create: () => ({ parse(value) {
		if (typeof value !== "string" || value.length === 0) throw new TypeError("sessionId must be a non-empty string");
		return value;
	} })
};
const param = (name) => ({
	name,
	wire: name,
	source: "json",
	codec: sessionIdCodec
});
const contribution = {
	package: "@ri0n72y/dsh-meeting",
	descriptors: [...[
		"snapshot",
		"start",
		"stop",
		"summarize",
		"prepare"
	].map((method) => ({
		id: "dsh-meeting-control." + method,
		service: "meetingControl",
		namespace: "meeting",
		method,
		invocation: { kind: "direct" },
		parameters: [param("sessionId")],
		result: codec
	})), {
		id: "dsh-meeting-control.watch",
		service: "meetingControl",
		namespace: "meeting",
		method: "watch",
		mode: "stream",
		invocation: { kind: "direct" },
		parameters: [param("sessionId")],
		cancellation: { parameter: "signal" },
		result: codec
	}]
};
// src/ui/summary-jobs.ts
/** Deduplicate concurrent summaries per Session; one final pass follows an active checkpoint. */
var SummaryJobs = class {
	generate;
	active = /* @__PURE__ */ new Map();
	constructor(generate) {
		this.generate = generate;
	}
	async run(sessionId, final, manual = false) {
		const current = this.active.get(sessionId);
		if (current) {
			if (!final || current.final) return current.task;
			const task = current.task.catch(() => void 0).then(() => this.generate(sessionId, true, manual));
			const next = {
				task,
				final: true
			};
			this.active.set(sessionId, next);
			try {
				await task;
			} finally {
				if (this.active.get(sessionId) === next) this.active.delete(sessionId);
			}
			return;
		}
		const task = this.generate(sessionId, final, manual);
		const entry = {
			task,
			final
		};
		this.active.set(sessionId, entry);
		try {
			await task;
		} finally {
			if (this.active.get(sessionId) === entry) this.active.delete(sessionId);
		}
	}
};
// src/ui/summary-batch.ts
function summaryCursor(markdown) {
	const match = markdown.match(/<!-- meeting-covered: (\d+) -->/);
	const value = Number(match?.[1] ?? 0);
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function transcriptBatch(segments, cursor) {
	const lines = [];
	let length = 0;
	let end = cursor;
	while (end < segments.length) {
		const line = segments[end];
		const row = "[" + (line.startMs / 1e3).toFixed(1) + "s] " + (line.speakerId ?? "未知说话人") + ": " + line.text;
		if (lines.length && length + row.length + 1 > 25e3) break;
		lines.push(row);
		length += row.length + 1;
		end++;
	}
	return {
		text: lines.join("\n"),
		end
	};
}
// src/ui/index.ts
var MeetingControl = class extends TypertRemoteService {
	config;
	static inject = [
		"meetingContext",
		"meetingCapture",
		"speechToText",
		"sessions",
		"typert",
		"llm",
		"agents"
	];
	static Config = z.object({ summaryIntervalMs: z.number().min(1e3).default(9e5) });
	live = /* @__PURE__ */ new Map();
	summaryJobs = new SummaryJobs((id, final, manual) => this.generate(id, final, manual));
	starting = false;
	deferredTimers = /* @__PURE__ */ new Map();
	state = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx, "meetingControl", { namespace: "meeting" });
		this.config = config;
		const hostTypert = ctx.typert;
		ctx.effect(() => hostTypert.register({
			package: contribution.package,
			face: "host",
			schemas: [],
			model: {
				services: [],
				events: [],
				objects: []
			},
			invocations: contribution.descriptors
		}), "meeting-control Host Gateway invocations");
		ctx.on("session/disposed", (session) => this.clearDeferredTimer(session.header.id));
		ctx.effect(() => async () => {
			for (const id of this.deferredTimers.keys()) this.clearDeferredTimer(id);
			await Promise.allSettled([...this.live.keys()].map((id) => this.close(id)));
		}, "meeting-control: release WASAPI");
	}
	async snapshot(sessionId) {
		if (!this.ctx.sessions.get(sessionId)) throw new Error("Meeting requires a live DSH Session");
		const store = this.ctx.meetingContext.storeFor(sessionId);
		const state = await store.read(sessionId);
		const [summary, transcriptText] = await Promise.all([store.readDocument(sessionId, "summary.md"), store.readDocument(sessionId, "transcript.md")]);
		const options = this.state.get(sessionId);
		const recognizer = this.ctx.speechToText.snapshot().providers.find((p) => p.id === "sensevoice-local");
		return {
			sessionId,
			phase: state?.phase ?? "ready",
			recording: this.live.has(sessionId),
			startedAt: this.live.get(sessionId)?.startedAt,
			transcript: state?.segments.length ?? 0,
			revision: state?.revision ?? 0,
			summary,
			transcriptText,
			recognizerPhase: recognizer?.preparation.phase ?? "missing",
			summaryUpdatedAt: options?.updatedAt,
			nextSummaryAt: options?.nextAt,
			summaryBusy: options?.busy ?? false,
			summaryDeferred: options?.deferred ?? false,
			error: options?.captureError ?? options?.error ?? state?.interruption
		};
	}
	async *watch(sessionId, signal) {
		let previous = "";
		while (!signal.aborted) {
			const frame = await this.snapshot(sessionId);
			const encoded = JSON.stringify(frame);
			if (encoded !== previous) {
				previous = encoded;
				yield frame;
			}
			await new Promise((resolve) => {
				const done = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", done);
					resolve();
				};
				const timer = setTimeout(done, 1e3);
				signal.addEventListener("abort", done, { once: true });
			});
		}
	}
	async start(sessionId) {
		const provider = this.ctx.speechToText.snapshot().providers.find((p) => p.id === "sensevoice-local");
		if (!provider || provider.preparation.phase !== "ready") throw new Error("SenseVoice 尚未就绪，请先点击“准备 SenseVoice”完成模型准备");
		if (this.live.size > 0 || this.starting) throw new Error("System playback audio is already recording in another Session");
		this.starting = true;
		try {
			const capture = await this.ctx.meetingCapture.start(sessionId);
			const source = new WindowsLoopback((samples) => this.ctx.meetingCapture.push(sessionId, samples), (error) => {
				this.state.set(sessionId, {
					...this.state.get(sessionId),
					captureError: error.message
				});
				this.close(sessionId).catch((e) => this.ctx.logger("meeting-control").warn(String(e)));
			});
			try {
				source.start();
			} catch (error) {
				capture.cancel(error);
				try {
					await this.ctx.meetingCapture.stop(sessionId);
				} catch (cleanupError) {
					this.ctx.logger("meeting-control").warn(String(cleanupError));
				}
				throw error;
			}
			const startedAt = Date.now();
			const timer = setInterval(() => {
				this.tick(sessionId).catch((error) => {
					this.state.set(sessionId, {
						...this.state.get(sessionId),
						error: String(error)
					});
				});
			}, 1e4);
			this.live.set(sessionId, {
				source,
				startedAt,
				timer,
				cancel: (reason) => capture.cancel(reason),
				unregisterSource: () => {}
			});
			try {
				const unregister = this.ctx.meetingCapture.registerSourceCloser(sessionId, () => this.close(sessionId));
				this.live.get(sessionId).unregisterSource = unregister;
				if (!this.ctx.sessions.get(sessionId)) throw new Error("DSH Session disposed during capture start");
			} catch (error) {
				await this.close(sessionId).catch((cleanup) => this.ctx.logger("meeting-control").warn(String(cleanup)));
				throw error;
			}
			this.state.set(sessionId, { nextAt: startedAt + this.config.summaryIntervalMs });
			try {
				return await this.snapshot(sessionId);
			} catch (error) {
				await this.close(sessionId).catch((cleanup) => this.ctx.logger("meeting-control").warn(String(cleanup)));
				throw error;
			}
		} finally {
			this.starting = false;
		}
	}
	close(sessionId) {
		const record = this.live.get(sessionId);
		if (!record) return Promise.resolve();
		if (record.closing) return record.closing;
		clearInterval(record.timer);
		const task = (async () => {
			let failure;
			try {
				const ended = await record.source.stop();
				if (ended.error) {
					record.cancel(new Error(ended.error));
					this.state.set(sessionId, {
						...this.state.get(sessionId),
						captureError: ended.error
					});
				}
			} catch (error) {
				failure = error;
				const reason = error instanceof Error ? error : new Error(String(error));
				record.cancel(reason);
				this.state.set(sessionId, {
					...this.state.get(sessionId),
					captureError: reason.message
				});
			} finally {
				try {
					const receipt = await this.ctx.meetingCapture.stop(sessionId);
					if (receipt.interrupted || receipt.errors.length) this.state.set(sessionId, {
						...this.state.get(sessionId),
						captureError: this.state.get(sessionId)?.captureError ?? (receipt.errors.slice(-3).join("; ") || "Meeting capture interrupted")
					});
				} catch (error) {
					failure ??= error;
					this.state.set(sessionId, {
						...this.state.get(sessionId),
						captureError: String(failure)
					});
				} finally {
					record.unregisterSource();
					if (this.live.get(sessionId) === record) this.live.delete(sessionId);
				}
			}
			if (failure) throw failure;
		})();
		record.closing = task;
		return task;
	}
	async stop(sessionId) {
		if (!this.live.has(sessionId)) throw new Error("Meeting is not recording");
		await this.close(sessionId);
		await this.summaryJobs.run(sessionId, true);
		if (this.state.get(sessionId)?.deferred) this.deferSummary(sessionId, true);
		return this.snapshot(sessionId);
	}
	async prepare(sessionId) {
		if (!this.ctx.sessions.get(sessionId)) throw new Error("Meeting Session is unavailable");
		const provider = this.ctx.speechToText.snapshot().providers.find((p) => p.id === "sensevoice-local");
		if (!provider) throw new Error("本地 SenseVoice 尚未安装");
		this.ctx.speechToText.prepare(provider.id);
		return this.snapshot(sessionId);
	}
	async summarize(sessionId) {
		await this.summaryJobs.run(sessionId, false, true);
		if (!this.live.has(sessionId) && this.state.get(sessionId)?.deferred) this.deferSummary(sessionId, false, true);
		return this.snapshot(sessionId);
	}
	clearDeferredTimer(id) {
		const timer = this.deferredTimers.get(id);
		if (timer) clearInterval(timer);
		this.deferredTimers.delete(id);
	}
	/** Retry only Agent-busy deferrals; paid model failures require manual retry. */
	deferSummary(id, final, manual = false) {
		if (this.deferredTimers.has(id)) return;
		const timer = setInterval(() => {
			if (!this.ctx.sessions.get(id) || !this.state.get(id)?.deferred) {
				this.clearDeferredTimer(id);
				return;
			}
			this.summaryJobs.run(id, final, manual).then(() => {
				if (!this.state.get(id)?.deferred) this.clearDeferredTimer(id);
			}).catch((error) => {
				this.state.set(id, {
					...this.state.get(id),
					error: String(error),
					deferred: false
				});
				this.clearDeferredTimer(id);
			});
		}, 1e4);
		this.deferredTimers.set(id, timer);
	}
	async tick(sessionId) {
		const state = this.state.get(sessionId);
		if (!this.live.has(sessionId) || !state) return;
		if (!state.deferred && Date.now() < (state.nextAt ?? 0)) return;
		await this.summaryJobs.run(sessionId, false);
	}
	async generate(sessionId, final, manual) {
		const before = this.state.get(sessionId) ?? {};
		const agent = this.ctx.agents.get(sessionId);
		if (agent !== void 0 && agent.status !== "idle") {
			this.state.set(sessionId, {
				...before,
				deferred: true,
				error: "Session Agent 正忙，已延后总结"
			});
			return;
		}
		const session = this.ctx.sessions.get(sessionId);
		if (!session) throw new Error("Meeting Session is no longer available");
		const store = this.ctx.meetingContext.storeFor(sessionId);
		const snapshot = await store.read(sessionId);
		if (!snapshot?.segments.length) {
			this.state.set(sessionId, {
				...before,
				deferred: false,
				nextAt: Date.now() + this.config.summaryIntervalMs
			});
			return;
		}
		const previous = await store.readDocument(sessionId, "summary.md");
		const covered = summaryCursor(previous);
		if (!manual && !final && covered >= snapshot.segments.length) {
			this.state.set(sessionId, {
				...before,
				nextAt: Date.now() + this.config.summaryIntervalMs,
				deferred: false
			});
			return;
		}
		const route = session.requestHeader()?.config;
		const defaults = this.ctx.get("agentDefaultModel")?.currentSelection();
		const provider = route?.provider ?? agent?.options.provider ?? defaults?.provider;
		const model = route?.model ?? agent?.options.model ?? defaults?.model;
		if (!provider || !model) {
			const error = /* @__PURE__ */ new Error("无法确定当前 Session 的 LLM 模型");
			this.state.set(sessionId, {
				...before,
				error: error.message,
				deferred: false
			});
			if (manual || final) throw error;
			return;
		}
		this.state.set(sessionId, {
			...before,
			busy: true,
			deferred: false,
			error: void 0
		});
		let cursor = Math.max(0, Math.min(covered, snapshot.segments.length));
		let summary = previous;
		try {
			do {
				const batch = transcriptBatch(snapshot.segments, cursor);
				const end = batch.end;
				const last = end === snapshot.segments.length;
				const prompt = [
					"你是会议纪要整理助手。仅根据提供的原文更新会议纪要，不要编造事实、决定或行动项。",
					"以中文 Markdown 输出：## 主题、## 关键讨论、## 已明确决定、## 待办与负责人、## 未解决问题。",
					"如缺少信息请明确写“尚未提及”。以下为之前的纪要及新原文，合并而非重复。",
					"既有纪要：\n" + summary.replace(/<!-- meeting-covered: \d+ -->/, "").slice(-14e3),
					"新增会议原文：\n" + (batch.text || "（无新增原文）"),
					...final && last ? ["这是停止录音后的最终总结，请完整收束已有内容。"] : []
				].join("\n\n");
				const assembler = new BlockAssembler();
				for await (const chunk of this.ctx.llm.stream({
					provider,
					model,
					system: "请严格保持内容来源准确，输出可读 Markdown；不要调用工具。",
					messages: [{
						role: "user",
						content: [{
							type: "text",
							text: prompt
						}]
					}],
					maxTokens: 2048,
					sessionId: session.id
				})) assembler.push(chunk);
				if (assembler.finish.kind !== "stop") throw new Error("总结模型未正常完成：" + assembler.finish.kind);
				const result = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("").trim();
				if (!result) throw new Error("模型未生成总结内容");
				const body = "<!-- meeting-covered: " + end + " -->\n# 会议总结\n\n" + result + "\n";
				await store.saveSummary(sessionId, body);
				summary = body;
				cursor = end;
			} while (cursor < snapshot.segments.length);
			const now = Date.now();
			this.state.set(sessionId, {
				...this.state.get(sessionId),
				updatedAt: now,
				nextAt: now + this.config.summaryIntervalMs,
				busy: false,
				deferred: false,
				error: void 0
			});
		} catch (error) {
			this.state.set(sessionId, {
				...this.state.get(sessionId),
				busy: false,
				deferred: false,
				nextAt: Date.now() + this.config.summaryIntervalMs,
				error: String(error)
			});
			if (manual || final) throw error;
		}
	}
};
export { MeetingControl as default };
