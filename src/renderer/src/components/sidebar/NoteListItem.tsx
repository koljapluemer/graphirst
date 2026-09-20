import type { MatchRange, SearchExcerpt } from '../../../../shared/notes'
import HighlightedText from './HighlightedText'

export interface NoteListItemProps {
  preview: string
  /** Highlighted within `preview` (search results). */
  previewMatch?: MatchRange | null
  /** Shown in a second, smaller row when the match isn't visible in `preview`. */
  excerpt?: SearchExcerpt | null
  /** True when the note is already open on the graph. */
  isPinned: boolean
  onSelect: () => void
}

export default function NoteListItem({
  preview,
  previewMatch = null,
  excerpt = null,
  isPinned,
  onSelect
}: NoteListItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={[
        'block w-full border px-4 py-3 text-left transition-colors',
        isPinned
          ? 'border-primary/50 bg-primary/10'
          : 'border-transparent bg-base-200/70 hover:border-base-300 hover:bg-base-100'
      ].join(' ')}
      onClick={onSelect}
    >
      <p className="line-clamp-4 text-xs leading-5">
        <HighlightedText text={preview} match={previewMatch} />
      </p>
      {excerpt ? (
        <p className="mt-1.5 line-clamp-2 text-[0.6875rem] leading-4 text-base-content/60">
          <HighlightedText text={excerpt.text} match={excerpt.match} />
        </p>
      ) : null}
    </button>
  )
}
