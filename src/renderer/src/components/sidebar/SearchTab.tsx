import { LoaderCircle, Search } from 'lucide-react'
import SearchModeToggle from '../SearchModeToggle'
import NoteListItem from './NoteListItem'
import type { SearchMode, SearchResult } from '../../../../shared/notes'

/** Search state is owned by App (results also feed the toolbar), so it survives tab switches. */
export interface SearchTabProps {
  query: string
  onQueryChange: (query: string) => void
  mode: SearchMode
  onToggleMode: () => void
  results: SearchResult[]
  loading: boolean
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
}

export default function SearchTab({
  query,
  onQueryChange,
  mode,
  onToggleMode,
  results,
  loading,
  pins,
  onSelectNote
}: SearchTabProps): React.JSX.Element {
  return (
    <>
      <div className="border-b border-base-300 px-4 py-4">
        <label className="input w-full">
          <Search className="size-4.5 text-base-content/60" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                onSelectNote(results[0].filename)
              }
            }}
            placeholder="Search notes…"
          />
          {loading ? <LoaderCircle className="size-4 animate-spin text-base-content/60" /> : null}
          <SearchModeToggle mode={mode} onToggle={onToggleMode} />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!query.trim() ? (
          <div className="px-2 py-2 text-sm text-base-content/60">Search to open a note.</div>
        ) : null}

        {query.trim() && results.length === 0 && !loading ? (
          <div className="px-2 py-2 text-sm text-base-content/60">No matches.</div>
        ) : null}

        <div className="space-y-2">
          {results.map((result) => (
            <NoteListItem
              key={result.filename}
              preview={result.preview}
              isPinned={pins.has(result.filename)}
              onSelect={() => onSelectNote(result.filename)}
            />
          ))}
        </div>
      </div>
    </>
  )
}
