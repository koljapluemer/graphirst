import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps
} from '@xyflow/react'
import { X } from 'lucide-react'
import { useState } from 'react'
import { EDGE_OVERLAY_Z_INDEX, getEdgeParams } from './graph-edge-geometry'
import { GRAPH_COLORS } from '../lib/graph-colors'

export interface PendingConnectionEdgeData extends Record<string, unknown> {
  onConfirm: (label: string) => Promise<void>
  onCancel: () => void
}

export default function PendingConnectionEdge({
  source,
  target,
  data
}: EdgeProps): React.JSX.Element | null {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sourceNode?.measured.width || !targetNode?.measured.width) {
    return null
  }

  const { onConfirm, onCancel } = (data ?? {}) as Partial<PendingConnectionEdgeData>
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode)
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
    curvature: 0.32
  })

  const handleConfirm = async (): Promise<void> => {
    if (!label.trim() || !onConfirm || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await onConfirm(label.trim())
    } catch (confirmError) {
      setError((confirmError as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: GRAPH_COLORS.primary, strokeWidth: 1.6, strokeDasharray: '4 4' }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: EDGE_OVERLAY_Z_INDEX
          }}
        >
          <form
            className="flex flex-col gap-1.5 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
            onSubmit={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') {
                    onCancel?.()
                  }
                }}
                placeholder="relation label"
                className="input input-xs w-32 rounded-full focus:border-primary/60"
              />
              <button
                type="submit"
                className="btn btn-primary btn-xs rounded-full"
                disabled={!label.trim() || busy}
              >
                Connect
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs rounded-full"
                onClick={() => onCancel?.()}
              >
                <X className="size-3.5" />
              </button>
            </div>
            {error ? <p className="text-xs text-error">{error}</p> : null}
          </form>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
