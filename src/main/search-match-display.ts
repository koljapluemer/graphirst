import type { IndexedNote, MatchRange, SearchExcerpt } from '../shared/notes'
import { buildNotePreview, PREVIEW_LENGTH } from './note-preview'

/** Characters of surrounding text kept on each side of the match in an excerpt. */
const EXCERPT_CONTEXT = 40
/** Longest match shown highlighted in an excerpt (a broad regex can match kilobytes). */
const EXCERPT_MAX_MATCH = 60
const ELLIPSIS = '…'

export type Normalizer = (value: string) => string

/** Where a search hit sits: which (whitespace-compacted) field, and the range within it. */
export interface LocatedMatch {
  field: 'body' | 'extra'
  range: MatchRange
}

export interface MatchDisplay {
  preview: string
  previewMatch: MatchRange | null
  excerpt: SearchExcerpt | null
}

/**
 * Card content for a search hit: always the note's opening text; the match is
 * highlighted there when it's visible, otherwise a short excerpt around it is
 * returned for a second row.
 */
export function buildMatchDisplay(note: IndexedNote, located: LocatedMatch | null): MatchDisplay {
  const preview = buildNotePreview(note)
  if (!located) {
    return { preview, previewMatch: null, excerpt: null }
  }

  const { field, range } = located
  if (field === 'body' && range.start + range.length <= PREVIEW_LENGTH) {
    return { preview, previewMatch: range, excerpt: null }
  }

  const source = field === 'body' ? note.bodyCompact : note.extraCompact
  return { preview, previewMatch: null, excerpt: buildExcerpt(source, range) }
}

function buildExcerpt(source: string, range: MatchRange): SearchExcerpt {
  const length = Math.min(range.length, EXCERPT_MAX_MATCH)
  const start = Math.max(0, range.start - EXCERPT_CONTEXT)
  const end = Math.min(source.length, range.start + length + EXCERPT_CONTEXT)
  const prefix = start > 0 ? ELLIPSIS : ''
  const suffix = end < source.length ? ELLIPSIS : ''

  return {
    text: `${prefix}${source.slice(start, end)}${suffix}`,
    match: { start: prefix.length + range.start - start, length }
  }
}

/**
 * Finds where a fuzzy query lands in `compact`: the whole phrase if it occurs,
 * else the earliest of its tokens. Matching happens on normalized text (case and
 * diacritics folded) but the returned range is in `compact`'s own coordinates.
 */
export function locateFuzzyMatch(
  compact: string,
  normalizedPhrase: string,
  normalizedTokens: string[],
  normalize: Normalizer
): MatchRange | null {
  const { normalized, spans } = normalizeWithSpans(compact, normalize)
  const hit =
    findOccurrence(normalized, [normalizedPhrase]) ?? findOccurrence(normalized, normalizedTokens)
  if (!hit) {
    return null
  }

  const start = spans[hit.index].start
  const end = spans[hit.index + hit.length - 1].end
  return { start, length: end - start }
}

/** Earliest occurrence of any needle, as a range in `haystack`. */
function findOccurrence(
  haystack: string,
  needles: string[]
): { index: number; length: number } | null {
  let earliest: { index: number; length: number } | null = null
  for (const needle of needles) {
    const index = needle ? haystack.indexOf(needle) : -1
    if (index !== -1 && (earliest === null || index < earliest.index)) {
      earliest = { index, length: needle.length }
    }
  }
  return earliest
}

interface SourceSpan {
  start: number
  end: number
}

/**
 * Normalization can change length (NFKD expansion, stripped accents), so the
 * normalized string is built code point by code point, remembering for every
 * normalized unit the source span that produced it.
 */
function normalizeWithSpans(
  text: string,
  normalize: Normalizer
): { normalized: string; spans: SourceSpan[] } {
  const spans: SourceSpan[] = []
  let normalized = ''
  let position = 0

  for (const char of text) {
    const folded = normalize(char)
    const span = { start: position, end: position + char.length }
    for (let unit = 0; unit < folded.length; unit++) {
      spans.push(span)
    }
    normalized += folded
    position = span.end
  }

  return { normalized, spans }
}
