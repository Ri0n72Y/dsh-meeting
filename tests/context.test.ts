import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, readFile, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore, sessionDirectoryName, workspaceMeetingRoot } from '../packages/meeting-context/src/store.js'
import { SessionWorkspaceCache } from '../packages/meeting-context/src/cache.js'

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

test('concurrent journal writes are serialized', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-meeting-'))
  try {
    const store = new MeetingStore(dir)
    await store.begin('alpha')
    await Promise.all([
      store.append('alpha', { startMs: 1000, endMs: 2000, text: 'one', speakerId: 'Speaker 1' }),
      store.append('alpha', { startMs: 2000, endMs: 3000, text: 'two', speakerId: 'Speaker 2' }),
    ])
    assert.equal((await store.read('alpha'))?.segments.length, 2)
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
    assert.match(sessionDirectoryName('../escape'), /^[a-f0-9]{64}$/)
    assert.notEqual(sessionDirectoryName('team:demo'), sessionDirectoryName('team/demo'))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('DSH Session without cwd uses the Host workspace, never DSH_HOME', async () => {
  const host = join(tmpdir(), 'host-session-root')
  assert.equal(workspaceMeetingRoot(undefined, host), join(host, '.dsh-meeting'))
  assert.equal(workspaceMeetingRoot(join(host, 'project'), host), join(host, 'project', '.dsh-meeting'))
})

test('pre-existing workspace ignore rules remain unchanged, audio stays Git-ignored', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-protect-'))
  try {
    const root = join(cwd, '.dsh-meeting')
    await mkdir(root)
    const authored = '# authored by user\n!private.txt\n'
    await writeFile(join(root, '.gitignore'), authored)
    const store = new MeetingStore(root)
    await store.begin('alpha')
    const audio = await store.prepareAudio('alpha')
    assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), authored)
    assert.equal(await readFile(join(store.directory('alpha'), '.gitignore'), 'utf8'), '*\n!/.gitignore\n')
    assert.equal(audio, join(store.directory('alpha'), 'audio'))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('Session identity cache cannot reuse the prior Session workspace', () => {
  const cache = new SessionWorkspaceCache()
  const a = { id: 'same', cwd: '/workspace-A' }
  const b = { id: 'same', cwd: '/workspace-B' }
  const first = cache.get(a, a.id, () => new MeetingStore(join(a.cwd, '.dsh-meeting')))
  const second = cache.get(b, b.id, () => new MeetingStore(join(b.cwd, '.dsh-meeting')))
  assert.notEqual(first, second)
  cache.release(a, a.id)
  assert.equal(cache.get(b, b.id, () => { throw new Error('cache lost B') }), second)
  cache.release(b, b.id)
  assert.notEqual(cache.get(b, b.id, () => new MeetingStore('/again')), second)
})

test('reject .dsh-meeting symlink escaping workspace before any journal write', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-escape-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
  try {
    await symlink(outside, join(cwd, '.dsh-meeting'), 'dir')
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await assert.rejects(store.begin('alpha'), /escapes Session Workspace/)
    await assert.rejects(store.read('alpha'), /escapes Session Workspace/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('reject Session audio directory symlink escaping workspace', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-audio-escape-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
  try {
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await store.begin('alpha')
    await symlink(outside, join(store.directory('alpha'), 'audio'), 'dir')
    await assert.rejects(store.prepareAudio('alpha'), /escapes Session Workspace/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('reject a symlinked hashed session directory and a symlinked state file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-session-escape-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-target-'))
  try {
    const store = new MeetingStore(join(cwd, '.dsh-meeting'))
    await mkdir(join(cwd, '.dsh-meeting'))
    await symlink(outside, store.directory('alpha'), 'dir')
    await assert.rejects(store.begin('alpha'), /escapes Session Workspace/)
    await rm(store.directory('alpha'))
    await store.begin('alpha')
    await rm(join(store.directory('alpha'), 'state.json'))
    await writeFile(join(outside, 'other.json'), '{"data":"secret"}')
    await symlink(join(outside, 'other.json'), join(store.directory('alpha'), 'state.json'))
    await assert.rejects(store.read('alpha'), /escapes Session Workspace/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
