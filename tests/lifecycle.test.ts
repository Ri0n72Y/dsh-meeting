import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionCaptureRegistry } from '../packages/meeting-capture/src/lifecycle.js'
import { ContinuousCapture } from '../packages/meeting-capture/src/continuous.js'
import { SAMPLE_RATE } from '../packages/meeting-capture/src/wav.js'

function capture() {
  return new ContinuousCapture({
    async persist() {},
    async process() { return null },
  })
}
test('disposing Session A interrupts A, leaves B recording, and settles A without live Session lookup', async () => {
  const registry = new SessionCaptureRegistry()
  const settled: Array<[string, boolean]> = []
  const a = capture()
  const b = capture()
  registry.add('A', {
    capture: a,
    async settle(receipt) { settled.push(['A', receipt.interrupted]) },
    release() {},
  })
  registry.add('B', {
    capture: b,
    async settle(receipt) { settled.push(['B', receipt.interrupted]) },
    release() {},
  })
  await a.push(new Float32Array(SAMPLE_RATE).fill(0.1))
  await b.push(new Float32Array(SAMPLE_RATE).fill(0.1))
  await registry.cancel('A', new Error('session/disposed'))
  assert.equal(registry.has('A'), false)
  assert.equal(registry.has('B'), true)
  assert.deepEqual(settled, [['A', true]])
  assert.equal((await registry.stop('B')).interrupted, false)
  assert.deepEqual(settled, [['A', true], ['B', false]])
})
test('concurrent stopping and disposal settle a capture once', async () => {
  const registry = new SessionCaptureRegistry()
  let settlements = 0
  registry.add('A', {
    capture: capture(),
    async settle() { settlements++ },
    release() {},
  })
  const stopped = registry.stop('A')
  await registry.cancel('A', new Error('session disposed during stop'))
  await stopped
  assert.equal(settlements, 1)
})

test('failed Session settlement still releases its lease and permits reacquisition', async () => {
  const registry = new SessionCaptureRegistry()
  let released = 0
  const old = capture()
  registry.add('A', {
    capture: old,
    async settle() { throw new Error('state write failed') },
    release() { released++ },
  })
  await assert.rejects(registry.stop('A'), /state write failed/)
  assert.equal(released, 1)
  assert.equal(registry.has('A'), false)
  registry.add('A', { capture: capture(), async settle() {}, release() { released++ } })
  await registry.stop('A')
  assert.equal(released, 2)
})
