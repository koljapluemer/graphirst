import { LoaderCircle, Search } from 'lucide-react'
import NoteListItem from './NoteListItem'
import PagedNoteList from './PagedNoteList'
import SearchOptions from './SearchOptions'
import type { SearchEvent, SearchState } from './search-state'
import type { SearchResult } from '../../../../shared/notes'

const HISTORY_LIST_ID = 'sidebar-search-history'

/** Search state is owned by App (results also feed the toolbar), so it survives tab switches. */
export interface SearchTabProps {
  state: SearchState
  dispatch: (event: SearchEvent) => void
  results: SearchResult[]
  total: number
  loading: boolean
  /** Past queries, offered as input suggestions. */
  history: string[]
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
}

export default function SearchTab({
  state,
  dispatch,
  results,
  total,
  loading,
  history,
  pins,
  onSelectNote
}: SearchTabProps): React.JSX.Element {
  const { criteria, page } = state

  return (
    <>
      <div className="border-b border-base-300 px-4 pt-4 pb-2">
        <label className="input w-full">
          <Search className="size-4.5 text-base-content/60" />
          <input
            value={criteria.query}
            list={HISTORY_LIST_ID}
            onChange={(event) => dispatch({ type: 'SET_QUERY', query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                onSelectNote(results[0].filename)
              }
            }}
            placeholder="Search notes…"
          />
          {loading ? <LoaderCircle className="size-4 animate-spin text-base-content/60" /> : null}
        </label>
        <datalist id={HISTORY_LIST_ID}>
          {history.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>

        <SearchOptions
          mode={criteria.mode}
          onModeChange={(mode) => dispatch({ type: 'SET_MODE', mode })}
          orphan={criteria.orphan}
          onOrphanChange={(orphan) => dispatch({ type: 'SET_ORPHAN', orphan })}
        />
      </div>

      <PagedNoteList
        page={page}
        total={total}
        loading={loading}
        onPageChange={(next) => dispatch({ type: 'SET_PAGE', page: next })}
        emptyMessage={criteria.query.trim() ? 'No matches.' : null}
      >
        {results.map((result) => (
          <NoteListItem
            key={result.filename}
            preview={result.preview}
            previewMatch={result.previewMatch}
            excerpt={result.excerpt}
            isPinned={pins.has(result.filename)}
            onSelect={() => onSelectNote(result.filename)}
          />
        ))}
      </PagedNoteList>
    </>
  )
}
