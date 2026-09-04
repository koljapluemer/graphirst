import { useCallback, useEffect, useState } from 'react'

export interface UndoAction {
  message: string
  perform: () => Promise<void>
}

const UNDO_TIMEOUT_MS = 6000

export interface UseUndoToastResult {
  undoAction: UndoAction | null
  showUndo: (message: string, perform: () => Promise<void>) => void
  dismissUndo: () => void
}

/**
 * Backs the bottom "Undo" popover for deletes: notes/relations are removed
 * immediately, with the backend keeping just the single most recent deletion
 * around (see NoteStore.undoDelete) for this to restore. A later delete's
 * popover simply replaces this one, matching the single-slot backend.
 */
export function useUndoToast(): UseUndoToastResult {
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)

  useEffect(() => {
    if (!undoAction) {
      return
    }
    const timer = setTimeout(() => setUndoAction(null), UNDO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [undoAction])

  const showUndo = useCallback((message: string, perform: () => Promise<void>) => {
    setUndoAction({ message, perform })
  }, [])

  const dismissUndo = useCallback(() => setUndoAction(null), [])

  return { undoAction, showUndo, dismissUndo }
}
