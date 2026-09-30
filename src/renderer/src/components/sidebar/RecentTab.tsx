import { useRecentNotes } from '../../hooks/useRecentNotes'
import NoteListItem from './NoteListItem'
import PagedNoteList from './PagedNoteList'
import RecentSortSelect from './RecentSortSelect'
import type { RecentNotesSort } from '../../../../shared/notes'

export interface RecentTabProps {
  sort: RecentNotesSort
  onSortChange: (sort: RecentNotesSort) => void
  page: number
  onPageChange: (page: number) => void
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
  onError: (error: Error) => void
}

export default function RecentTab({
  sort,
  onSortChange,
  page,
  onPageChange,
  pins,
  onSelectNote,
  onError
}: RecentTabProps): React.JSX.Element {
  const { results, total, loading } = useRecentNotes(sort, page, onError)

  return (
    <>
      <div className="border-b border-base-300 px-4 py-4">
        <RecentSortSelect value={sort} onChange={onSortChange} />
      </div>

      <PagedNoteList
        page={page}
        total={total}
        loading={loading}
        onPageChange={onPageChange}
        emptyMessage="No recent notes."
      >
        {results.map((note) => (
          <NoteListItem
            key={note.filename}
            preview={note.preview}
            isPinned={pins.has(note.filename)}
            onSelect={() => onSelectNote(note.filename)}
          />
        ))}
      </PagedNoteList>
    </>
  )
}
