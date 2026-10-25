import { Service } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
// src/context/workspace.ts
function sessionWorkspaceDirectory(cwd, host = process.cwd()) {
	return cwd ?? host;
}
function workspaceMeetingRoot(cwd, host = process.cwd()) {
	return join(sessionWorkspaceDirectory(cwd, host), ".dsh-meeting");
}
function sessionDirectoryName(id) {
	if (typeof id !== "string") throw new Error("Invalid DSH Session id");
	return createHash("sha256").update(id).digest("hex");
}
function confined(parent, child) {
	const rel = relative(parent, child);
	if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Meeting path escapes Session Workspace");
}
async function existing(path) {
	try {
		return await realpath(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
/** A matching directory may already have an owner's .gitignore; do not overwrite it. */
async function ensureIgnore(dir, required) {
	const file = join(dir, ".gitignore");
	try {
		await writeFile(file, "*\n!/.gitignore\n", { flag: "wx" });
		return;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
	const stat = await lstat(file);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe meeting .gitignore");
	if (required) {
		const contents = await readFile(file, "utf8");
		if (!/(?:^|\n)\*(?:\r?\n|$)/.test(contents)) throw new Error("Existing Session meeting .gitignore does not protect audio");
	}
}
/** Validate physical root and per-session directory, including pre-existing symlinks. */
async function secureMeetingDirectory(root, id, create) {
	const workspace = await realpath(dirname(root));
	if (create) await mkdir(root, { recursive: true });
	const canonicalRoot = await existing(root);
	if (!canonicalRoot) return null;
	confined(workspace, canonicalRoot);
	const child = join(root, sessionDirectoryName(id));
	if (create) await mkdir(child, { recursive: true });
	const canonicalChild = await existing(child);
	if (!canonicalChild) return null;
	confined(canonicalRoot, canonicalChild);
	if (create) {
		await ensureIgnore(root, false);
		await ensureIgnore(child, true);
	}
	return canonicalChild;
}
async function secureAudioDirectory(root, id) {
	const session = await secureMeetingDirectory(root, id, true);
	if (!session) throw new Error("Cannot create meeting directory");
	const audio = join(session, "audio");
	await mkdir(audio, { recursive: true });
	const canonical = await realpath(audio);
	confined(session, canonical);
	return canonical;
}
async function verifyMeetingFile(directory, path) {
	const target = await existing(path);
	if (target) confined(directory, target);
}
// src/context/markdown.ts
/** Markdown is a durable projection, not a second meeting state store. */
function stamp(ms) {
	const n = Math.floor(ms / 1e3);
	return [
		Math.floor(n / 3600),
		Math.floor(n / 60) % 60,
		n % 60
	].map((x) => String(x).padStart(2, "0")).join(":");
}
function transcriptMarkdown(state) {
	return [
		"# 会议原文",
		"",
		...state.segments.map((line) => {
			const speaker = line.speakerId ?? "未知说话人";
			const text = line.text.trim().replace(/\r\n?/g, "\n").split("\n").map((x) => "> " + x.replace(/^([>#*+-]|\d+\.)\s/, "\\$&")).join("\n");
			return "### " + stamp(line.startMs) + "–" + stamp(line.endMs) + " · " + speaker + "\n\n" + text;
		}).flatMap((row) => [row, ""])
	].join("\n") + "\n";
}
/** Atomic same-directory replace; no partial document leaks to Preview. */
async function writeMeetingDocument(dir, filename, content) {
	const target = join(dir, filename);
	const tmp = target + "." + randomUUID() + ".tmp";
	try {
		await writeFile(tmp, content, { flag: "wx" });
		await rename(tmp, target);
	} catch (error) {
		await rm(tmp, { force: true }).catch(() => void 0);
		throw error;
	}
}
// src/context/store.ts
function validateLine(item) {
	if (!Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs || item.text.trim() === "" || item.text.length > 2e4 || item.speakerId !== null && !/^Speaker [0-9]+$/.test(item.speakerId)) throw new Error("Invalid meeting line");
	for (const turn of item.turns ?? []) if (!Number.isSafeInteger(turn.startMs) || !Number.isSafeInteger(turn.endMs) || turn.startMs < item.startMs || turn.endMs > item.endMs || turn.endMs <= turn.startMs || turn.speakerId !== null && !/^Speaker [0-9]+$/.test(turn.speakerId)) throw new Error("Invalid speaker turn");
}
/** The root is <Session.cwd>/.dsh-meeting, not global DSH_HOME. */
var MeetingStore = class {
	root;
	queues = /* @__PURE__ */ new Map();
	constructor(root) {
		this.root = root;
	}
	directory(id) {
		return join(this.root, sessionDirectoryName(id));
	}
	async prepareAudio(id) {
		return secureAudioDirectory(this.root, id);
	}
	async readDocument(id, filename) {
		const dir = await secureMeetingDirectory(this.root, id, false);
		if (!dir) return "";
		const path = join(dir, filename);
		await verifyMeetingFile(dir, path);
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return "";
			throw error;
		}
	}
	async saveSummary(id, markdown) {
		const dir = await secureMeetingDirectory(this.root, id, true);
		if (!dir) throw new Error("Meeting directory not available");
		await verifyMeetingFile(dir, join(dir, "summary.md"));
		await writeMeetingDocument(dir, "summary.md", markdown);
	}
	async read(id) {
		const dir = await secureMeetingDirectory(this.root, id, false);
		if (!dir) return null;
		const path = join(dir, "state.json");
		await verifyMeetingFile(dir, path);
		try {
			const snapshot = JSON.parse(await readFile(path, "utf8"));
			if (snapshot.sessionId !== id) throw new Error("Mismatched persisted Session identity");
			return snapshot;
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
	}
	async update(id, mutation) {
		const task = (this.queues.get(id) ?? Promise.resolve()).catch(() => void 0).then(async () => {
			const next = mutation(await this.read(id));
			const dir = await secureMeetingDirectory(this.root, id, true);
			if (!dir) throw new Error("Cannot create meeting directory");
			const path = join(dir, "state.json");
			await verifyMeetingFile(dir, path);
			const temporary = path + "." + randomUUID() + ".tmp";
			try {
				await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
				await rename(temporary, path);
				await writeMeetingDocument(dir, "transcript.md", transcriptMarkdown(next));
			} catch (error) {
				await rm(temporary, { force: true }).catch(() => void 0);
				throw error;
			}
			return next;
		});
		this.queues.set(id, task);
		task.finally(() => {
			if (this.queues.get(id) === task) this.queues.delete(id);
		}).catch(() => void 0);
		return task;
	}
	async begin(id) {
		return this.update(id, (state) => {
			if (state?.phase === "recording") throw new Error("Recording already active; use resume");
			if (state) throw new Error("Session meeting already exists; use resume if interrupted");
			return {
				sessionId: id,
				phase: "recording",
				revision: 0,
				segments: []
			};
		});
	}
	/** Explicitly reclaim a Session whose prior Host no longer owns the capture. */
	async resume(id) {
		return this.update(id, (state) => {
			if (!state || state.phase === "stopped") throw new Error("No resumable meeting in Session");
			return {
				...state,
				phase: "recording",
				revision: state.revision + 1,
				interruption: void 0
			};
		});
	}
	async append(id, line) {
		validateLine(line);
		return this.update(id, (state) => {
			if (state?.phase !== "recording") throw new Error("Meeting is not recording");
			if (state.segments.length >= 2e4) throw new Error("Meeting segment limit reached");
			if (line.startMs < (state.segments.at(-1)?.startMs ?? 0)) throw new Error("Nonmonotonic meeting timeline");
			return {
				...state,
				revision: state.revision + 1,
				segments: [...state.segments, line]
			};
		});
	}
	async finish(id) {
		return this.update(id, (state) => {
			if (!state) throw new Error("Meeting does not exist");
			if (state.phase === "stopped") return state;
			return {
				...state,
				phase: "stopped",
				revision: state.revision + 1,
				interruption: void 0
			};
		});
	}
	async interrupt(id, reason) {
		return this.update(id, (state) => {
			if (!state) throw new Error("Meeting does not exist");
			if (state.phase !== "recording") return state;
			return {
				...state,
				phase: "interrupted",
				revision: state.revision + 1,
				interruption: reason.slice(0, 500)
			};
		});
	}
};
// src/context/cache.ts
/** Identity-based cache: an opaque Session ID alone cannot own Workspace state. */
var SessionWorkspaceCache = class {
	stores = /* @__PURE__ */ new Map();
	get(owner, id, create) {
		const current = this.stores.get(id);
		if (current?.owner === owner) return current.store;
		const store = create();
		this.stores.set(id, {
			owner,
			store
		});
		return store;
	}
	release(owner, id) {
		if (this.stores.get(id)?.owner === owner) this.stores.delete(id);
	}
	clear() {
		this.stores.clear();
	}
};
// src/context/index.ts
var MeetingContext = class extends Service {
	static inject = ["tools", "sessions"];
	stores = new SessionWorkspaceCache();
	constructor(ctx) {
		super(ctx, "meetingContext");
		ctx.on("session/disposed", (session) => {
			this.stores.release(session, session.header.id);
		});
		ctx.effect(() => () => {
			this.stores.clear();
		}, "meeting-context: dispose stores");
		ctx.effect(() => ctx.tools.register(defineTool({
			name: "meeting_status",
			description: "Read the DSH Session meeting phase, segments, speaker labels and recent transcript.",
			parameters: {},
			output: {
				schema: { type: "string" },
				render: (_args, value) => [{
					type: "text",
					text: value
				}]
			},
			execute: async (_args, exec) => {
				if (!exec.agent) throw new Error("Meeting status requires a DSH Session");
				const id = exec.agent.session.header.id;
				const meeting = await this.storeFor(id).read(id);
				if (!meeting) return "No meeting has been started in this DSH Session.";
				return JSON.stringify({
					sessionId: meeting.sessionId,
					phase: meeting.phase,
					revision: meeting.revision,
					...meeting.interruption ? { interruption: meeting.interruption } : {},
					segments: meeting.segments.length,
					speakers: [...new Set(meeting.segments.flatMap((s) => [s.speakerId, ...(s.turns ?? []).map((turn) => turn.speakerId)].filter((x) => x !== null)))],
					latest: meeting.segments.slice(-5)
				}, null, 2);
			}
		})), "meeting-context: status tool");
	}
	storeFor(sessionId) {
		sessionDirectoryName(sessionId);
		const session = this.ctx.sessions.get(sessionId);
		if (!session) throw new Error("Meeting requires a live DSH Session");
		return this.stores.get(session, sessionId, () => new MeetingStore(workspaceMeetingRoot(session.header.cwd)));
	}
};
export { MeetingStore, MeetingContext as default, sessionDirectoryName, sessionWorkspaceDirectory, workspaceMeetingRoot };
