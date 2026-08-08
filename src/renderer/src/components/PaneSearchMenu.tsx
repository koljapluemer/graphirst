import { LoaderCircle, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNoteSearch } from '../hooks/useNoteSearch'
import SearchModeToggle from './SearchModeToggle'
import type { SearchMode, SearchResult } from '../../../shared/notes'

export interface PaneSearchMenuProps {
  /** Viewport (clientX/clientY) coordinates of the right-click that opened this menu. */
  screenPosition: { x: number; y: number }
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
  onClose: () => void
}

/**
 * The right-click "open note here" popover (tckt/issues/right-click-open-note-here-feature.md):
 * a mini version of the sidebar search, anchored at the cursor. Picking a result doesn't close
 * the menu - the query stays put so the same search can pin several matches in a row without
 * retyping it each time. Only Escape or clicking elsewhere closes it.
 */
export default function PaneSearchMenu({
  screenPosition,
  pins,
  onSelectNote,
  onClose
}: PaneSearchMenuProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('fuzzy')
  const { results, loading } = useNoteSearch(query, { mode })
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose])

  return (
    <div
      ref={rootRef}
      className="nodrag nopan nowheel fixed z-50 w-72 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
      style={{ left: screenPosition.x, top: screenPosition.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <label className="input w-full">
        <Search className="size-4 shrink-0 text-base-content/60" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              onClose()
            } else if (event.key === 'Enter' && results[0]) {
              onSelectNote(results[0].filename)
            }
          }}
          placeholder="Open a note here…"
        />
        {loading ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-base-content/60" />
        ) : null}
        <SearchModeToggle
          mode={mode}
          onToggle={() => setMode((current) => (current === 'fuzzy' ? 'raw' : 'fuzzy'))}
        />
      </label>

      {query.trim() ? (
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {results.length === 0 && !loading ? (
            <p className="px-2 py-1.5 text-xs text-base-content/60">No matches.</p>
          ) : null}
          {results.map((result: SearchResult) => {
            const isOpen = pins.has(result.filename)
            return (
              <button
                key={result.filename}
                type="button"
                className={[
                  'block w-full rounded-field border px-3 py-2 text-left text-xs leading-5 transition-colors',
                  isOpen
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-transparent bg-base-200/70 hover:border-base-300 hover:bg-base-100'
                ].join(' ')}
                onClick={() => onSelectNote(result.filename)}
              >
                <p className="line-clamp-3">{result.preview}</p>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
