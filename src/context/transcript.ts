/** Human-readable view over immutable ASR windows; it never edits recognized words. */
import type { MeetingLine } from './store.js'

/** A paragraph retains its source-window count for incremental summary cursors. */
export interface TranscriptParagraph {
  readonly startMs: number
  readonly endMs: number
  readonly speakerId: string | null
  readonly text: string
  readonly segments: number
}

const MIN_PARAGRAPH_CHARS = 140
const MAX_PARAGRAPH_CHARS = 360
const MAX_PARAGRAPH_MS = 35_000
const PAUSE_MS = 2_500
const SENTENCE_END = /[。！？.!?]["”’）)]*$/u

/** Distinguish English words across windows without inserting spaces into Chinese. */
function joinText(before: string, after: string): string {
  const space = /[A-Za-z0-9.!?,;:]$/u.test(before) && /^[A-Za-z0-9]/u.test(after) ? ' ' : ''
  return before + space + after
}

export function transcriptTimestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(x => String(x).padStart(2, '0')).join(':')
}

/**
 * Window edges are transport details, not paragraph boundaries.
 * Use explicit speaker changes, real gaps, and bounded text length; never
 * infer missing words, remove ASR punctuation, or invent a speaker identity.
 */
export function transcriptParagraphs(lines: readonly MeetingLine[]): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = []
  let current: TranscriptParagraph | undefined
  for (const line of lines) {
    const text = line.text.trim().replace(/\s+/gu, ' ')
    const split = current && (
      line.speakerId !== current.speakerId
      || line.startMs - current.endMs >= PAUSE_MS
      || current.text.length + text.length > MAX_PARAGRAPH_CHARS
      || line.endMs - current.startMs > MAX_PARAGRAPH_MS
      || (current.text.length >= MIN_PARAGRAPH_CHARS && SENTENCE_END.test(current.text))
    )
    if (!current || split) {
      current = { startMs: line.startMs, endMs: line.endMs,
        speakerId: line.speakerId, text, segments: 1 }
      paragraphs.push(current)
    } else {
      current = { ...current, endMs: line.endMs,
        text: joinText(current.text, text), segments: current.segments + 1 }
      paragraphs[paragraphs.length - 1] = current
    }
  }
  return paragraphs
}
