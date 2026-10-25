import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SpeakerTracker, type EmbeddingEngine } from '../src/speaker/tracker.js'

function engine(): EmbeddingEngine {
  return {
    embed(samples) { return new Float32Array([samples[0]!, 1 - samples[0]!]) },
    manager() {
      const voices = new Map<string, Float32Array>()
      return {
        search({ v, threshold }) {
          for (const [name, prior] of voices) {
            if (Math.abs(v[0]! - prior[0]!) < threshold / 2) return name
          }
          return ''
        },
        addMulti({ name, v }) { voices.set(name, v[0]!); return true },
      }
    },
  }
}
test('speaker identity is reused within a Session and isolated between Sessions', () => {
  const tracker = new SpeakerTracker(engine(), 0.6)
  const a = new Float32Array(1600).fill(0.1)
  const b = new Float32Array(1600).fill(0.9)
  assert.equal(tracker.identify('meeting-a', a), 'Speaker 1')
  assert.equal(tracker.identify('meeting-a', b), 'Speaker 2')
  assert.equal(tracker.identify('meeting-a', a), 'Speaker 1')
  assert.equal(tracker.identify('meeting-b', b), 'Speaker 1')
  assert.equal(tracker.identify('meeting-a', new Float32Array(100)), null)
})
test('recovered session does not claim new embeddings match previous identities', () => {
  const tracker = new SpeakerTracker(engine())
  tracker.seed('reopened', 4)
  assert.equal(tracker.identify('reopened', new Float32Array(1600).fill(0.5)), 'Speaker 4')
})

test('short or invalid speaker embeddings never acquire an identity', () => {
  const e: EmbeddingEngine = {
    embed(samples) { return new Float32Array([samples[0]!]) },
    manager() { return { search() { return '' }, addMulti() { throw new Error('must not persist invalid identity') } } },
  }
  const tracker = new SpeakerTracker(e)
  assert.equal(tracker.identify('A', new Float32Array(1599)), null)
  assert.equal(tracker.identify('A', new Float32Array(1600).fill(Number.NaN)), null)
  for (const value of [0, -2, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(() => tracker.seed('B', value), /Invalid next speaker number/)
  }
})
