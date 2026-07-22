import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node
} from '@xyflow/react'
import { Crosshair, ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GraphNodePayload, NoteGraph } from '../../../shared/notes'

interface GraphCanvasProps {
  graph: NoteGraph | null
  loading: boolean
  onOpenNote: (filename: string) => void
}

type ColumnKey =
  'far-left' | 'left' | 'center' | 'right' | 'far-right' | 'upper-center' | 'lower-center'

interface PositionedNode {
  note: GraphNodePayload
  x: number
  y: number
  column: ColumnKey
}

const columnLayout: Record<ColumnKey, { x: number; baseY: number }> = {
  'far-left': { x: -1080, baseY: 0 },
  left: { x: -540, baseY: 0 },
  center: { x: 0, baseY: 0 },
  right: { x: 540, baseY: 0 },
  'far-right': { x: 1080, baseY: 0 },
  'upper-center': { x: 0, baseY: -560 },
  'lower-center': { x: 0, baseY: 560 }
}

function FlowScene({ graph, onOpenNote }: Omit<GraphCanvasProps, 'loading'>): React.JSX.Element {
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const positionedNodes = graph ? layoutGraph(graph) : []
  const nodeIds = new Set(positionedNodes.map((node) => node.note.filename))

  const nodes: Node[] = positionedNodes.map((item) => ({
    id: item.note.filename,
    position: { x: item.x, y: item.y },
    sourcePosition: getSourcePosition(item.column),
    targetPosition: getTargetPosition(item.column),
    selectable: true,
    dragHandle: '.note-drag-handle',
    data: {
      label: <NoteCard note={item.note} onOpenNote={onOpenNote} />
    }
  }))

  const edges: Edge[] = (graph?.edges ?? [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: edge.label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: edge.direction === 'outgoing' ? '#2f7f77' : '#b6633d'
      },
      labelStyle: {
        fill: '#6b5143',
        fontSize: 11,
        fontWeight: 700
      },
      labelBgStyle: {
        fill: '#fffaf4',
        fillOpacity: 0.94
      },
      labelBgBorderRadius: 999,
      labelBgPadding: [8, 4],
      style: {
        stroke: edge.direction === 'outgoing' ? '#2f7f77' : '#b6633d',
        strokeWidth: edge.depth === 1 ? 1.7 : 1.2,
        opacity: edge.depth === 1 ? 0.88 : 0.58
      }
    }))

  useEffect(() => {
    if (!graph || !nodesInitialized) {
      return
    }

    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void fitView({
          duration: 420,
          minZoom: 0.22,
          maxZoom: 1.15,
          padding: { top: 0.16, right: 0.2, bottom: 0.16, left: 0.2 }
        })
      })
    })

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [fitView, graph, nodesInitialized])

  return (
    <ReactFlow
      fitView
      nodeOrigin={[0.5, 0.5]}
      nodes={nodes}
      edges={edges}
      minZoom={0.14}
      maxZoom={1.5}
      panOnScroll
      panOnDrag
      selectionOnDrag
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: 'smoothstep',
        zIndex: 0
      }}
    >
      <Background gap={28} color="#eadfce" />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(243, 236, 227, 0.72)"
        nodeColor={(node) => (node.id === graph?.center ? '#d46541' : '#6e9d9a')}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

function NoteCard({
  note,
  onOpenNote
}: {
  note: GraphNodePayload
  onOpenNote: (filename: string) => void
}): React.JSX.Element {
  return (
    <article
      className={[
        'note-card',
        'rounded-[24px] border px-5 py-4 text-left shadow-[0_22px_50px_rgba(123,94,74,0.12)] transition-transform duration-200',
        note.direction === 'center' ? 'note-card-center border-[#d36945]' : 'border-[#eadbc9]',
        note.missing ? 'note-card-missing' : '',
        'bg-[rgba(255,251,246,0.96)]'
      ].join(' ')}
    >
      <div className="note-drag-handle mb-3 flex cursor-grab justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#f3e8da]"
          onClick={(event) => {
            event.stopPropagation()
            onOpenNote(note.filename)
          }}
          title="Center this note"
        >
          <Crosshair className="size-3.5" />
        </button>
      </div>

      <div className="note-markdown text-[#352921]">
        {note.body.trim() ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  {children}
                  <ExternalLink className="size-3" />
                </a>
              )
            }}
          >
            {note.body}
          </ReactMarkdown>
        ) : (
          <p className="italic text-[#8b6f5d]">Empty note</p>
        )}
      </div>
    </article>
  )
}

export default function GraphCanvas({
  graph,
  loading,
  onOpenNote
}: GraphCanvasProps): React.JSX.Element {
  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#dfceb9] bg-[rgba(255,251,246,0.72)] text-sm text-[#715748] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
        Open a note.
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[24px] border border-[#e2d4c4] bg-[linear-gradient(180deg,rgba(255,252,247,0.94),rgba(247,239,230,0.9))] shadow-[0_32px_80px_rgba(122,95,74,0.12)]">
      {loading ? (
        <div className="pointer-events-none absolute inset-0 z-20 bg-[rgba(255,250,245,0.6)] backdrop-blur-[1px]" />
      ) : null}
      <ReactFlowProvider>
        <FlowScene graph={graph} onOpenNote={onOpenNote} />
      </ReactFlowProvider>
    </div>
  )
}

function layoutGraph(graph: NoteGraph): PositionedNode[] {
  const groups = new Map<ColumnKey, GraphNodePayload[]>()

  for (const note of graph.nodes) {
    const column = getColumn(note)
    const items = groups.get(column) ?? []
    items.push(note)
    groups.set(column, items)
  }

  const positioned: PositionedNode[] = []

  for (const [column, items] of groups.entries()) {
    const config = columnLayout[column]
    const ordered = [...items].sort((left, right) => {
      if (left.depth === 0 || right.depth === 0) {
        return left.depth - right.depth
      }

      return right.degree - left.degree || left.filename.localeCompare(right.filename)
    })
    const heights = ordered.map((note) => estimateNodeHeight(note))
    const totalHeight =
      heights.reduce((sum, height) => sum + height, 0) + Math.max(0, heights.length - 1) * 46
    let cursor = config.baseY - totalHeight / 2

    for (let index = 0; index < ordered.length; index += 1) {
      const note = ordered[index]
      const height = heights[index]
      positioned.push({
        note,
        x: config.x,
        y: cursor + height / 2,
        column
      })
      cursor += height + 46
    }
  }

  return positioned.sort((left, right) => left.note.depth - right.note.depth)
}

function getColumn(note: GraphNodePayload): ColumnKey {
  if (note.depth === 0) {
    return 'center'
  }

  if (note.direction === 'incoming') {
    return note.depth === 1 ? 'left' : 'far-left'
  }

  if (note.direction === 'outgoing') {
    return note.depth === 1 ? 'right' : 'far-right'
  }

  return note.depth === 1 ? 'upper-center' : 'lower-center'
}

function estimateNodeHeight(note: GraphNodePayload): number {
  const lineCount = note.body.split('\n').length
  const textWeight = Math.ceil(note.body.length / 110)
  return Math.min(Math.max(220, 120 + Math.max(lineCount, textWeight) * 20), 760)
}

function getSourcePosition(column: ColumnKey): Position {
  if (column === 'center' || column === 'upper-center' || column === 'lower-center') {
    return Position.Right
  }

  return column.includes('left') ? Position.Right : Position.Left
}

function getTargetPosition(column: ColumnKey): Position {
  if (column === 'center' || column === 'upper-center' || column === 'lower-center') {
    return Position.Left
  }

  return column.includes('left') ? Position.Right : Position.Left
}
