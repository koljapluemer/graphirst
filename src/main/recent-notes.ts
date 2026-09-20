import type { IndexedNote, RecentNote, RecentNotesSort } from '../shared/notes'
import { buildNotePreview } from './note-preview'

export const RECENT_NOTES_LIMIT = 40

/** Newest first; equal timestamps fall back to filename so the order is stable across refreshes. */
function compareRecency(a: RecentNote, b: RecentNote): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp > b.timestamp ? -1 : 1
  }
  return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0
}

/** Index at which `candidate` belongs in `ranked` (already ordered by compareRecency). */
function findInsertionIndex(ranked: RecentNote[], candidate: RecentNote): number {
  let low = 0
  let high = ranked.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compareRecency(ranked[middle], candidate) <= 0) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function toRecentNote(note: IndexedNote, timestamp: string): RecentNote {
  return {
    filename: note.filename,
    preview: buildNotePreview(note),
    timestamp
  }
}

/**
 * The `limit` most recent notes by the chosen lifecycle timestamp, newest first.
 * One pass over the index keeping a bounded ranking, so cost stays O(n log limit)
 * with no full sort and no preview built for notes that don't make the cut.
 * Notes never stamped with that timestamp are skipped. ISO-8601 UTC strings order
 * chronologically under plain string comparison, which is all this store writes.
 */
export function selectRecentNotes(
  notes: Iterable<IndexedNote>,
  sort: RecentNotesSort,
  limit: number = RECENT_NOTES_LIMIT
): RecentNote[] {
  const ranked: RecentNote[] = []

  for (const note of notes) {
    const timestamp = note[sort]
    if (timestamp === null) {
      continue
    }

    const candidate = { filename: note.filename, preview: '', timestamp }
    const index = findInsertionIndex(ranked, candidate)
    if (index >= limit) {
      continue
    }

    ranked.splice(index, 0, toRecentNote(note, timestamp))
    if (ranked.length > limit) {
      ranked.pop()
    }
  }

  return ranked
}
