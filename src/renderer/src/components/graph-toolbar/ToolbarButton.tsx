import type { LucideIcon } from 'lucide-react'

/**
 * One toolbar entry. Collapses to an icon-only square button; when `expanded`
 * it grows to a full-width row with the label beside the icon. The label is
 * always the native tooltip so a collapsed button stays discoverable.
 */
export default function ToolbarButton({
  icon: Icon,
  label,
  expanded,
  onClick,
  disabled,
  pressed
}: {
  icon: LucideIcon
  label: string
  expanded: boolean
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={[
        'btn btn-ghost btn-sm',
        expanded ? 'w-full justify-start gap-2' : 'btn-square'
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
    >
      <Icon className="size-4 shrink-0" />
      {expanded ? <span className="truncate">{label}</span> : null}
    </button>
  )
}
