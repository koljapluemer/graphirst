import type { RecentNotesSort } from '../../../../shared/notes'

const SORT_OPTIONS: { value: RecentNotesSort; label: string }[] = [
  { value: 'opened', label: 'Opened' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' }
]

export interface RecentSortSelectProps {
  value: RecentNotesSort
  onChange: (sort: RecentNotesSort) => void
}

export default function RecentSortSelect({
  value,
  onChange
}: RecentSortSelectProps): React.JSX.Element {
  return (
    <select
      className="select w-full"
      value={value}
      onChange={(event) => onChange(event.target.value as RecentNotesSort)}
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
