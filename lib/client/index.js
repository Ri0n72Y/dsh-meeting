window.__ModuleLoader__.load({
	id: "@ri0n72y/dsh-meeting",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// \0meeting-css-module:src/ui/client/MeetingBody.module.css.mjs
		const css = ".oFueVW_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);flex-direction:column;line-height:1.5;display:flex}.oFueVW_header{border-bottom:.5px solid var(--dsw-alias-border-l3);flex-direction:column;gap:6px;padding:12px 16px;display:flex}.oFueVW_status{align-items:center;gap:8px;font-weight:600;display:flex}.oFueVW_recording{color:var(--dsw-alias-label-primary)}.oFueVW_idle{color:var(--dsw-alias-label-secondary)}.oFueVW_actions{gap:8px;display:flex}.oFueVW_detail{color:var(--dsw-alias-label-secondary)}.oFueVW_error{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);margin:0;padding:8px 16px}.oFueVW_tabRow{align-items:center;gap:8px;padding:10px 12px;display:flex}.oFueVW_tabRow>div{flex:1;min-width:0}.oFueVW_summaryTimes{color:var(--dsw-alias-label-secondary);padding:0 16px 8px;font-size:12px}.oFueVW_document{scrollbar-gutter:stable;overscroll-behavior:contain;flex:1;min-height:0;padding:12px 16px;overflow:auto}.oFueVW_empty{color:var(--dsw-alias-label-tertiary);margin:0}.oFueVW_footer{border-top:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);justify-content:space-between;gap:8px;padding:8px 12px;font-size:11px;display:flex}.oFueVW_footer span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}";
		const tagId = "@ri0n72y/dsh-meeting/MeetingBody.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@ri0n72y/dsh-meeting";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var MeetingBody_module_css_default = {
			"actions": "oFueVW_actions",
			"detail": "oFueVW_detail",
			"document": "oFueVW_document",
			"empty": "oFueVW_empty",
			"error": "oFueVW_error",
			"footer": "oFueVW_footer",
			"header": "oFueVW_header",
			"idle": "oFueVW_idle",
			"recording": "oFueVW_recording",
			"root": "oFueVW_root",
			"status": "oFueVW_status",
			"summaryTimes": "oFueVW_summaryTimes",
			"tabRow": "oFueVW_tabRow"
		};
		// src/ui/client/MeetingBody.tsx
		/** Session-scoped Meeting panel built solely with DSH native UI primitives. */
		const labels = {
			code: {
				copyLabel: "复制",
				copiedLabel: "已复制",
				toolbarLabels: {
					codeLabel: "代码",
					wrapLabel: "换行",
					unwrapLabel: "取消换行"
				}
			},
			footnotes: "脚注"
		};
		const tabs = [{
			value: "transcript",
			label: "转写"
		}, {
			value: "summary",
			label: "总结"
		}];
		const formatTime = (value) => value ? new Date(value).toLocaleTimeString() : "—";
		function valueOf(r) {
			if (!r.ok) throw new Error(r.error.message);
			return r.value;
		}
		function MeetingBody({ sessionId, useTabInfo, meetingRemote }) {
			const { tab } = useTabInfo();
			const [data, setData] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)("transcript");
			const [action, setAction] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [now, setNow] = (0, react.useState)(Date.now());
			const scroll = (0, react.useRef)(null);
			const anchored = (0, react.useRef)(true);
			const currentSession = (0, react.useRef)(sessionId);
			currentSession.current = sessionId;
			(0, react.useEffect)(() => {
				const timer = setInterval(() => setNow(Date.now()), 1e3);
				return () => clearInterval(timer);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setData(null);
				setError(null);
				setAction(null);
				const listen = async () => {
					try {
						for await (const frame of meetingRemote.watch(sessionId, controller.signal)) {
							if (controller.signal.aborted || currentSession.current !== sessionId) return;
							setData(frame);
						}
					} catch (cause) {
						if (!controller.signal.aborted && currentSession.current === sessionId) setError({
							sessionId,
							message: String(cause)
						});
					}
				};
				listen();
				return () => {
					controller.abort();
				};
			}, [sessionId, meetingRemote]);
			const view = data?.sessionId === sessionId ? data : null;
			const visibleError = error?.sessionId === sessionId ? error.message : null;
			const content = selected === "transcript" ? view?.transcriptText ?? "" : view?.summary ?? "";
			(0, react.useLayoutEffect)(() => {
				const el = scroll.current;
				if (el && anchored.current) el.scrollTop = el.scrollHeight;
			}, [content, selected]);
			const run = async (name) => {
				if (action) return;
				setAction(name);
				setError(null);
				try {
					const value = valueOf(await (name === "start" ? meetingRemote.start(sessionId) : name === "stop" ? meetingRemote.stop(sessionId) : name === "prepare" ? meetingRemote.prepare(sessionId) : meetingRemote.summarize(sessionId)));
					if (currentSession.current === sessionId) setData(value);
				} catch (cause) {
					if (currentSession.current === sessionId) setError({
						sessionId,
						message: String(cause)
					});
				} finally {
					if (currentSession.current === sessionId) setAction(null);
				}
			};
			const elapsed = view?.startedAt && view.recording ? Math.max(0, Math.floor((now - view.startedAt) / 1e3)) : 0;
			const elapsedText = [
				Math.floor(elapsed / 3600),
				Math.floor(elapsed / 60) % 60,
				elapsed % 60
			].map((n) => String(n).padStart(2, "0")).join(":");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MeetingBody_module_css_default.root,
				"data-meeting-session": sessionId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: MeetingBody_module_css_default.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MeetingBody_module_css_default.status,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-live": "polite",
									className: view?.recording ? MeetingBody_module_css_default.recording : MeetingBody_module_css_default.idle,
									children: view?.recording ? "● 正在录制" : view?.phase === "stopped" ? "已完成" : view?.phase === "interrupted" ? "已中断" : "未开始"
								}), view?.recording && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: elapsedText })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MeetingBody_module_css_default.actions,
								children: view?.recording ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: action !== null,
									onClick: () => void run("stop"),
									children: "停止会议"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									size: "sm",
									disabled: action !== null || view?.phase === "stopped" || view?.recognizerPhase !== "ready",
									onClick: () => void run("start"),
									children: "开始会议"
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MeetingBody_module_css_default.detail,
								children: "系统播放音频 · Windows WASAPI Loopback"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MeetingBody_module_css_default.detail,
								children: [
									"SenseVoice · ",
									view?.recognizerPhase === "ready" ? "已就绪" : view?.recognizerPhase === "missing" ? "未安装" : view?.recognizerPhase ?? "检测中",
									" · 已识别 ",
									view?.transcript ?? 0,
									" 段"
								]
							}),
							view && view.recognizerPhase !== "ready" && view.recognizerPhase !== "missing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: action !== null || [
									"downloading",
									"checking",
									"loading",
									"waking",
									"cancelling"
								].includes(view.recognizerPhase),
								onClick: () => void run("prepare"),
								children: "准备 SenseVoice"
							}),
							view?.recognizerPhase === "missing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MeetingBody_module_css_default.detail,
								children: "请先安装 DSH 官方语音输入插件。"
							})
						]
					}),
					(visibleError || view?.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: MeetingBody_module_css_default.error,
						children: visibleError || view?.error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MeetingBody_module_css_default.tabRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
							id: "meeting-document",
							value: selected,
							label: "会议文档",
							options: tabs,
							onChange: setSelected
						}), selected === "summary" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							disabled: action !== null || !view || view.transcript === 0,
							onClick: () => void run("summarize"),
							children: "立即总结"
						})]
					}),
					selected === "summary" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MeetingBody_module_css_default.summaryTimes,
						children: view?.summaryBusy ? "正在生成总结…" : view?.summaryDeferred ? "等待当前 Agent 空闲" : "上次更新 " + formatTime(view?.summaryUpdatedAt) + " · 下次 " + formatTime(view?.nextSummaryAt)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						id: "meeting-document-" + selected + "-panel",
						role: "tabpanel",
						"aria-labelledby": "meeting-document-" + selected,
						ref: scroll,
						className: MeetingBody_module_css_default.document,
						onScroll: (event) => {
							const el = event.currentTarget;
							anchored.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
						},
						children: content ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
							text: content,
							labels
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: MeetingBody_module_css_default.empty,
							children: selected === "transcript" ? "开始会议后，识别完成的原文将自动显示于此。" : "会议总结将在识别原文后生成。"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: MeetingBody_module_css_default.footer,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							title: sessionId,
							children: [
								"当前 Session · ",
								sessionId.slice(0, 12),
								"…"
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: view?.recording ? "录音保存在当前 Workspace" : "只读预览" })]
					})
				]
			});
		}
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
		// src/ui/client/index.tsx
		const inject = [
			"remote",
			"slots",
			"sidebarRightTabs"
		];
		function registerUi(ctx) {
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: "@ri0n72y/dsh-meeting",
				kind: "meeting",
				priority: "extension",
				title: () => "会议",
				guide: [{
					id: "meeting",
					order: 30,
					title: () => "会议录音",
					description: () => "录制系统声音，实时查看原文与会议总结"
				}]
			}), "meeting-ui: Sidebar tab");
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: "@ri0n72y/dsh-meeting",
				inject: () => ({ meetingRemote: ctx.remote.meeting })
			}, MeetingBody));
		}
		/** Same two-step lifecycle as official DSH Voice Input client plugin. */
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount(contribution);
			const ui = ctx.inject([
				"remote.meeting",
				"slots",
				"sidebarRightTabs"
			], registerUi);
			try {
				await ui;
			} catch (error) {
				await ui.dispose();
				await disposeRemote();
				throw error;
			}
			return async () => {
				await ui.dispose();
				await disposeRemote();
			};
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
