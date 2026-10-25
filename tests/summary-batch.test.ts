import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summaryCursor, transcriptBatch } from '../src/ui/summary-batch.js'

test('summary cursor accepts only valid nonnegative integer checkpoints', () => {
  assert.equal(summaryCursor('empty'), 0)
  assert.equal(summaryCursor('<!-- meeting-covered: 13 -->'), 13)
  assert.equal(summaryCursor('<!-- meeting-covered: -1 -->'), 0)
  assert.equal(summaryCursor('untrusted meeting-covered: 99'), 0)
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
