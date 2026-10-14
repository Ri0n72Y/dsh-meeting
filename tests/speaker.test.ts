import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SpeakerTracker, type EmbeddingEngine } from '../packages/meeting-speaker/src/tracker.js'

test('speaker identity is reused within a Session and isolated between Sessions', () => {
  const engine: EmbeddingEngine = {
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
  const tracker = new SpeakerTracker(engine, 0.6)
  const a = new Float32Array(1600).fill(0.1)
  const b = new Float32Array(1600).fill(0.9)
  assert.equal(tracker.identify('meeting-a', a), 'Speaker 1')
  assert.equal(tracker.identify('meeting-a', b), 'Speaker 2')
  assert.equal(tracker.identify('meeting-a', a), 'Speaker 1')
  assert.equal(tracker.identify('meeting-b', b), 'Speaker 1')
  assert.equal(tracker.identify('meeting-a', new Float32Array(100)), null)
})
