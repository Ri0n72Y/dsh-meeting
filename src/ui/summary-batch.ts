/** Durable summary cursors count complete ASR segments, not rendered paragraphs. */
import type { MeetingLine } from '@ri0n72y/dsh-meeting/context'
import { transcriptParagraphs, transcriptTimestamp } from '@ri0n72y/dsh-meeting/context'

export function summaryCursor(markdown: string): number {
  const match = markdown.match(/<!-- meeting-covered: (\d+) -->/)
  const value = Number(match?.[1] ?? 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function transcriptBatch(segments: readonly MeetingLine[], cursor: number): { text: string; end: number } {
  const lines: string[] = []
  let length = 0
  let end = cursor
  for (const paragraph of transcriptParagraphs(segments.slice(cursor))) {
    const row = '[' + transcriptTimestamp(paragraph.startMs) + '] '
      + (paragraph.speakerId ? paragraph.speakerId + ': ' : '') + paragraph.text
    if (lines.length && length + row.length + 2 > 25_000) break
    lines.push(row)
    length += row.length + 2
    end += paragraph.segments
  }
  return { text: lines.join('\n\n'), end }
}
