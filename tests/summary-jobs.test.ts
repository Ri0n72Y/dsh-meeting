import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SummaryJobs } from '../packages/meeting-ui/src/summary-jobs.js'

function gate() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

test('one Session coalesces regular work and schedules exactly one final after it', async () => {
  const first = gate()
  const entered = gate()
  const started: string[] = []
  let simultaneous = 0
  let max = 0
  const jobs = new SummaryJobs(async (id, final) => {
    started.push(id + ':' + (final ? 'final' : 'checkpoint'))
    simultaneous++
    max = Math.max(max, simultaneous)
    if (!final) { entered.release(); await first.wait }
    simultaneous--
  })
  const regular = jobs.run('A', false)
  await entered.wait
  const anotherRegular = jobs.run('A', false)
  const final = jobs.run('A', true)
  const repeated = jobs.run('A', true)
  assert.deepEqual(started, ['A:checkpoint'])
  first.release()
  await Promise.all([regular, anotherRegular, final, repeated])
  assert.deepEqual(started, ['A:checkpoint', 'A:final'])
  assert.equal(max, 1)
})

test('independent Sessions are not serialized together and completion permits retry', async () => {
  const a = gate()
  const visited: string[] = []
  let fail = true
  const jobs = new SummaryJobs(async (id) => {
    visited.push(id)
    if (id === 'A' && fail) {
      fail = false
      await a.wait
      throw new Error('model unavailable')
    }
  })
  const pending = jobs.run('A', false)
  await jobs.run('B', false)
  assert.deepEqual(visited, ['A', 'B'])
  a.release()
  await assert.rejects(pending, /model unavailable/)
  await jobs.run('A', true)
  assert.deepEqual(visited, ['A', 'B', 'A'])
})
