import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps
} from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EDGE_OVERLAY_Z_INDEX, getEdgeParams } from './graph-edge-geometry'
import type { GraphEdgePayload } from '../../../shared/notes'

export interface FloatingEdgeData extends Record<string, unknown> {
  relations: GraphEdgePayload[]
  onDeleteRelation?: (relation: GraphEdgePayload) => Promise<void>
}

export default function FloatingEdge({
  id,
  source,
  target,
  style,
  markerStart,
  markerEnd,
  data
}: EdgeProps): React.JSX.Element | null {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const [editing, setEditing] = useState(false)
  const [labels, setLabels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sourceNode?.measured.width || !targetNode?.measured.width) {
    return null
  }

  const { relations = [], onDeleteRelation } = (data ?? {}) as Partial<FloatingEdgeData>
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

  const openEditor = (): void => {
    setLabels(relations.map((relation) => relation.label))
    setError(null)
    setEditing(true)
  }

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    setError(null)

    try {
      await Promise.all(
        relations.map((relation, index) => {
          const nextLabel = labels[index]?.trim()
          if (!nextLabel || nextLabel === relation.label) {
            return Promise.resolve()
          }
          return window.api.notes.updateRelationLabel({
            source: relation.source,
            target: relation.target,
            label: relation.label,
            nextLabel
          })
        })
      )
      setEditing(false)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (relation: GraphEdgePayload): Promise<void> => {
    setBusy(true)
    setError(null)

    try {
      await onDeleteRelation?.(relation)
      setEditing(false)
    } catch (deleteError) {
      setError((deleteError as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} />
      {relations.length > 0 ? (
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
            {editing ? (
              <div className="w-56 rounded-box border border-base-300 bg-base-100 p-2.5 shadow-lg">
                {relations.map((relation, index) => (
                  <div key={relation.id} className="mb-1.5 flex items-center gap-1.5 last:mb-0">
                    <input
                      autoFocus={index === 0}
                      value={labels[index] ?? ''}
                      onChange={(event) =>
                        setLabels((prev) => {
                          const next = [...prev]
                          next[index] = event.target.value
                          return next
                        })
                      }
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Escape') {
                          setEditing(false)
                        }
                      }}
                      className="input input-xs w-full rounded-full focus:border-primary/60"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs rounded-full text-error"
                      onClick={() => void handleDelete(relation)}
                      title="Delete this relationship"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                {error ? <p className="mb-1.5 text-xs text-error">{error}</p> : null}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs rounded-full"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs rounded-full"
                    disabled={busy}
                    onClick={() => void handleSave()}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={openEditor}
                className="rounded-full border border-base-300 bg-base-100/90 px-2 py-0.5 text-xs font-bold text-neutral shadow-sm hover:border-primary/50"
              >
                {relations.map((relation) => relation.label).join(' | ')}
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
