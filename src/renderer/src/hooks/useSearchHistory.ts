import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'graphirst-search-history'
const MAX_ENTRIES = 20

/** Storage can be unavailable or hold garbage; either way history just starts empty. */
function readHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(history: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // A lost history entry isn't worth surfacing.
  }
}

export interface UseSearchHistoryResult {
  /** Most recent first, no duplicates. */
  history: string[]
  /** Remembers a query the user acted on (opened or pinned a result of). */
  record: (query: string) => void
}

export function useSearchHistory(): UseSearchHistoryResult {
  const [history, setHistory] = useState<string[]>(readHistory)

  useEffect(() => writeHistory(history), [history])

  const record = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      return
    }
    setHistory((current) =>
      [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, MAX_ENTRIES)
    )
  }, [])

  return { history, record }
}
