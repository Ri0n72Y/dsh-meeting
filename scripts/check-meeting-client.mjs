/** Minimal artifact contract: a DSH client file is a classic script whose only
 * initial action is registering its lazy factory. No simulated Desktop. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Script } from 'node:vm'

const content = await readFile(new URL('../lib/client/index.js', import.meta.url), 'utf8')
const registrations = []
const script = new Script(content, { filename: 'meeting-client.js' })
script.runInNewContext({ window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
assert.equal(registrations.length, 1, 'one factory must register')
assert.equal(registrations[0].id, '@ri0n72y/dsh-meeting')
assert.equal(typeof registrations[0].factory, 'function')
assert.match(content, /pluginCss/, 'CSS Modules must be compiled into the factory')
console.log('Client artifact: classic script, lazy-CJS registration, CSS Modules OK')
