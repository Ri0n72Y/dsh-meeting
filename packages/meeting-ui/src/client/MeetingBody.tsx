/** Session-scoped Meeting panel built solely with DSH native UI primitives. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, MarkdownText, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { MeetingClientRemote } from './index.js'
import type { MeetingView } from '../remote.js'
import css from './MeetingBody.module.css'

type Props = PropsRuntime<'sidebar.right.pane.tab'> & { meetingRemote: MeetingClientRemote }
const labels = {
  code: { copyLabel: '复制', copiedLabel: '已复制', toolbarLabels: { codeLabel: '代码', wrapLabel: '换行', unwrapLabel: '取消换行' } },
  footnotes: '脚注',
}
const tabs = [{ value: 'transcript', label: '转写' }, { value: 'summary', label: '总结' }] as const
const formatTime = (value?: number): string => value ? new Date(value).toLocaleTimeString() : '—'
function valueOf<T>(r: RemoteResult<T>): T {
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}
export function MeetingBody({ sessionId, useTabInfo, meetingRemote }: Props): ReactNode {
  const { tab } = useTabInfo()
  const [data, setData] = useState<MeetingView | null>(null)
  const [selected, setSelected] = useState<'transcript' | 'summary'>('transcript')
  const [action, setAction] = useState<'start' | 'stop' | 'summarize' | 'prepare' | null>(null)
  const [error, setError] = useState<{ sessionId: string; message: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const scroll = useRef<HTMLDivElement>(null)
  const anchored = useRef(true)
  // Async actions retain their source Session; never commit their result into another.
  const currentSession = useRef(sessionId)
  currentSession.current = sessionId
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(null); setAction(null)
    const listen = async () => {
      try {
        // In DSH the Remote stream owns its connection and is disposed on abort.
        for await (const frame of meetingRemote.watch(sessionId, controller.signal)) {
          if (controller.signal.aborted || currentSession.current !== sessionId) return
          setData(frame)
        }
      } catch (cause) {
        if (!controller.signal.aborted && currentSession.current === sessionId) setError({ sessionId, message: String(cause) })
      }
    }
    void listen()
    return () => { controller.abort() }
  }, [sessionId, meetingRemote])
  // Effects clear old state after commit; render must never expose another Session's document.
  const view = data?.sessionId === sessionId ? data : null
  const visibleError = error?.sessionId === sessionId ? error.message : null
  const content = selected === 'transcript' ? (view?.transcriptText ?? '') : (view?.summary ?? '')
  useLayoutEffect(() => {
    const el = scroll.current
    if (el && anchored.current) el.scrollTop = el.scrollHeight
  }, [content, selected])
  const run = async (name: 'start' | 'stop' | 'summarize' | 'prepare') => {
    if (action) return
    setAction(name); setError(null)
    try {
      const result = name === 'start' ? meetingRemote.start(sessionId)
        : name === 'stop' ? meetingRemote.stop(sessionId)
        : name === 'prepare' ? meetingRemote.prepare(sessionId) : meetingRemote.summarize(sessionId)
      const value = valueOf(await result)
      if (currentSession.current === sessionId) setData(value)
    } catch (cause) {
      if (currentSession.current === sessionId) setError({ sessionId, message: String(cause) })
    } finally {
      if (currentSession.current === sessionId) setAction(null)
    }
  }
  const elapsed = view?.startedAt && data.recording
    ? Math.max(0, Math.floor((now - data.startedAt) / 1000)) : 0
  const elapsedText = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map(n => String(n).padStart(2, '0')).join(':')
  return <div className={css.root} data-meeting-session={sessionId}>
    <header className={css.header}>
      <div className={css.status}>
        <span aria-live="polite" className={view?.recording ? css.recording : css.idle}>
          {view?.recording ? '● 正在录制' : view?.phase === 'stopped' ? '已完成' : view?.phase === 'interrupted' ? '已中断' : '未开始'}
        </span>
        {view?.recording && <span>{elapsedText}</span>}
      </div>
      <div className={css.actions}>
        {view?.recording
          ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void run('stop')}>停止会议</Button>
          : <Button variant="primary" size="sm" disabled={action !== null || view?.phase === 'stopped' || view?.recognizerPhase !== 'ready'}
            onClick={() => void run('start')}>开始会议</Button>}
      </div>
      <div className={css.detail}>系统播放音频 · Windows WASAPI Loopback</div>
      <div className={css.detail}>SenseVoice · {view?.recognizerPhase === 'ready' ? '已就绪' :
        view?.recognizerPhase === 'missing' ? '未安装' : view?.recognizerPhase ?? '检测中'} · 已识别 {view?.transcript ?? 0} 段</div>
      {data && data.recognizerPhase !== 'ready' && data.recognizerPhase !== 'missing' && (
        <Button variant="outline" size="sm"
          disabled={action !== null || ['downloading','checking','loading','waking','cancelling'].includes(data.recognizerPhase)}
          onClick={() => void run('prepare')}>准备 SenseVoice</Button>
      )}
      {view?.recognizerPhase === 'missing' && <div className={css.detail}>请先安装 DSH 官方语音输入插件。</div>}
    </header>
    {(visibleError || view?.error) && <p role="alert" className={css.error}>{visibleError || view?.error}</p>}
    <div className={css.tabRow}>
      <SegmentedControl id="meeting-document" value={selected} label="会议文档"
        options={tabs} onChange={setSelected} />
      {selected === 'summary' &&
        <Button variant="ghost" size="sm" disabled={action !== null || !view || data.transcript === 0}
          onClick={() => void run('summarize')}>立即总结</Button>}
    </div>
    {selected === 'summary' &&
      <div className={css.summaryTimes}>
        {view?.summaryBusy ? '正在生成总结…' : view?.summaryDeferred ? '等待当前 Agent 空闲' :
          '上次更新 ' + formatTime(view?.summaryUpdatedAt) + ' · 下次 ' + formatTime(view?.nextSummaryAt)}
      </div>}
    <div id={'meeting-document-' + selected + '-panel'} role="tabpanel"
      aria-labelledby={'meeting-document-' + selected} ref={scroll} className={css.document}
      onScroll={event => { const el = event.currentTarget; anchored.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48 }}>
      {content ? <MarkdownText text={content} labels={labels} /> :
        <p className={css.empty}>{selected === 'transcript' ?
          '开始会议后，识别完成的原文将自动显示于此。' : '会议总结将在识别原文后生成。'}</p>}
    </div>
    <footer className={css.footer}>
      <span title={sessionId}>当前 Session · {sessionId.slice(0, 12)}…</span>
      <span>{view?.recording ? '录音保存在当前 Workspace' : '只读预览'}</span>
    </footer>
  </div>
}
