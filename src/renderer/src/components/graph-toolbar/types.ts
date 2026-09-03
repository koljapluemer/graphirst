import type { LucideIcon } from 'lucide-react'

/** A single actionable tool in the graph toolbar. */
export interface ToolbarAction {
  id: string
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
}
