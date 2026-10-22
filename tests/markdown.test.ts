import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore } from '../packages/meeting-context/src/store.js'
import { transcriptMarkdown } from '../packages/meeting-context/src/markdown.js'

test('live Session appends atomically projected Markdown, preserving unknown speaker', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'meeting-markdown-'))
  try {
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await store.begin('foo')
    await store.append('foo', { startMs: 6000, endMs: 11000, text: '你好，欢迎参加会议',
      speakerId: null })
    const text = await store.readDocument('foo', 'transcript.md')
    assert.match(text, /00:00:06.*00:00:11/)
    assert.match(text, /未知说话人/)
    assert.match(text, /你好，欢迎参加会议/)
    await store.finish('foo')
    assert.equal((await store.read('foo'))?.phase, 'stopped')
    await store.saveSummary('foo', '# 会议总结\n\n完成')
    assert.equal(await store.readDocument('foo', 'summary.md'), '# 会议总结\n\n完成')
    assert.equal(transcriptMarkdown((await store.read('foo'))!), await store.readDocument('foo', 'transcript.md'))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('Markdown projection escapes user text and normalizes multi-line content without rewriting state', () => {
  const snapshot = { sessionId: 'A', phase: 'recording' as const, revision: 0, segments: [
    { startMs: 0, endMs: 1000, text: '# heading?\r\n> quoted\n- list', speakerId: null },
  ] }
  const before = JSON.stringify(snapshot)
  const text = transcriptMarkdown(snapshot)
  assert.ok(text.includes('\\# heading?'))
  assert.ok(text.includes('\\> quoted'))
  assert.ok(text.includes('\\- list'))
  assert.ok(text.includes('00:00:00–00:00:01'))
  assert.equal(JSON.stringify(snapshot), before)
})
