/** Host-facing meeting controls; the Sidebar never owns Windows device resources. */
import { type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ri0n72y/dsh-meeting-context'
import { WindowsLoopback } from '@ri0n72y/dsh-meeting-capture'
import type {} from '@ri0n72y/dsh-meeting-capture'
import { contribution, type MeetingView } from './remote.js'

declare module '@deepseek-ai/cordis' { interface Context { meetingControl: MeetingControl } }

export interface Config { summaryIntervalMs: number }
interface LiveRecording { source: WindowsLoopback; startedAt: number; timer: ReturnType<typeof setInterval> }

export default class MeetingControl extends TypertRemoteService {
  static inject = ['meetingContext', 'meetingCapture', 'sessions', 'typert', 'llm', 'agents']
  static Config = z.object({ summaryIntervalMs: z.number().min(1_000).default(900_000) })
  private readonly live = new Map<string, LiveRecording>()
  private readonly summaries = new Map<string, Promise<void>>()
  private starting = false
  private readonly state = new Map<string, { updatedAt?: number; nextAt?: number; error?: string; deferred?: boolean; busy?: boolean }>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'meetingControl', { namespace: 'meeting' })
    ctx.effect(() => ctx.typert.remotes.register(contribution), 'meeting-control Remote contracts')
    ctx.on('session/disposed', session => { void this.close(session.header.id).catch(error => ctx.logger('meeting-control').warn(String(error))) })
    ctx.effect(() => async () => { await Promise.allSettled([...this.live.keys()].map(id => this.close(id))) }, 'meeting-control: release WASAPI')
  }

  @Remote
  async snapshot(sessionId: string): Promise<MeetingView> {
    const liveSession = this.ctx.sessions.get(sessionId)
    if (!liveSession) throw new Error('Meeting requires a live DSH Session')
    const store = this.ctx.meetingContext.storeFor(sessionId)
    const state = await store.read(sessionId)
    const [summary, transcriptText] = await Promise.all([
      store.readDocument(sessionId, 'summary.md'), store.readDocument(sessionId, 'transcript.md')])
    const options = this.state.get(sessionId)
    return { sessionId, phase: state?.phase ?? 'ready',
      recording: this.live.has(sessionId),
      startedAt: this.live.get(sessionId)?.startedAt,
      transcript: state?.segments.length ?? 0,
      revision: state?.revision ?? 0,
      summary, transcriptText, summaryUpdatedAt: options?.updatedAt, nextSummaryAt: options?.nextAt,
      summaryBusy: options?.busy ?? false, summaryDeferred: options?.deferred ?? false,
      error: options?.error ?? state?.interruption }
  }

  @Remote({ mode: 'stream' })
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

  @Remote
  async start(sessionId: string): Promise<MeetingView> {
    if (this.live.size > 0 || this.starting) throw new Error('System playback audio is already recording in another Session')
    this.starting = true
    if (this.live.has(sessionId)) throw new Error('Meeting is already recording')
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
    this.live.set(sessionId, { source, startedAt, timer })
    this.starting = false
    this.state.set(sessionId, { nextAt: startedAt + this.config.summaryIntervalMs })
    return this.snapshot(sessionId)
  }

  private async close(sessionId: string): Promise<void> {
    const record = this.live.get(sessionId)
    if (!record) return
    this.live.delete(sessionId)
    clearInterval(record.timer)
    try {
      const ended = await record.source.stop()
      if (ended.error) this.state.set(sessionId, { ...this.state.get(sessionId), error: ended.error })
      await this.ctx.meetingCapture.stop(sessionId)
    } finally { this.live.delete(sessionId) }
  }

  @Remote
  async stop(sessionId: string): Promise<MeetingView> {
    if (!this.live.has(sessionId)) throw new Error('Meeting is not recording')
    await this.close(sessionId)
    await this.makeSummary(sessionId, true)
    return this.snapshot(sessionId)
  }

  @Remote
  async summarize(sessionId: string): Promise<MeetingView> {
    await this.makeSummary(sessionId, false, true)
    return this.snapshot(sessionId)
  }

  private async tick(sessionId: string): Promise<void> {
    const state = this.state.get(sessionId)
    if (!this.live.has(sessionId) || !state) return
    if (!state.deferred && Date.now() < (state.nextAt ?? 0)) return
    await this.makeSummary(sessionId, false)
  }

  private async makeSummary(sessionId: string, final: boolean, manual = false): Promise<void> {
    if (this.summaries.has(sessionId)) { await this.summaries.get(sessionId); return }
    const task = this.generate(sessionId, final, manual)
    this.summaries.set(sessionId, task)
    try { await task } finally { this.summaries.delete(sessionId) }
  }

  private async generate(sessionId: string, final: boolean, manual: boolean): Promise<void> {
    const before = this.state.get(sessionId) ?? {}
    const agent = this.ctx.agents.get(sessionId as SessionId)
    if (!agent || agent.status !== 'idle') {
      this.state.set(sessionId, { ...before, deferred: true,
        error: agent ? 'Session Agent 正忙，已延后总结' : 'Session Agent 尚未就绪' })
      return
    }
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
    const route = agent.session.requestHeader()?.config
    const provider = route?.provider ?? agent.options.provider
    const model = route?.model ?? agent.options.model
    if (!provider || !model) {
      this.state.set(sessionId, { ...before, error: '无法确定当前 Session 的 LLM 模型', deferred: true })
      return
    }
    this.state.set(sessionId, { ...before, busy: true, error: undefined })
    const start = Math.max(0, Math.min(covered, snapshot.segments.length))
    const lines = snapshot.segments.slice(start).map(line =>
      '[' + (line.startMs / 1000).toFixed(1) + 's] '
      + (line.speakerId ?? '未知说话人') + ': ' + line.text).join('\n')
    const prompt = [
      '你是会议纪要整理助手。仅根据提供的原文更新会议纪要，不要编造事实、决定或行动项。',
      '以中文 Markdown 输出：## 主题、## 关键讨论、## 已明确决定、## 待办与负责人、## 未解决问题。',
      '如缺少信息请明确写“尚未提及”。以下为之前的纪要及新原文，合并而非重复。',
      '既有纪要：\n' + previous.replace(/<!-- meeting-covered: \d+ -->/, '').slice(-14_000),
      '新增会议原文：\n' + (lines || snapshot.segments.map(s => s.text).join('\n')).slice(-25_000),
      ...(final ? ['这是停止录音后的最终总结，请完整收束已有内容。'] : []),
    ].join('\n\n')
    try {
      const assembler = new BlockAssembler()
      for await (const chunk of this.ctx.llm.stream({
        provider, model, system: '请严格保持内容来源准确，输出可读 Markdown；不要调用工具。',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens: 2048,
        sessionId: agent.session.id,
      })) assembler.push(chunk)
      if (assembler.finish.kind !== 'stop') throw new Error('总结模型未正常完成：' + assembler.finish.kind)
      const result = assembler.blocks().filter(block => block.type === 'text')
        .map(block => block.text).join('').trim()
      if (!result) throw new Error('模型未生成总结内容')
      const body = '<!-- meeting-covered: ' + snapshot.segments.length + ' -->\n'
        + '# 会议总结\n\n' + result + '\n'
      await store.saveSummary(sessionId, body)
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
