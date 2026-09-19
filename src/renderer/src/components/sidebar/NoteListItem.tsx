export interface NoteListItemProps {
  preview: string
  /** True when the note is already open on the graph. */
  isPinned: boolean
  onSelect: () => void
}

export default function NoteListItem({
  preview,
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
      <p className="line-clamp-4 text-xs leading-5">{preview}</p>
    </button>
  )
}
