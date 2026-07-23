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
  type OnConnectEnd,
  type OnConnectStart
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import FloatingEdge from './FloatingEdge'
import NoteNode, { type NoteFlowNode } from './NoteNode'
import type { GraphEdgePayload, GraphNodePayload, NoteGraph } from '../../../shared/notes'

const edgeTypes = { floating: FloatingEdge }
const nodeTypes = { note: NoteNode }

const DRAFT_NODE_HEIGHT = 340

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

interface DraftNote {
  clientId: string
  sourceFilename: string
  position: { x: number; y: number }
}

function FlowScene({
  graph,
  onOpenNote
}: {
  graph: NoteGraph
  onOpenNote: (filename: string) => void
}): React.JSX.Element {
  const { fitView, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layouted, setLayouted] = useState<LayoutedGraph>({ nodes: [], edges: [] })
  const [draft, setDraft] = useState<DraftNote | null>(null)
  const connectingFromRef = useRef<string | null>(null)

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

  const onConnectStart: OnConnectStart = useCallback((_event, { nodeId }) => {
    connectingFromRef.current = nodeId
  }, [])

  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const sourceFilename = connectingFromRef.current
      connectingFromRef.current = null
      if (!sourceFilename) {
        return
      }

      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      if (!point || !('clientX' in point)) {
        return
      }

      setDraft({
        clientId: `draft:${sourceFilename}:${Date.now()}`,
        sourceFilename,
        position: screenToFlowPosition({ x: point.clientX, y: point.clientY })
      })
    },
    [screenToFlowPosition]
  )

  const handleSaveDraft = async (
    current: DraftNote,
    body: string,
    label: string,
    reverse: boolean
  ): Promise<void> => {
    await window.api.notes.createNote({
      relatedFilename: current.sourceFilename,
      label,
      reverse,
      body
    })
    setDraft(null)
    onOpenNote(graph.center)
  }

  const nodes: NoteFlowNode[] = layouted.nodes.map((item) => ({
    id: item.note.filename,
    type: 'note',
    position: item.position,
    width: item.width,
    height: item.height,
    selectable: true,
    dragHandle: '.note-drag-handle',
    data: {
      kind: 'note',
      note: item.note,
      onOpenNote
    }
  }))

  if (draft) {
    nodes.push({
      id: draft.clientId,
      type: 'note',
      position: draft.position,
      width: NODE_WIDTH,
      height: DRAFT_NODE_HEIGHT,
      selectable: true,
      dragHandle: '.note-drag-handle',
      data: {
        kind: 'draft',
        onSave: (body, label, reverse) => handleSaveDraft(draft, body, label, reverse),
        onCancel: () => setDraft(null)
      }
    })
  }

  const edges: Edge[] = draft
    ? [
        ...layouted.edges,
        {
          id: `${draft.clientId}__preview`,
          source: draft.sourceFilename,
          target: draft.clientId,
          type: 'floating',
          style: { stroke: '#b9a68f', strokeWidth: 1.4, strokeDasharray: '4 4' }
        }
      ]
    : layouted.edges

  return (
    <ReactFlow
      fitView
      nodeOrigin={[0.5, 0.5]}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      connectionLineStyle={{ stroke: '#d36945', strokeWidth: 1.6, strokeDasharray: '4 4' }}
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
