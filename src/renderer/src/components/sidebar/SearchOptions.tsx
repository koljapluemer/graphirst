import type { OrphanFilter } from '../../../../shared/notes'

const ORPHAN_OPTIONS: { value: OrphanFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'orphan', label: 'Yes' },
  { value: 'connected', label: 'No' }
]

export interface SearchOptionsProps {
  orphan: OrphanFilter
  onOrphanChange: (orphan: OrphanFilter) => void
}

/** Collapsible search refinements shown under the sidebar's search input. */
export default function SearchOptions({
  orphan,
  onOrphanChange
}: SearchOptionsProps): React.JSX.Element {
  return (
    <details className="collapse collapse-arrow mt-2 text-xs">
      <summary className="collapse-title min-h-0 px-1 py-1 text-xs text-base-content/60">
        Options
      </summary>
      <div className="collapse-content space-y-2 px-1">
        <label className="flex items-center justify-between gap-2">
          Orphan
          <select
            className="select select-xs w-24"
            value={orphan}
            onChange={(event) => onOrphanChange(event.target.value as OrphanFilter)}
          >
            {ORPHAN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  )
}
