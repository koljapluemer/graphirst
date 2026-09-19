import { startTransition, useEffect, useRef, useState } from 'react'
import type { RecentNote, RecentNotesSort } from '../../../shared/notes'

export interface UseRecentNotesResult {
  results: RecentNote[]
  loading: boolean
}

/**
 * The most recent notes by the chosen lifecycle timestamp. Re-queries on any backend
 * note change (see notes.onChanged), so pinning, creating or editing a note reorders
 * the list without the caller doing anything.
 */
export function useRecentNotes(
  sort: RecentNotesSort,
  onError?: (error: Error) => void
): UseRecentNotesResult {
  const [results, setResults] = useState<RecentNote[]>([])
  const [loading, setLoading] = useState(false)
  const [changeNonce, setChangeNonce] = useState(0)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => window.api.notes.onChanged(() => setChangeNonce((n) => n + 1)), [])

  useEffect(() => {
    let ignore = false

    const loadRecent = async (): Promise<void> => {
      setLoading(true)
      try {
        const response = await window.api.notes.recentNotes({ sort })
        if (!ignore) {
          startTransition(() => setResults(response.results))
        }
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

    void loadRecent()

    return () => {
      ignore = true
    }
  }, [sort, changeNonce])

  return { results, loading }
}
