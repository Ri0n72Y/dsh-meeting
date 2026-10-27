import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore } from '../src/context/store.js'
import { transcriptMarkdown } from '../src/context/markdown.js'
import { transcriptParagraphs } from '../src/context/transcript.js'

test('live Session writes a readable projection; original 5-second segments stay intact', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'meeting-markdown-'))
  try {
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await store.begin('foo')
    await store.append('foo', { startMs: 6000, endMs: 11000, text: '你好，欢迎参加会议', speakerId: null })
    await store.append('foo', { startMs: 11000, endMs: 16000, text: '今天讨论进度。', speakerId: null })
    const text = await store.readDocument('foo', 'transcript.md')
    assert.equal(text, '# 会议原文\n\n**00:00:06**  你好，欢迎参加会议今天讨论进度。\n\n')
    assert.doesNotMatch(text, /未知说话人|^###/mu)
    const raw = await store.read('foo')
    assert.equal(raw?.segments.length, 2)
    assert.equal(raw?.segments[0]?.text, '你好，欢迎参加会议')
    await store.finish('foo')
    assert.equal((await store.read('foo'))?.phase, 'stopped')
    await store.saveSummary('foo', '# 会议总结\n\n完成')
    assert.equal(await store.readDocument('foo', 'summary.md'), '# 会议总结\n\n完成')
    assert.equal(transcriptMarkdown((await store.read('foo'))!), await store.readDocument('foo', 'transcript.md'))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('speaker changes, pauses and paragraph length yield boundaries, not 5-second headings', () => {
  const lines = [
    { startMs: 0, endMs: 5000, text: '在上期视频里我讲了一个核心判断，', speakerId: null },
    { startMs: 5000, endMs: 10000, text: '伊朗之所以变成今天这个样子。', speakerId: null },
    { startMs: 10000, endMs: 15000, text: '是因为一个复杂的历史过程。', speakerId: null },
    { startMs: 18000, endMs: 22000, text: '接下来由我说明。', speakerId: 'Speaker 1' },
    { startMs: 22000, endMs: 25000, text: '这是后续内容。', speakerId: 'Speaker 1' },
    { startMs: 27000, endMs: 28000, text: '我补充。', speakerId: 'Speaker 2' },
  ]
  const paragraphs = transcriptParagraphs(lines)
  assert.deepEqual(paragraphs.map(x => x.segments), [3, 2, 1])
  assert.equal(paragraphs[0]?.text, '在上期视频里我讲了一个核心判断，伊朗之所以变成今天这个样子。是因为一个复杂的历史过程。')
  const markdown = transcriptMarkdown({ sessionId: 'foo', phase: 'stopped', revision: 6, segments: lines })
  assert.equal((markdown.match(/\*\*[0-9]{2}:[0-9]{2}:[0-9]{2}/gu) ?? []).length, 3)
  assert.match(markdown, /\*\*00:00:18 · Speaker 1\*\*/)
  assert.match(markdown, /\*\*00:00:27 · Speaker 2\*\*/)
  assert.doesNotMatch(markdown, /00:00:05|未知说话人|^###/mu)
})

test('Markdown escapes recognition markup without rewriting raw state or ASR punctuation', () => {
  const snapshot = { sessionId: 'A', phase: 'recording' as const, revision: 0, segments: [
    { startMs: 0, endMs: 1000, text: '# heading?\r\n> quoted\n- list', speakerId: null },
    { startMs: 1000, endMs: 2000, text: '的伊朗视频里。', speakerId: null },
    { startMs: 2000, endMs: 3000, text: '<script>*literal*</script>', speakerId: null },
  ] }
  const before = JSON.stringify(snapshot)
  const text = transcriptMarkdown(snapshot)
  assert.ok(text.includes('\\# heading?'))
  assert.ok(text.includes('\\> quoted'))
  assert.ok(text.includes('- list'))
  assert.ok(text.includes('的伊朗视频里。'))
  assert.ok(text.includes('\\<script\\>\\*literal\\*'))
  assert.equal(JSON.stringify(snapshot), before)
})

test('long continuous speech splits into readable paragraphs without losing segment text', () => {
  const segments = Array.from({ length: 20 }, (_, i) => ({
    startMs: i * 5000, endMs: i * 5000 + 5000,
    text: '这是一段测试文字' + i + '。', speakerId: null,
  }))
  const paragraphs = transcriptParagraphs(segments)
  assert.ok(paragraphs.length >= 2)
  assert.ok(paragraphs.length < segments.length)
  assert.equal(paragraphs.reduce((n, x) => n + x.segments, 0), segments.length)
  for (const line of segments) assert.ok(paragraphs.some(p => p.text.includes(line.text)))
})
