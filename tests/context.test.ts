import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore, sessionDirectoryName } from '../packages/meeting-context/src/store.js'

test('Session-scoped journal survives service recreation and remains isolated', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
  try {
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await store.begin('session-one')
    await store.append('session-one', { startMs: 0, endMs: 800, text: 'First remark', speakerId: null })
    assert.equal((await store.read('session-two')), null)
    const recovered = new MeetingStore(join(cwd, '.dsh-meeting'))
    assert.equal((await recovered.read('session-one'))?.segments[0]?.text, 'First remark')
    assert.equal((await recovered.finish('session-one')).phase, 'stopped')
    await assert.rejects(store.begin('session-one'), /already exists/)
    await assert.rejects(store.resume('session-one'), /No resumable/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('recording state after crash or disk error can resume with transcript intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
  try {
    const first = new MeetingStore(dir)
    await first.begin('alpha')
    await first.append('alpha', { startMs: 1000, endMs: 2000, text: 'first', speakerId: 'Speaker 1' })
    const rebooted = new MeetingStore(dir)
    assert.equal((await rebooted.resume('alpha')).phase, 'recording')
    assert.equal((await rebooted.interrupt('alpha', 'disk full')).phase, 'interrupted')
    const restored = await rebooted.resume('alpha')
    assert.equal(restored.segments.length, 1)
    assert.equal(restored.interruption, undefined)
    await rebooted.append('alpha', { startMs: 2000, endMs: 3000, text: 'second', speakerId: 'Speaker 2' })
    assert.equal((await rebooted.finish('alpha')).phase, 'stopped')
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
    assert.match(sessionDirectoryName('../escape'), /^[a-f0-9]{64}$/)
    assert.notEqual(sessionDirectoryName('team:demo'), sessionDirectoryName('team/demo'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('opaque Session IDs are safe and meeting audio is ignored by workspace Git', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-workspace-'))
  try {
    const root = join(cwd, '.dsh-meeting')
    const store = new MeetingStore(root)
    await store.begin('team:demo/meeting.1')
    assert.equal((await store.read('team:demo/meeting.1'))?.sessionId, 'team:demo/meeting.1')
    assert.equal((await store.read('team:demo/meeting.2')), null)
    assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), '*\n!/.gitignore\n')
    assert.match(store.directory('team:demo/meeting.1'), /[a-f0-9]{64}$/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
