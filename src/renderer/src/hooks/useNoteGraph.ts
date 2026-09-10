import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type { NoteGraph, PinSpec } from '../../../shared/notes'

export const MANUAL_PIN_DEPTH = 1
export const SEARCH_RESULT_PIN_DEPTH = 2
export const CREATED_NOTE_PIN_DEPTH = 1

const EMPTY_GRAPH: NoteGraph = { nodes: [], edges: [], truncated: false, warnings: [] }

export interface UseNoteGraphResult {
  graph: NoteGraph | null
  pins: ReadonlyMap<string, number>
  loading: boolean
  error: string | null
  pinNote: (filename: string, depth: number) => void
  unpinNote: (filename: string) => void
  setPinDepth: (filename: string, depth: number) => void
  clearPins: () => void
  /** `background: true` refreshes the graph without showing the loading overlay - for silent "notes changed on disk" refetches. */
  refetch: (opts?: { background?: boolean }) => void
}

/**
 * Owns the pinned-note set and the graph fetched for it. The pinned set is the real
 * input to the backend's graph query (see note-store.ts buildGraph) - there is no
 * client-side patch layer on top, unlike the old single-center model.
 */
export function useNoteGraph(): UseNoteGraphResult {
  const [pins, setPins] = useState<Map<string, number>>(new Map())
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchNonce, setRefetchNonce] = useState(0)
  const requestIdRef = useRef(0)
  const backgroundRef = useRef(false)
  const hadPinsRef = useRef(false)

  useEffect(() => {
    let ignore = false
    const requestId = ++requestIdRef.current
    const isBackground = backgroundRef.current
    backgroundRef.current = false

    const run = async (): Promise<void> => {
      if (pins.size === 0) {
        setGraph(EMPTY_GRAPH)
        // On the transition from some pins to none, still tell the backend the
        // set is now empty (no graph fetch needed) so its record of "what was
        // pinned last" stays accurate - that record is what `opened` timestamps
        // are diffed against, so a later re-pin still counts as a fresh open.
        if (hadPinsRef.current) {
          hadPinsRef.current = false
          void window.api.notes.openGraph([]).catch(() => {})
        }
        return
      }
      hadPinsRef.current = true

      if (!isBackground) {
        setLoading(true)
      }
      try {
        const response = await window.api.notes.openGraph(toPinSpecs(pins))
        if (ignore || requestId !== requestIdRef.current) {
          return
        }
        startTransition(() => {
          setGraph(response.graph)
        })
        setError(null)
      } catch (err) {
        if (ignore || requestId !== requestIdRef.current) {
          return
        }
        setError((err as Error).message)
      } finally {
        if (!ignore && requestId === requestIdRef.current) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      ignore = true
    }
  }, [pins, refetchNonce])

  const pinNote = useCallback((filename: string, depth: number) => {
    setPins((prev) => (prev.has(filename) ? prev : new Map(prev).set(filename, depth)))
  }, [])

  const unpinNote = useCallback((filename: string) => {
    setPins((prev) => {
      if (!prev.has(filename)) {
        return prev
      }
      const next = new Map(prev)
      next.delete(filename)
      return next
    })
  }, [])

  const setPinDepth = useCallback((filename: string, depth: number) => {
    const clamped = Math.max(0, depth)
    setPins((prev) => (prev.has(filename) ? new Map(prev).set(filename, clamped) : prev))
  }, [])

  const clearPins = useCallback(() => setPins(new Map()), [])
  const refetch = useCallback((opts?: { background?: boolean }) => {
    backgroundRef.current = opts?.background ?? false
    setRefetchNonce((n) => n + 1)
  }, [])

  return { graph, pins, loading, error, pinNote, unpinNote, setPinDepth, clearPins, refetch }
}

function toPinSpecs(pins: Map<string, number>): PinSpec[] {
  return Array.from(pins, ([filename, depth]) => ({ filename, depth }))
}
