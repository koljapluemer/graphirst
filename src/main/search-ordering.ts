import type { IndexedNote, OrphanFilter } from '../shared/notes'

/**
 * Candidates re-ranked by score at the head of a result list; the tail keeps the
 * search engine's own relevance order. Fixed rather than page-dependent so every
 * page slices the same total order - nothing repeats or goes missing across pages.
 */
export const RERANKED_HEAD_SIZE = 120

export function matchesOrphanFilter(note: IndexedNote, filter: OrphanFilter): boolean {
  switch (filter) {
    case 'any':
      return true
    case 'orphan':
      return note.degree === 0
    case 'connected':
      return note.degree > 0
  }
}

/**
 * Re-sorts the leading `RERANKED_HEAD_SIZE` items (already in engine order) by
 * descending `score`, ties by filename; everything after the head is left as-is.
 * `score` receives each head item's engine rank.
 */
export function orderByHeadScore<T extends { filename: string }>(
  items: T[],
  score: (item: T, engineRank: number) => number
): T[] {
  const head = items
    .slice(0, RERANKED_HEAD_SIZE)
    .map((item, engineRank) => ({ item, score: score(item, engineRank) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.item.filename.localeCompare(right.item.filename)
    )
    .map(({ item }) => item)

  return [...head, ...items.slice(RERANKED_HEAD_SIZE)]
}
