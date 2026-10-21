import assert from 'node:assert/strict'
import { test } from 'node:test'
import MeetingControl from '../packages/meeting-ui/src/index.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

interface Line { startMs: number; endMs: number; text: string; speakerId: string | null }
interface Lease {
  source: { stop(): Promise<{ samples: number; error?: string }> }
  startedAt: number
  timer: ReturnType<typeof setInterval>
  cancel(reason: Error): void
  closing?: Promise<void>
}
interface Internals {
  live: Map<string, Lease>
  state: Map<string, { deferred?: boolean; busy?: boolean; error?: string }>
  deferredTimers: Map<string, ReturnType<typeof setInterval>>
  close(id: string): Promise<void>
  makeSummary(id: string, final: boolean, manual?: boolean): Promise<void>
  generate(id: string, final: boolean, manual: boolean): Promise<void>
}

function fixture(lines: Line[] = []) {
  let summary = ''
  let agentBusy = false
  const prompts: string[] = []
  const covered: number[] = []
  let captureStops = 0
  const store = {
    async read() { return { sessionId: 'A', phase: 'stopped' as const, revision: 0, segments: lines } },
    async readDocument(_id: string, name: string) { return name === 'summary.md' ? summary : '' },
    async saveSummary(_id: string, body: string) {
      summary = body
      covered.push(Number(body.match(/meeting-covered: (\d+)/)?.[1] ?? -1))
    },
  }
  const context = {
    sessions: { get: (id: string) => ({ id, requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) }) },
    meetingContext: { storeFor: () => store },
    speechToText: { snapshot: () => ({ providers: [{ id: 'sensevoice-local', preparation: { phase: 'ready' } }] }) },
    agents: { get: () => agentBusy ? { status: 'running', options: { provider: 'p', model: 'm' } } : undefined },
    get: () => undefined,
    llm: {
      async *stream(request: { messages: Array<{ content: Array<{ text: string }> }> }) {
        prompts.push(request.messages[0]!.content[0]!.text)
        yield { type: 'text-delta', index: 0, text: '纪要 ' + prompts.length }
      },
    },
    meetingCapture: {
      async stop(_id: string): Promise<{ interrupted: boolean; errors: string[] }> {
        captureStops++; return { interrupted: false, errors: [] }
      },
      async start(_id: string) { return { cancel() {} } },
    },
  }
  const control = Object.assign(Object.create(MeetingControl.prototype), {
    ctx: context, config: { summaryIntervalMs: 900_000 }, live: new Map(),
    summaries: new Map(), deferredTimers: new Map(), state: new Map(), starting: false,
  }) as MeetingControl
  const internal = control as unknown as Internals
  return {
    control, internal, context, store, prompts, covered,
    get captureStops() { return captureStops },
    setAgentBusy(value: boolean) { agentBusy = value },
  }
}

test('device lease survives concurrent close, native stop and capture settlement', async () => {
  const f = fixture()
  const device = deferred<{ samples: number }>()
  const capture = deferred<{ interrupted: boolean; errors: string[] }>()
  const entered = deferred<void>()
  f.context.meetingCapture.stop = async () => {
    entered.resolve()
    return capture.promise
  }
  let nativeStops = 0
  const timer = setInterval(() => {}, 100_000)
  f.internal.live.set('A', {
    source: { stop: () => { nativeStops++; return device.promise } },
    startedAt: 1, timer, cancel() {},
  })
  try {
    const first = f.internal.close('A')
    const second = f.internal.close('A')
    assert.strictEqual(first, second)
    assert.equal(f.internal.live.has('A'), true)
    await assert.rejects(f.control.start('B'), /already recording/)
    device.resolve({ samples: 120 })
    await entered.promise
    assert.equal(f.internal.live.has('A'), true)
    await assert.rejects(f.control.start('B'), /already recording/)
    capture.resolve({ interrupted: false, errors: [] })
    await first
    assert.equal(nativeStops, 1)
    assert.equal(f.internal.live.has('A'), false)
  } finally { clearInterval(timer) }
})

test('native stop rejection still cancels and settles capture, releases lease, and reports error', async () => {
  const f = fixture()
  let cancellation = ''
  const timer = setInterval(() => {}, 100_000)
  f.internal.live.set('A', {
    source: { async stop() { throw new Error('WASAPI stop failed') } },
    startedAt: 1, timer, cancel(error) { cancellation = error.message },
  })
  try {
    await assert.rejects(f.internal.close('A'), /WASAPI stop failed/)
    assert.equal(f.captureStops, 1)
    assert.equal(cancellation, 'WASAPI stop failed')
    assert.match(f.internal.state.get('A')?.error ?? '', /WASAPI stop failed/)
    assert.equal(f.internal.live.has('A'), false)
    // A subsequent Start is no longer blocked by a stale Windows device lease.
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      await assert.rejects(f.control.start('B'), /Windows x64/)
    }
  } finally { clearInterval(timer) }
})

test('PCM queue failure reported by source.stop still interrupts and finalizes capture', async () => {
  const f = fixture()
  let cancellation = ''
  const timer = setInterval(() => {}, 100_000)
  f.internal.live.set('A', {
    source: { async stop() { return { samples: 42, error: 'PCM persistence failed' } } },
    startedAt: 1, timer, cancel(error) { cancellation = error.message },
  })
  try {
    await f.internal.close('A')
    assert.equal(f.captureStops, 1)
    assert.equal(cancellation, 'PCM persistence failed')
    assert.match(f.internal.state.get('A')?.error ?? '', /PCM persistence failed/)
    assert.equal(f.internal.live.has('A'), false)
  } finally { clearInterval(timer) }
})

test('multiple final requests behind one regular summary create exactly one ordered final pass', async () => {
  const f = fixture()
  const gate = deferred<void>()
  const executions: boolean[] = []
  let active = 0
  let overlap = 0
  f.internal.generate = async (_id, final) => {
    executions.push(final)
    active++
    overlap = Math.max(overlap, active)
    if (executions.length === 1) await gate.promise
    active--
  }
  const regular = f.internal.makeSummary('A', false)
  const finals = Array.from({ length: 4 }, () => f.internal.makeSummary('A', true))
  assert.deepEqual(executions, [false])
  gate.resolve()
  await Promise.all([regular, ...finals])
  assert.deepEqual(executions, [false, true])
  assert.equal(overlap, 1)
  assert.equal(f.internal.state.get('A')?.busy, undefined)
})

test('long summaries cover every original segment in bounded, progressive model calls', async () => {
  const lines = Array.from({ length: 105 }, (_, i) => ({
    startMs: i * 1000, endMs: i * 1000 + 900,
    text: 'TOKEN_' + String(i).padStart(3, '0') + '_' + 'x'.repeat(700),
    speakerId: null,
  }))
  const f = fixture(lines)
  await f.internal.makeSummary('A', true)
  assert.ok(f.prompts.length >= 3)
  assert.equal(f.covered.at(-1), lines.length)
  assert.ok(f.covered.every((n, i) => i === 0 || n > f.covered[i - 1]!))
  for (const prompt of f.prompts) {
    const added = prompt.split('新增会议原文：\n')[1]!.split('\n\n')[0]!
    assert.ok(added.length <= 25_000, 'model prompt input must stay within complete-segment limit')
  }
  const allAdded = f.prompts.map(p => p.split('新增会议原文：\n')[1]!.split('\n\n')[0]!)
  for (let i = 0; i < lines.length; i++) {
    const marker = 'TOKEN_' + String(i).padStart(3, '0') + '_'
    assert.equal(allAdded.filter(chunk => chunk.includes(marker)).length, 1, marker)
  }
})

test('stopped Session manual busy summary retries after Agent becomes idle', async () => {
  const f = fixture([{ startMs: 0, endMs: 1000, text: 'real transcript', speakerId: null }])
  // Existing summary already covers all lines; the user's manual re-run still matters.
  await f.internal.makeSummary('A', false)
  assert.deepEqual(f.covered, [1])
  f.setAgentBusy(true)
  const original = globalThis.setInterval
  let fire: (() => void) | undefined
  globalThis.setInterval = ((callback: () => void) => {
    fire = callback
    return original(() => {}, 100_000)
  }) as typeof setInterval
  try {
    await f.control.summarize('A')
    assert.equal(f.internal.state.get('A')?.deferred, true)
    assert.equal(f.prompts.length, 1)
    assert.ok(fire)
    f.setAgentBusy(false)
    fire!()
    // Wait for the asynchronous retry task without a 10-second wall-clock delay.
    for (let i = 0; i < 30 && f.covered.length < 2; i++) await new Promise<void>(r => setImmediate(r))
    assert.deepEqual(f.covered, [1, 1])
    assert.equal(f.prompts.length, 2)
    assert.equal(f.internal.state.get('A')?.deferred, false)
    assert.equal(f.internal.deferredTimers.size, 0)
  } finally {
    for (const timer of f.internal.deferredTimers.values()) clearInterval(timer)
    globalThis.setInterval = original
  }
})
