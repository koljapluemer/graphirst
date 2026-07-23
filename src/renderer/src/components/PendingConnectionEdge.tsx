import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps
} from '@xyflow/react'
import { X } from 'lucide-react'
import { useState } from 'react'
import { getEdgeParams } from './graph-edge-geometry'

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
        style={{ stroke: '#d36945', strokeWidth: 1.6, strokeDasharray: '4 4' }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all'
          }}
        >
          <form
            className="flex flex-col gap-1.5 rounded-[16px] border border-[#d6b49e] bg-[rgba(255,251,246,0.98)] p-2 shadow-[0_18px_40px_rgba(122,95,74,0.22)]"
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
                className="w-32 rounded-full border border-[#eadbc9] bg-white/80 px-2.5 py-1 text-xs outline-none focus:border-[#d6a17d]"
              />
              <button
                type="submit"
                className="btn btn-xs rounded-full border-[#d6b49e] bg-[#d86f49] text-white hover:bg-[#c8623d]"
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
            {error ? <p className="text-[11px] text-[#b3462c]">{error}</p> : null}
          </form>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
