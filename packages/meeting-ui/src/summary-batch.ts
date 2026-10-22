/** Durable summary cursors count complete segments, not prompt characters. */
import type { MeetingLine } from '@ri0n72y/dsh-meeting-context'

export function summaryCursor(markdown: string): number {
  const match = markdown.match(/<!-- meeting-covered: (\d+) -->/)
  const value = Number(match?.[1] ?? 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function transcriptBatch(segments: readonly MeetingLine[], cursor: number): { text: string; end: number } {
  const lines: string[] = []
  let length = 0
  let end = cursor
  while (end < segments.length) {
    const line = segments[end]!
    const row = '[' + (line.startMs / 1000).toFixed(1) + 's] '
      + (line.speakerId ?? '未知说话人') + ': ' + line.text
    if (lines.length && length + row.length + 1 > 25_000) break
    lines.push(row)
    length += row.length + 1
    end++
  }
  return { text: lines.join('\n'), end }
}
