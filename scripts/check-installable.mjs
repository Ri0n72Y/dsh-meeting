/** Inspect the actual npm pack list; Git prepares the same root package. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.name, '@ri0n72y/dsh-meeting')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(pkg.dsh.client.platform, 'web')
assert.equal(pkg.engines.dsh, '>=0.2.1-rc.3')
assert.match(pkg.scripts.prepare, /build/)
const installed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8', cwd: new URL('..', import.meta.url),
}))
const files = new Set(installed[0].files.map(file => file.path))
for (const path of [
  'cordis.patch.yml',
  'dist/ui/index.js', 'dist/context/index.js',
  'dist/capture/index.js', 'dist/speaker/index.js',
  'dist/client/index.js',
  'native/CMakeLists.txt', 'native/package.json',
  'native/src/Addon.cpp', 'native/src/platform/windows/LoopbackCapture.cpp',
  'scripts/build-native.mjs',
]) assert.ok(files.has(path), 'git/npm package misses ' + path)
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
for (const name of ['@ri0n72y/dsh-meeting', '@ri0n72y/dsh-meeting/context', '@ri0n72y/dsh-meeting/speaker', '@ri0n72y/dsh-meeting/capture']) {
  assert.ok(patch.includes("name: '" + name + "'"), 'missing bundle row ' + name)
}
assert.ok(!JSON.stringify(pkg).includes('workspace:*'), 'Git package cannot depend on workspace-only packages')
console.log('Root bundle: valid manifest, Cordis rows and packed runtime artifacts OK')
