/** Markdown is a durable, readable projection, not a second meeting state store. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile, rename, rm } from 'node:fs/promises'
import type { MeetingSnapshot } from './store.js'
import { transcriptParagraphs, transcriptTimestamp } from './transcript.js'

/** Escape Markdown formatting from ASR content without changing stored words. */
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#]/gu, '\\$&')
}

export function transcriptMarkdown(state: MeetingSnapshot): string {
  const rows = transcriptParagraphs(state.segments).map(paragraph => {
    const meta = transcriptTimestamp(paragraph.startMs)
      + (paragraph.speakerId ? ' · ' + paragraph.speakerId : '')
    return '**' + meta + '**  ' + escapeMarkdown(paragraph.text)
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
