import { Regex } from 'lucide-react'
import type { SearchMode } from '../../../shared/notes'

/**
 * Switches a search input between the default fuzzy/token search and raw
 * mode (literal, non-stripped substring matching, or a `/pattern/flags`
 * regex - see NoteStore.parseRawQuery), similar to Obsidian's search options.
 */
export default function SearchModeToggle({
  mode,
  onToggle
}: {
  mode: SearchMode
  onToggle: () => void
}): React.JSX.Element {
  const active = mode === 'raw'

  return (
    <button
      type="button"
      className={[
        'btn btn-ghost btn-xs nodrag shrink-0 rounded-full',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-base-content/60 hover:bg-accent/10 hover:text-accent'
      ].join(' ')}
      aria-pressed={active}
      onClick={onToggle}
      title="Raw / regex search — wrap a query in /pattern/flags/ for regex, otherwise it matches literal text (including punctuation)"
    >
      <Regex className="size-4" />
    </button>
  )
}
