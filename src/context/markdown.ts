/** Markdown is a durable projection, not a second meeting state store. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile, rename, rm } from 'node:fs/promises'
import type { MeetingSnapshot } from './store.js'

function stamp(ms: number): string {
  const n = Math.floor(ms / 1000)
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map(x => String(x).padStart(2, '0')).join(':')
}
export function transcriptMarkdown(state: MeetingSnapshot): string {
  const rows = state.segments.map(line => {
    const speaker = line.speakerId ?? '未知说话人'
    const text = line.text.trim().replace(/\r\n?/g, '\n').split('\n')
      .map(x => '> ' + x.replace(/^([>#*+-]|\d+\.)\s/, '\\$&')).join('\n')
    return '### ' + stamp(line.startMs) + '–' + stamp(line.endMs)
      + ' · ' + speaker + '\n\n' + text
  })
  return ['# 会议原文', '', ...rows.flatMap(row => [row, ''])].join('\n') + '\n'
}
/** Atomic same-directory replace; no partial document leaks to Preview. */
export async function writeMeetingDocument(dir: string, filename: 'transcript.md' | 'summary.md', content: string): Promise<void> {
  const target = join(dir, filename)
  const tmp = target + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(tmp, content, { flag: 'wx' })
    await rename(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}
