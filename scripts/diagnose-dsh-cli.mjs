/**
 * Diagnostic-only wrapper for intermittent dsh plugin CLI non-exit.
 * No production package changes. Print bounded process snapshots WITHOUT environment variables.
 * Exit code is identical to GNU timeout/CLI: 124 means 65-second timeout.
 */
import { spawn, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const started = Date.now()
const command = ['--signal=TERM', '--kill-after=5s', '65s',
  'pnpm', 'dlx', '@deepseek-ai/dsh@0.2.0-rc.2', ...args]

const child = spawn('timeout', command, { stdio: 'inherit' })
const label = args.join(' ')
const log = message => process.stderr.write('[dsh-cli-diag] ' + message + '\n')
log('START timeout_pid=' + String(child.pid ?? 'unknown') + ' command=' + label)

let closed = false
const snapshot = () => {
  if (closed) return
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  try {
    const lines = execFileSync('ps', ['-eo', 'pid,ppid,pgid,stat,etime,wchan:20,comm,args'], {
      encoding: 'utf8', timeout: 4000,
    }).trimEnd().split('\n')
    const matching = lines.filter(line =>
      /^\s*PID\b/.test(line) || /\b(?:node|pnpm|dsh|timeout)\b/i.test(line))
    log('SNAPSHOT elapsed=' + elapsed + 's processes=' + String(matching.length - 1))
    for (const line of matching.slice(0, 50)) process.stderr.write('[dsh-cli-diag] ' + line + '\n')
  } catch (error) {
    log('SNAPSHOT_ERROR: ' + String(error))
  }
}
// A fast normal invocation logs no snapshots; a hang logs one every 10s.
const timer = setInterval(snapshot, 10_000)
child.on('error', error => { log('SPAWN_ERROR ' + String(error)) })
child.on('exit', (code, signal) => {
  log('EXIT elapsed=' + ((Date.now() - started) / 1000).toFixed(1)
    + 's code=' + String(code) + ' signal=' + String(signal))
})
child.on('close', (code, signal) => {
  closed = true
  clearInterval(timer)
  log('CLOSE elapsed=' + ((Date.now() - started) / 1000).toFixed(1)
    + 's code=' + String(code) + ' signal=' + String(signal))
  process.exitCode = code ?? 1
})
