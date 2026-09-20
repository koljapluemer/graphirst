import type { IndexedNote } from '../shared/notes'

/** How much of a note's body a sidebar card shows, from the beginning. */
export const PREVIEW_LENGTH = 180

export function buildNotePreview(note: IndexedNote): string {
  return note.bodyCompact.slice(0, PREVIEW_LENGTH) || 'Empty note'
}
