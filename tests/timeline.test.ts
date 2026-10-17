import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SpeakerTimeline } from '../packages/meeting-speaker/src/timeline.js'
import { SpeakerTracker } from '../packages/meeting-speaker/src/tracker.js'

test('speaker turns split one mixed window without pretending ASR words align', () => {
  const tracker = new SpeakerTracker({
    embed: pcm => new Float32Array([pcm[0]!]),
    manager() {
      const known = new Map<number, string>()
      return {
        search: ({ v }) => known.get(Math.round(v[0]! * 10)) ?? '',
        addMulti: ({ name, v }) => { known.set(Math.round(v[0]![0]! * 10), name); return true },
      }
    },
  })
  const diarization = new SpeakerTimeline({ process: () => [
    { start: 0, end: 2, speaker: 0 }, { start: 2, end: 4, speaker: 1 },
  ] }, tracker)
  const pcm = new Float32Array(64_000)
  pcm.fill(0.1, 0, 32_000); pcm.fill(0.9, 32_000)
  assert.deepEqual(diarization.diarize('session', pcm), [
    { startMs: 0, endMs: 2000, speakerId: 'Speaker 1' },
    { startMs: 2000, endMs: 4000, speakerId: 'Speaker 2' },
  ])
})
