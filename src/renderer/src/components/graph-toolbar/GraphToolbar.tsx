import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import ToolbarButton from './ToolbarButton'
import type { ToolbarAction } from './types'

/**
 * Vertical tool rail that floats over the graph canvas. Owns only its own
 * expand/collapse view state; every actual tool is injected as a {@link ToolbarAction}.
 * Groups are rendered in order, separated by a hairline divider.
 */
export default function GraphToolbar({ groups }: { groups: ToolbarAction[][] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Graph tools"
      className="flex flex-col gap-1 rounded-box border border-base-300 bg-base-100/90 p-1 shadow-lg backdrop-blur"
    >
      <ToolbarButton
        icon={expanded ? PanelLeftClose : PanelLeftOpen}
        label={expanded ? 'Collapse toolbar' : 'Expand toolbar'}
        expanded={expanded}
        pressed={expanded}
        onClick={() => setExpanded((value) => !value)}
      />

      {groups.map((actions, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="mx-1 my-0.5 h-px bg-base-300" />
          {actions.map((action) => (
            <ToolbarButton
              key={action.id}
              icon={action.icon}
              label={action.label}
              expanded={expanded}
              disabled={action.disabled}
              onClick={action.onClick}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
