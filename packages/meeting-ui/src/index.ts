/** Host-facing meeting controls; the Sidebar never owns Windows device resources. */
import { type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ri0n72y/dsh-meeting-context'
import { WindowsLoopback } from '@ri0n72y/dsh-meeting-capture'
import type {} from '@ri0n72y/dsh-meeting-capture'
import { contribution, type MeetingView } from './remote.js'

declare module '@deepseek-ai/cordis' { interface Context { meetingControl: MeetingControl } }

export interface Config { summaryIntervalMs: number }
interface LiveRecording {
  source: WindowsLoopback
  startedAt: number
  timer: ReturnType<typeof setInterval>
  cancel(reason: Error): void
  closing?: Promise<void>
}

export default class MeetingControl extends TypertRemoteService {
  static inject = ['meetingContext', 'meetingCapture', 'speechToText', 'sessions', 'typert', 'llm', 'agents']
  static Config = z.object({ summaryIntervalMs: z.number().min(1_000).default(900_000) })
  private readonly live = new Map<string, LiveRecording>()
  private readonly summaries = new Map<string, { task: Promise<void>; final: boolean }>()
  private starting = false
  private readonly deferredTimers = new Map<string, ReturnType<typeof setInterval>>()
  private readonly state = new Map<string, { updatedAt?: number; nextAt?: number; error?: string; deferred?: boolean; busy?: boolean }>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'meetingControl', { namespace: 'meeting' })
    ctx.effect(() => ctx.typert.remotes.register(contribution), 'meeting-control Remote contracts')
    ctx.on('session/disposed', session => {
      this.clearDeferredTimer(session.header.id)
      void this.close(session.header.id).catch(error => ctx.logger('meeting-control').warn(String(error)))
    })
    ctx.effect(() => async () => {
      for (const id of this.deferredTimers.keys()) this.clearDeferredTimer(id)
      await Promise.allSettled([...this.live.keys()].map(id => this.close(id)))
    }, 'meeting-control: release WASAPI')
  }

  async snapshot(sessionId: string): Promise<MeetingView> {
    const liveSession = this.ctx.sessions.get(sessionId as SessionId)
    if (!liveSession) throw new Error('Meeting requires a live DSH Session')
    const store = this.ctx.meetingContext.storeFor(sessionId)
    const state = await store.read(sessionId)
    const [summary, transcriptText] = await Promise.all([
      store.readDocument(sessionId, 'summary.md'), store.readDocument(sessionId, 'transcript.md')])
    const options = this.state.get(sessionId)
    const recognizer = this.ctx.speechToText.snapshot().providers.find(p => p.id === 'sensevoice-local')
    return { sessionId, phase: state?.phase ?? 'ready',
      recording: this.live.has(sessionId),
      startedAt: this.live.get(sessionId)?.startedAt,
      transcript: state?.segments.length ?? 0,
      revision: state?.revision ?? 0,
      summary, transcriptText, recognizerPhase: recognizer?.preparation.phase ?? 'missing',
      summaryUpdatedAt: options?.updatedAt, nextSummaryAt: options?.nextAt,
      summaryBusy: options?.busy ?? false, summaryDeferred: options?.deferred ?? false,
      error: options?.error ?? state?.interruption }
  }

  async *watch(sessionId: string, signal: AbortSignal): AsyncIterable<MeetingView> {
    let previous = ''
    while (!signal.aborted) {
      const frame = await this.snapshot(sessionId)
      const encoded = JSON.stringify(frame)
      if (encoded !== previous) { previous = encoded; yield frame }
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, 1000)
        signal.addEventListener('abort', done, { once: true })
      })
    }
  }

  async start(sessionId: string): Promise<MeetingView> {
    const provider = this.ctx.speechToText.snapshot().providers.find(p => p.id === 'sensevoice-local')
    if (!provider || provider.preparation.phase !== 'ready') {
      throw new Error('SenseVoice 尚未就绪，请先点击“准备 SenseVoice”完成模型准备')
    }
    if (this.live.size > 0 || this.starting) throw new Error('System playback audio is already recording in another Session')
    this.starting = true
    let capture: Awaited<ReturnType<typeof this.ctx.meetingCapture.start>>
    try { capture = await this.ctx.meetingCapture.start(sessionId) }
    catch (error) { this.starting = false; throw error }
    const source = new WindowsLoopback(
      samples => this.ctx.meetingCapture.push(sessionId, samples),
      error => { this.state.set(sessionId, { ...this.state.get(sessionId), error: error.message });
        capture.cancel(error); void this.close(sessionId).catch(() => undefined) },
    )
    try { source.start() } catch (error) {
      capture.cancel(error)
      await this.ctx.meetingCapture.stop(sessionId)
      this.starting = false
      throw error
    }
    const startedAt = Date.now()
    const timer = setInterval(() => { void this.tick(sessionId).catch(error => {
      this.state.set(sessionId, { ...this.state.get(sessionId), error: String(error) })
    }) }, 10_000)
    this.live.set(sessionId, { source, startedAt, timer, cancel: reason => capture.cancel(reason) })
    this.starting = false
    this.state.set(sessionId, { nextAt: startedAt + this.config.summaryIntervalMs })
    return this.snapshot(sessionId)
  }

  private close(sessionId: string): Promise<void> {
    const record = this.live.get(sessionId)
    if (!record) return Promise.resolve()
    if (record.closing) return record.closing
    clearInterval(record.timer)
    const task = (async () => {
      let failure: unknown
      try {
        const ended = await record.source.stop()
        if (ended.error) {
          record.cancel(new Error(ended.error))
          this.state.set(sessionId, { ...this.state.get(sessionId), error: ended.error })
        }
      } catch (error) {
        failure = error
        const reason = error instanceof Error ? error : new Error(String(error))
        record.cancel(reason)
        this.state.set(sessionId, { ...this.state.get(sessionId), error: reason.message })
      } finally {
        // Keep the device lease while both the native source and capture settle.
        try {
          const receipt = await this.ctx.meetingCapture.stop(sessionId)
          if (receipt.interrupted) this.state.set(sessionId, {
            ...this.state.get(sessionId),
            error: this.state.get(sessionId)?.error ?? receipt.errors.at(-1) ?? 'Meeting capture interrupted',
          })
        } catch (error) {
          failure ??= error
          this.state.set(sessionId, { ...this.state.get(sessionId), error: String(failure) })
        } finally {
          if (this.live.get(sessionId) === record) this.live.delete(sessionId)
        }
      }
      if (failure) throw failure
    })()
    record.closing = task
    return task
  }

  async stop(sessionId: string): Promise<MeetingView> {
    if (!this.live.has(sessionId)) throw new Error('Meeting is not recording')
    await this.close(sessionId)
    await this.makeSummary(sessionId, true)
    if (this.state.get(sessionId)?.deferred) this.deferSummary(sessionId, true)
    return this.snapshot(sessionId)
  }

  async prepare(sessionId: string): Promise<MeetingView> {
    if (!this.ctx.sessions.get(sessionId as SessionId)) throw new Error('Meeting Session is unavailable')
    const provider = this.ctx.speechToText.snapshot().providers.find(p => p.id === 'sensevoice-local')
    if (!provider) throw new Error('本地 SenseVoice 尚未安装')
    this.ctx.speechToText.prepare(provider.id)
    return this.snapshot(sessionId)
  }

  async summarize(sessionId: string): Promise<MeetingView> {
    await this.makeSummary(sessionId, false, true)
    if (!this.live.has(sessionId) && this.state.get(sessionId)?.deferred) {
      this.deferSummary(sessionId, false)
    }
    return this.snapshot(sessionId)
  }

  private clearDeferredTimer(id: string): void {
    const timer = this.deferredTimers.get(id)
    if (timer) clearInterval(timer)
    this.deferredTimers.delete(id)
  }
  /** Retry only Agent-busy deferrals; paid model failures require manual retry. */
  private deferSummary(id: string, final: boolean): void {
    if (this.deferredTimers.has(id)) return
    const timer = setInterval(() => {
      if (!this.ctx.sessions.get(id as SessionId) || !this.state.get(id)?.deferred) {
        this.clearDeferredTimer(id)
        return
      }
      void this.makeSummary(id, final).then(() => {
        if (!this.state.get(id)?.deferred) this.clearDeferredTimer(id)
      }).catch(error => {
        this.state.set(id, { ...this.state.get(id), error: String(error), deferred: false })
        this.clearDeferredTimer(id)
      })
    }, 10_000)
    this.deferredTimers.set(id, timer)
  }
  private async tick(sessionId: string): Promise<void> {
    const state = this.state.get(sessionId)
    if (!this.live.has(sessionId) || !state) return
    if (!state.deferred && Date.now() < (state.nextAt ?? 0)) return
    await this.makeSummary(sessionId, false)
  }

  private async makeSummary(sessionId: string, final: boolean, manual = false): Promise<void> {
    const current = this.summaries.get(sessionId)
    if (current) {
      if (!final || current.final) return current.task
      // One final pass follows the active regular checkpoint, shared by all waiters.
      const task = current.task.then(() => this.generate(sessionId, true, manual))
      const next = { task, final: true }
      this.summaries.set(sessionId, next)
      try { await task } finally {
        if (this.summaries.get(sessionId) === next) this.summaries.delete(sessionId)
      }
      return
    }
    const task = this.generate(sessionId, final, manual)
    const entry = { task, final }
    this.summaries.set(sessionId, entry)
    try { await task } finally {
      if (this.summaries.get(sessionId) === entry) this.summaries.delete(sessionId)
    }
  }

  private async generate(sessionId: string, final: boolean, manual: boolean): Promise<void> {
    const before = this.state.get(sessionId) ?? {}
    const agent = this.ctx.agents.get(sessionId as SessionId)
    // A meeting may start before the first chat turn creates its Agent.
    // Busy Agents defer summarization; absent Agents use DSH's selected default model.
    if (agent !== undefined && agent.status !== 'idle') {
      this.state.set(sessionId, { ...before, deferred: true,
        error: 'Session Agent 正忙，已延后总结' })
      return
    }
    const session = this.ctx.sessions.get(sessionId as SessionId)
    if (!session) throw new Error('Meeting Session is no longer available')
    const store = this.ctx.meetingContext.storeFor(sessionId)
    const snapshot = await store.read(sessionId)
    if (!snapshot?.segments.length) {
      this.state.set(sessionId, { ...before, deferred: false,
        nextAt: Date.now() + this.config.summaryIntervalMs })
      return
    }
    const previous = await store.readDocument(sessionId, 'summary.md')
    const covered = Number(previous.match(/<!-- meeting-covered: (\d+) -->/)?.[1] ?? 0)
    if (!manual && !final && covered >= snapshot.segments.length) {
      this.state.set(sessionId, { ...before, nextAt: Date.now() + this.config.summaryIntervalMs, deferred: false })
      return
    }
    const route = session.requestHeader()?.config
    const defaults = this.ctx.get('agentDefaultModel')?.currentSelection()
    const provider = route?.provider ?? agent?.options.provider ?? defaults?.provider
    const model = route?.model ?? agent?.options.model ?? defaults?.model
    if (!provider || !model) {
      const error = new Error('无法确定当前 Session 的 LLM 模型')
      this.state.set(sessionId, { ...before, error: error.message, deferred: false })
      if (manual || final) throw error
      return
    }
    this.state.set(sessionId, { ...before, busy: true, deferred: false, error: undefined })
    let cursor = Math.max(0, Math.min(covered, snapshot.segments.length))
    let summary = previous
    try {
      // Advance the durable cursor only for whole segments actually sent to the LLM.
      do {
        const lines: string[] = []
        let length = 0
        let end = cursor
        while (end < snapshot.segments.length) {
          const line = snapshot.segments[end]!
          const row = '[' + (line.startMs / 1000).toFixed(1) + 's] '
            + (line.speakerId ?? '未知说话人') + ': ' + line.text
          if (lines.length && length + row.length + 1 > 25_000) break
          lines.push(row)
          length += row.length + 1
          end++
        }
        const last = end === snapshot.segments.length
        const prompt = [
          '你是会议纪要整理助手。仅根据提供的原文更新会议纪要，不要编造事实、决定或行动项。',
          '以中文 Markdown 输出：## 主题、## 关键讨论、## 已明确决定、## 待办与负责人、## 未解决问题。',
          '如缺少信息请明确写“尚未提及”。以下为之前的纪要及新原文，合并而非重复。',
          '既有纪要：\n' + summary.replace(/<!-- meeting-covered: \d+ -->/, '').slice(-14_000),
          '新增会议原文：\n' + (lines.join('\n') || '（无新增原文）'),
          ...(final && last ? ['这是停止录音后的最终总结，请完整收束已有内容。'] : []),
        ].join('\n\n')
        const assembler = new BlockAssembler()
        for await (const chunk of this.ctx.llm.stream({
          provider, model, system: '请严格保持内容来源准确，输出可读 Markdown；不要调用工具。',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 2048,
          sessionId: session.id,
        })) assembler.push(chunk)
        if (assembler.finish.kind !== 'stop') throw new Error('总结模型未正常完成：' + assembler.finish.kind)
        const result = assembler.blocks().filter(block => block.type === 'text')
          .map(block => block.text).join('').trim()
        if (!result) throw new Error('模型未生成总结内容')
        const body = '<!-- meeting-covered: ' + end + ' -->\n'
          + '# 会议总结\n\n' + result + '\n'
        await store.saveSummary(sessionId, body)
        summary = body
        cursor = end
      } while (cursor < snapshot.segments.length)
      const now = Date.now()
      this.state.set(sessionId, { updatedAt: now,
        nextAt: now + this.config.summaryIntervalMs, busy: false, deferred: false })
    } catch (error) {
      this.state.set(sessionId, { ...before, busy: false, deferred: false,
        nextAt: Date.now() + this.config.summaryIntervalMs, error: String(error) })
      if (manual || final) throw error
    }
  }
}
