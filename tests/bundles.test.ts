import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('each meeting capability exposes an independently loadable DSH bundle', async () => {
  for (const name of ['meeting-context', 'meeting-speaker', 'meeting-capture']) {
    const dir = join(import.meta.dirname, '../packages', name)
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      name: string
      private?: boolean
      dsh?: { bundle?: { patch?: string } }
      files?: string[]
    }
    assert.notEqual(manifest.private, true, name)
    assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', name)
    assert.ok(manifest.files?.includes('cordis.patch.yml'), name)
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, new RegExp('id: ' + name + '\\n'))
    assert.ok(patch.includes('name: ' + "'@ri0n72y/dsh-" + name + "'"), name)
  }
})
