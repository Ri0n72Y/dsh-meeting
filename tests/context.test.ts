import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore } from '../packages/meeting-context/src/store.js'

test('a real Session id owns one persistent meeting; another Session is isolated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
  try {
    const store = new MeetingStore(dir)
    await store.begin('session-one')
    await store.append('session-one', { startMs: 0, endMs: 800, text: 'First remark', speakerId: null })
    assert.equal((await store.read('session-two')), null)
    const recovered = new MeetingStore(dir)
    assert.equal((await recovered.read('session-one'))?.segments[0]?.text, 'First remark')
    assert.equal((await recovered.finish('session-one')).phase, 'stopped')
    await assert.rejects(store.begin('session-one'), /already ended/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('writes are serialized and invalid Session ids are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
  try {
    const store = new MeetingStore(dir)
    await store.begin('alpha')
    await Promise.all([
      store.append('alpha', { startMs: 1000, endMs: 2000, text: 'one', speakerId: 'Speaker 1' }),
      store.append('alpha', { startMs: 2000, endMs: 3000, text: 'two', speakerId: 'Speaker 2' }),
    ])
    assert.equal((await store.read('alpha'))?.segments.length, 2)
    await assert.rejects(store.begin('../escape'), /Invalid/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
