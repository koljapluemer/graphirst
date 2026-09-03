import { useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Dices, FilePlus, Maximize, PinOff, ZoomIn, ZoomOut } from 'lucide-react'
import type { ToolbarAction } from './types'

const ZOOM_DURATION_MS = 150
const FIT_VIEW_DURATION_MS = 200

/**
 * Assembles the graph toolbar's action groups. Canvas-native actions (zoom, fit)
 * are resolved here from the React Flow instance; graph-data actions are injected
 * by the caller, which owns that state.
 */
export function useGraphToolbarGroups({
  onAddNote,
  onUnpinAll,
  onPinOrphan,
  unpinAllDisabled,
  pinOrphanDisabled
}: {
  onAddNote: () => void
  onUnpinAll: () => void
  onPinOrphan: () => void
  unpinAllDisabled: boolean
  pinOrphanDisabled: boolean
}): ToolbarAction[][] {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  return useMemo(
    () => [
      [
        { id: 'add-note', label: 'Add note', icon: FilePlus, onClick: onAddNote },
        {
          id: 'unpin-all',
          label: 'Unpin all',
          icon: PinOff,
          onClick: onUnpinAll,
          disabled: unpinAllDisabled
        },
        {
          id: 'pin-orphan',
          label: 'Pin orphan',
          icon: Dices,
          onClick: onPinOrphan,
          disabled: pinOrphanDisabled
        }
      ],
      [
        {
          id: 'zoom-in',
          label: 'Zoom in',
          icon: ZoomIn,
          onClick: () => void zoomIn({ duration: ZOOM_DURATION_MS })
        },
        {
          id: 'zoom-out',
          label: 'Zoom out',
          icon: ZoomOut,
          onClick: () => void zoomOut({ duration: ZOOM_DURATION_MS })
        },
        {
          id: 'fit-view',
          label: 'Fit view',
          icon: Maximize,
          onClick: () => void fitView({ duration: FIT_VIEW_DURATION_MS })
        }
      ]
    ],
    [
      onAddNote,
      onUnpinAll,
      onPinOrphan,
      unpinAllDisabled,
      pinOrphanDisabled,
      zoomIn,
      zoomOut,
      fitView
    ]
  )
}
