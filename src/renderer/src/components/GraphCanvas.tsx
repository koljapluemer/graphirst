import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node
} from '@xyflow/react'
import { Crosshair, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import FloatingEdge from './FloatingEdge'
import type { GraphEdgePayload, GraphNodePayload, NoteGraph } from '../../../shared/notes'

const edgeTypes = { floating: FloatingEdge }

const elk = new ELK()

const NODE_WIDTH = 370
const NODE_MIN_HEIGHT = 220
const NODE_MAX_HEIGHT = 760
const NODE_GAP = 64
const LAYER_GAP = 200
const ELK_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.spacing.nodeNode': `${NODE_GAP}`,
  'elk.layered.spacing.nodeNodeBetweenLayers': `${LAYER_GAP}`
} as const

interface GraphCanvasProps {
  graph: NoteGraph | null
  loading: boolean
  onOpenNote: (filename: string) => void
}

interface LayoutedNode {
  note: GraphNodePayload
  position: { x: number; y: number }
  width: number
  height: number
}

interface LayoutedGraph {
  nodes: LayoutedNode[]
  edges: Edge[]
}

function FlowScene({
  graph,
  onOpenNote
}: {
  graph: NoteGraph
  onOpenNote: (filename: string) => void
}): React.JSX.Element {
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layouted, setLayouted] = useState<LayoutedGraph>({ nodes: [], edges: [] })

  useEffect(() => {
    let cancelled = false

    const runLayout = async (): Promise<void> => {
      const nextLayout = await getLayoutedGraph(graph)
      if (!cancelled) {
        setLayouted(nextLayout)
      }
    }

    void runLayout()

    return () => {
      cancelled = true
    }
  }, [graph])

  useEffect(() => {
    if (!nodesInitialized || layouted.nodes.length === 0) {
      return
    }

    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void fitView({
          duration: 420,
          minZoom: 0.2,
          maxZoom: 1.15,
          padding: { top: 0.16, right: 0.2, bottom: 0.16, left: 0.2 }
        })
      })
    })

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [fitView, layouted.nodes.length, layouted.edges.length, graph.center, nodesInitialized])

  const nodes: Node[] = layouted.nodes.map((item) => ({
    id: item.note.filename,
    position: item.position,
    width: item.width,
    height: item.height,
    selectable: true,
    dragHandle: '.note-drag-handle',
    data: {
      label: <NoteCard note={item.note} onOpenNote={onOpenNote} />
    }
  }))

  return (
    <ReactFlow
      fitView
      nodeOrigin={[0.5, 0.5]}
      nodes={nodes}
      edges={layouted.edges}
      edgeTypes={edgeTypes}
      nodesConnectable={false}
      minZoom={0.14}
      maxZoom={1.5}
      panOnScroll
      panOnDrag
      selectionOnDrag
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: 'floating',
        zIndex: 0
      }}
    >
      <Background gap={28} color="#eadfce" />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(243, 236, 227, 0.72)"
        nodeColor={(node) => (node.id === graph.center ? '#d46541' : '#6e9d9a')}
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

async function getLayoutedGraph(graph: NoteGraph): Promise<LayoutedGraph> {
  const nodeSizes = new Map(
    graph.nodes.map((note) => [
      note.filename,
      {
        width: NODE_WIDTH,
        height: estimateNodeHeight(note)
      }
    ])
  )

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: graph.nodes.map((note) => ({
      id: note.filename,
      width: nodeSizes.get(note.filename)?.width ?? NODE_WIDTH,
      height: nodeSizes.get(note.filename)?.height ?? NODE_MIN_HEIGHT
    })),
    edges: graph.edges.map((edge): ElkExtendedEdge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  }

  const layout = await elk.layout(elkGraph)
  const children = layout.children ?? []
  const centerNode = children.find((node) => node.id === graph.center)
  const centerOffsetX = (centerNode?.x ?? 0) + (centerNode?.width ?? NODE_WIDTH) / 2
  const centerOffsetY = (centerNode?.y ?? 0) + (centerNode?.height ?? NODE_MIN_HEIGHT) / 2

  const positions = new Map(
    children.map((node) => [
      node.id,
      {
        x: (node.x ?? 0) + (node.width ?? NODE_WIDTH) / 2 - centerOffsetX,
        y: (node.y ?? 0) + (node.height ?? NODE_MIN_HEIGHT) / 2 - centerOffsetY
      }
    ])
  )

  const layoutedNodes: LayoutedNode[] = graph.nodes.map((note) => ({
    note,
    position: positions.get(note.filename) ?? { x: 0, y: 0 },
    width: nodeSizes.get(note.filename)?.width ?? NODE_WIDTH,
    height: nodeSizes.get(note.filename)?.height ?? NODE_MIN_HEIGHT
  }))

  const nodeById = new Map(layoutedNodes.map((node) => [node.note.filename, node]))

  const validEdges = graph.edges.filter(
    (edge) => nodeById.has(edge.source) && nodeById.has(edge.target)
  )

  const pairGroups = new Map<string, GraphEdgePayload[]>()
  for (const edge of validEdges) {
    const pairKey = [edge.source, edge.target].sort().join('__')
    const group = pairGroups.get(pairKey)
    if (group) {
      group.push(edge)
    } else {
      pairGroups.set(pairKey, [edge])
    }
  }

  const edges: Edge[] = []
  for (const group of pairGroups.values()) {
    if (group.length === 2 && isReciprocalPair(group[0], group[1])) {
      edges.push(buildReciprocalEdge(group[0], group[1], positions))
    } else {
      for (const edge of group) {
        edges.push(buildDirectedEdge(edge))
      }
    }
  }

  return {
    nodes: layoutedNodes,
    edges
  }
}

function isReciprocalPair(a: GraphEdgePayload, b: GraphEdgePayload): boolean {
  return a.source !== a.target && a.source === b.target && a.target === b.source
}

function edgeVisualWeight(edge: GraphEdgePayload): { strokeWidth: number; opacity: number } {
  return {
    strokeWidth: edge.depth === 1 ? 1.7 : 1.2,
    opacity: edge.depth === 1 ? 0.88 : 0.58
  }
}

function buildDirectedEdge(edge: GraphEdgePayload): Edge {
  const color = edge.direction === 'outgoing' ? '#2f7f77' : '#b6633d'

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'floating',
    label: edge.label,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color
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
      stroke: color,
      ...edgeVisualWeight(edge)
    }
  }
}

function buildReciprocalEdge(
  a: GraphEdgePayload,
  b: GraphEdgePayload,
  positions: Map<string, { x: number; y: number }>
): Edge {
  const posA = positions.get(a.source) ?? { x: 0, y: 0 }
  const posB = positions.get(b.source) ?? { x: 0, y: 0 }
  const aGoesFirst = posA.x - posB.x || posA.y - posB.y
  const [first, second] = aGoesFirst <= 0 ? [a, b] : [b, a]
  const color = '#6b5143'

  return {
    id: `${first.id}__reciprocal__${second.id}`,
    source: first.source,
    target: first.target,
    type: 'floating',
    label: `${first.label} | ${second.label}`,
    markerStart: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color
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
      stroke: color,
      ...edgeVisualWeight(first.depth <= second.depth ? first : second)
    }
  }
}

function estimateNodeHeight(note: GraphNodePayload): number {
  const lineCount = note.body.split('\n').length
  const textWeight = Math.ceil(note.body.length / 110)
  return Math.min(
    Math.max(NODE_MIN_HEIGHT, 120 + Math.max(lineCount, textWeight) * 20),
    NODE_MAX_HEIGHT
  )
}
