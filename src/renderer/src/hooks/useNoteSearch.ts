import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { SearchCriteria, SearchResult } from '../../../shared/notes'

export interface UseNoteSearchOptions {
  /** Zero-based results page. @default 0 */
  page?: number
  /** Skip searching entirely, e.g. while the graph isn't indexed/ready yet. */
  enabled?: boolean
  onError?: (error: Error) => void
}

export interface UseNoteSearchResult {
  results: SearchResult[]
  /** Every match across all pages. */
  total: number
  loading: boolean
}

/**
 * Search-as-you-type against the backend index, shared by every UI surface that
 * needs it (sidebar, pane right-click search, ...) so they stay in lockstep
 * instead of each keeping its own copy of the debounce/refresh wiring.
 * Re-runs on any backend note change (see notes.onChanged) the same way the
 * graph view does, so results don't go stale after a create/edit/delete.
 */
export function useNoteSearch(
  criteria: SearchCriteria,
  options: UseNoteSearchOptions = {}
): UseNoteSearchResult {
  const { page = 0, enabled = true, onError } = options
  const { orphan } = criteria
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [changeNonce, setChangeNonce] = useState(0)
  const deferredQuery = useDeferredValue(criteria.query)
  // Ref rather than a dependency: onError is commonly an inline callback that
  // gets a new identity every render, and that shouldn't re-trigger the search.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => window.api.notes.onChanged(() => setChangeNonce((n) => n + 1)), [])

  useEffect(() => {
    let ignore = false

    const runSearch = async (): Promise<void> => {
      const query = deferredQuery.trim()
      if (!enabled || !query) {
        setResults([])
        setTotal(0)
        return
      }

      setLoading(true)

      try {
        const response = await window.api.notes.search({ query, orphan, page })
        if (ignore) {
          return
        }

        startTransition(() => {
          setResults(response.results)
          setTotal(response.total)
        })
      } catch (error) {
        if (!ignore) {
          onErrorRef.current?.(error as Error)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    void runSearch()

    return () => {
      ignore = true
    }
  }, [enabled, deferredQuery, orphan, page, changeNonce])

  return { results, total, loading }
}
