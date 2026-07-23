import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps
} from '@xyflow/react'
import { Check, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { getEdgeParams } from './graph-edge-geometry'
import type { GraphEdgePayload } from '../../../shared/notes'

export interface FloatingEdgeData extends Record<string, unknown> {
  relations: GraphEdgePayload[]
  onChanged?: () => void
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
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sourceNode?.measured.width || !targetNode?.measured.width) {
    return null
  }

  const { relations = [], onChanged } = (data ?? {}) as Partial<FloatingEdgeData>
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
    setConfirmingDeleteIndex(null)
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
      onChanged?.()
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
      await window.api.notes.deleteRelation({
        source: relation.source,
        target: relation.target,
        label: relation.label
      })
      setEditing(false)
      onChanged?.()
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
              pointerEvents: 'all'
            }}
          >
            {editing ? (
              <div className="w-56 rounded-[16px] border border-[#d6b49e] bg-[rgba(255,251,246,0.98)] p-2.5 shadow-[0_18px_40px_rgba(122,95,74,0.22)]">
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
                      className="w-full rounded-full border border-[#eadbc9] bg-white/80 px-2.5 py-1 text-xs outline-none focus:border-[#d6a17d]"
                    />
                    {confirmingDeleteIndex === index ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs rounded-full"
                          onClick={() => setConfirmingDeleteIndex(null)}
                          title="Cancel"
                        >
                          <X className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs rounded-full border-none bg-[#b3462c] text-white hover:bg-[#96391f]"
                          onClick={() => void handleDelete(relation)}
                          title="Confirm delete"
                        >
                          <Check className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs rounded-full text-[#b3462c]"
                        onClick={() => setConfirmingDeleteIndex(index)}
                        title="Delete this relationship"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {error ? <p className="mb-1.5 text-[11px] text-[#b3462c]">{error}</p> : null}
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
                    className="btn btn-xs rounded-full border-[#d6b49e] bg-[#d86f49] text-white hover:bg-[#c8623d]"
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
                className="rounded-full border border-[#eadbc9] bg-[rgba(255,250,244,0.94)] px-2 py-0.5 text-[11px] font-bold text-[#6b5143] shadow-sm hover:border-[#d6a17d]"
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
