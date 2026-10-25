/** Explicitly build the WASAPI N-API addon on Windows x64.
 * This script is NOT executed by the Git installation lifecycle. */
import { spawnSync } from 'node:child_process'
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('Meeting WASAPI native build: skipped (requires Windows x64)')
  process.exit(0)
}
function run(args) {
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Meeting WASAPI native build failed: npm ' + args.join(' '))
}
run(['install', '--prefix', 'native', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts'])
run(['run', 'build', '--prefix', 'native'])
