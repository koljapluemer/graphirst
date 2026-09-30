import {
  NOTE_LIST_PAGE_SIZE,
  type IndexedNote,
  type RecentNote,
  type RecentNotesResponse,
  type RecentNotesSort
} from '../shared/notes'
import { buildNotePreview } from './note-preview'

interface RankedNote {
  note: IndexedNote
  timestamp: string
}

/** Newest first; equal timestamps fall back to filename so the order is stable across refreshes. */
function compareRecency(a: RankedNote, b: RankedNote): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp > b.timestamp ? -1 : 1
  }
  return a.note.filename < b.note.filename ? -1 : a.note.filename > b.note.filename ? 1 : 0
}

/** Index at which `candidate` belongs in `ranked` (already ordered by compareRecency). */
function findInsertionIndex(ranked: RankedNote[], candidate: RankedNote): number {
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

function toRecentNote({ note, timestamp }: RankedNote): RecentNote {
  return {
    filename: note.filename,
    preview: buildNotePreview(note),
    timestamp
  }
}

/**
 * One page of notes by the chosen lifecycle timestamp, newest first, plus how many
 * notes carry that timestamp at all. One pass over the index keeping a ranking
 * bounded to the end of the requested page, so cost stays O(n log k) with no full
 * sort, and previews are built for the returned page only. Notes never stamped
 * with that timestamp are skipped. ISO-8601 UTC strings order chronologically
 * under plain string comparison, which is all this store writes.
 */
export function selectRecentNotes(
  notes: Iterable<IndexedNote>,
  sort: RecentNotesSort,
  page: number
): RecentNotesResponse {
  const start = page * NOTE_LIST_PAGE_SIZE
  const bound = start + NOTE_LIST_PAGE_SIZE
  const ranked: RankedNote[] = []
  let total = 0

  for (const note of notes) {
    const timestamp = note[sort]
    if (timestamp === null) {
      continue
    }

    total += 1
    const candidate = { note, timestamp }
    const index = findInsertionIndex(ranked, candidate)
    if (index >= bound) {
      continue
    }

    ranked.splice(index, 0, candidate)
    if (ranked.length > bound) {
      ranked.pop()
    }
  }

  return { results: ranked.slice(start).map(toRecentNote), total }
}
