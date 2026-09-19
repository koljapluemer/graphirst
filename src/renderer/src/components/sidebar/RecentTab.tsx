import { useRecentNotes } from '../../hooks/useRecentNotes'
import NoteListItem from './NoteListItem'
import RecentSortSelect from './RecentSortSelect'
import type { RecentNotesSort } from '../../../../shared/notes'

export interface RecentTabProps {
  sort: RecentNotesSort
  onSortChange: (sort: RecentNotesSort) => void
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
  onError: (error: Error) => void
}

export default function RecentTab({
  sort,
  onSortChange,
  pins,
  onSelectNote,
  onError
}: RecentTabProps): React.JSX.Element {
  const { results, loading } = useRecentNotes(sort, onError)

  return (
    <>
      <div className="border-b border-base-300 px-4 py-4">
        <RecentSortSelect value={sort} onChange={onSortChange} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {results.length === 0 && !loading ? (
          <div className="px-2 py-2 text-sm text-base-content/60">No recent notes.</div>
        ) : null}

        <div className="space-y-2">
          {results.map((note) => (
            <NoteListItem
              key={note.filename}
              preview={note.preview}
              isPinned={pins.has(note.filename)}
              onSelect={() => onSelectNote(note.filename)}
            />
          ))}
        </div>
      </div>
    </>
  )
}
