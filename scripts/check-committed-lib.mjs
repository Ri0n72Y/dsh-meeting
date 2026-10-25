/** Compare the complete output of a clean build with the committed Git distribution. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const tracked = git(['ls-files', '--', 'lib/']).split('\n').filter(Boolean).sort()
const entries = await readdir(new URL('../lib/', import.meta.url), { recursive: true, withFileTypes: true })
const actual = entries.filter(entry => entry.isFile())
  .map(entry => relative(cwd, resolve(entry.parentPath, entry.name)).split(sep).join('/')).sort()
assert.deepEqual(actual, tracked, 'Clean build output file set differs from tracked lib/')
const diff = git(['status', '--porcelain', '--untracked-files=all', '--', 'lib/'])
assert.equal(diff, '', 'Clean build output differs from committed lib/:\n' + diff)
console.log('Committed lib/: clean build matches the complete tracked output set and contents')
