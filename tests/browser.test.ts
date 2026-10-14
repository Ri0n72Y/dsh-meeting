import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BrowserMicrophone } from '../packages/meeting-capture/src/browser.js'

test('concurrent microphone permissions cannot acquire multiple active streams', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let resolveGrant!: (value: MediaStream) => void
  const grant = new Promise<MediaStream>(resolve => { resolveGrant = resolve })
  let prompts = 0
  let stopped = 0
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => { prompts++; return grant } } },
  })
  try {
    const mic = new BrowserMicrophone()
    const first = mic.start(() => undefined)
    await assert.rejects(mic.start(() => undefined), /already started/)
    await mic.stop() // Must not block on unresolved browser permission prompt.
    resolveGrant({ getTracks: () => [{ stop: () => { stopped++ } }] } as unknown as MediaStream)
    await assert.rejects(first, /stopped/)
    assert.equal(prompts, 1)
    assert.equal(stopped, 1)
    await assert.rejects(mic.start(() => undefined), /already started or stopped/)
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
