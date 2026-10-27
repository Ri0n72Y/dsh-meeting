import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summaryCursor, transcriptBatch } from '../src/ui/summary-batch.js'
import { transcriptParagraphs, transcriptTimestamp } from '../src/context/transcript.js'

test('summary cursor accepts only valid nonnegative integer checkpoints', () => {
  assert.equal(summaryCursor('empty'), 0)
  assert.equal(summaryCursor('<!-- meeting-covered: 13 -->'), 13)
  assert.equal(summaryCursor('<!-- meeting-covered: -1 -->'), 0)
  assert.equal(summaryCursor('untrusted meeting-covered: 99'), 0)
})

test('summary uses the same human-readable paragraphs without unknown-speaker spam', () => {
  const lines = [
    { startMs: 0, endMs: 5000, text: '我们先讨论第一项。', speakerId: null },
    { startMs: 5000, endMs: 10000, text: '然后讨论第二项。', speakerId: null },
  ]
  const batch = transcriptBatch(lines, 0)
  assert.equal(batch.end, 2)
  assert.equal(batch.text, '[00:00:00] 我们先讨论第一项。然后讨论第二项。')
  assert.equal(transcriptParagraphs(lines)[0]?.segments, 2)
  assert.equal(transcriptTimestamp(3723000), '01:02:03')
})

test('large transcript batches advance by complete segments exactly once', () => {
  const lines = Array.from({ length: 105 }, (_, i) => ({
    startMs: i * 1000, endMs: i * 1000 + 900,
    text: 'MARKER_' + i + '_' + 'x'.repeat(700), speakerId: null,
  }))
  let offset = 0
  const chunks: string[] = []
  while (offset < lines.length) {
    const next = transcriptBatch(lines, offset)
    assert.ok(next.end > offset)
    assert.ok(next.text.length <= 25_000)
    chunks.push(next.text)
    offset = next.end
  }
  assert.ok(chunks.length > 1)
  for (let i = 0; i < lines.length; i++) {
    const key = 'MARKER_' + i + '_'
    assert.equal(chunks.filter(s => s.includes(key)).length, 1)
  }
})

test('summary cursor can begin mid-paragraph without duplication or missing words', () => {
  const lines = Array.from({ length: 7 }, (_, i) => ({
    startMs: i * 5000, endMs: i * 5000 + 5000,
    text: '片段' + i + '。', speakerId: null,
  }))
  const next = transcriptBatch(lines, 3)
  assert.equal(next.end, 7)
  assert.doesNotMatch(next.text, /片段[012]/u)
  for (let i = 3; i < 7; i++) assert.ok(next.text.includes('片段' + i + '。'))
})
