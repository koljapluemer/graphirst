import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import FloatingEdge from './FloatingEdge'
import NoteNode, { type NoteFlowNode } from './NoteNode'
import PendingConnectionEdge from './PendingConnectionEdge'
import { CREATED_NOTE_PIN_DEPTH, MANUAL_PIN_DEPTH } from '../hooks/useNoteGraph'
import type { GraphEdgePayload, GraphNodePayload, NoteGraph } from '../../../shared/notes'

const edgeTypes = { floating: FloatingEdge, pendingConnection: PendingConnectionEdge }
const nodeTypes = { note: NoteNode }

const DRAFT_NODE_HEIGHT = 340
const CONNECTION_RADIUS = 200

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
  pins: ReadonlyMap<string, number>
  onPinNote: (filename: string, depth: number) => void
  onUnpinNote: (filename: string) => void
  onSetPinDepth: (filename: string, depth: number) => void
  onRefetch: () => void
}

interface LayoutedNode {
  note: GraphNodePayload
  position: { x: number; y: number }
  width: number
  height: number
}

interface LayoutedGraph {
  nodes: LayoutedNode[]
}

/**
 * What the user is currently doing on the canvas, beyond just looking at it.
 * A single union (rather than separate booleans/slots per gesture) makes the
 * mutually-exclusive states structurally mutually exclusive - you can't have a
 * draft note AND a pending connection open at once, because there is only one
 * `interaction` value.
 */
type Interaction = IdleInteraction | DraftInteraction | ConnectingInteraction

interface IdleInteraction {
  type: 'idle'
}

interface DraftInteraction {
  type: 'draft'
  clientId: string
  /** Note this draft will be connected from, or null for a freestanding/unconnected note. */
  sourceFilename: string | null
  position: { x: number; y: number }
}

interface ConnectingInteraction {
  type: 'connecting'
  source: string
  target: string
}

const IDLE_INTERACTION: Interaction = { type: 'idle' }

interface ViewCallbacks {
  onDeleteNote: (filename: string) => Promise<void>
  onSaveDraft: (
    draft: DraftInteraction,
    body: string,
    label: string,
    reverse: boolean
  ) => Promise<void>
  onCancelInteraction: () => void
  onConfirmConnection: (connecting: ConnectingInteraction, label: string) => Promise<void>
  onEdgeChanged: () => void
  onPinNote: (filename: string) => void
  onUnpinNote: (filename: string) => void
  onChangeDepth: (filename: string, nextDepth: number) => void
}

/**
 * The single place where the server-derived graph, the current pin state, and
 * the current in-progress interaction are merged into what actually gets
 * handed to <ReactFlow>. Kept as a pure function of its inputs so this merge
 * logic can be reasoned about independently of React's render cycle. The
 * backend graph is authoritative for what notes/relations exist - there is no
 * client-side patch layer here, since a pinned note is a real BFS root on the
 * backend rather than an optimistic guess.
 */
function buildView(
  graph: NoteGraph,
  layouted: LayoutedGraph,
  pins: ReadonlyMap<string, number>,
  interaction: Interaction,
  callbacks: ViewCallbacks
): { nodes: NoteFlowNode[]; edges: Edge[] } {
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
      pinDepth: pins.get(item.note.filename) ?? null,
      onDelete: callbacks.onDeleteNote,
      onPin: callbacks.onPinNote,
      onUnpin: callbacks.onUnpinNote,
      onChangeDepth: callbacks.onChangeDepth
    }
  }))

  const knownFilenames = new Set(nodes.map((node) => node.id))
  const positions = new Map(layouted.nodes.map((item) => [item.note.filename, item.position]))

  // An edge can reference a node the backend dropped after hitting its graph-size cap
  // (the edge is registered before its far endpoint's node-cap check runs) - filter
  // those out so React Flow never gets an edge pointing at a node it doesn't have.
  const relations: GraphEdgePayload[] = graph.edges.filter(
    (edge) => knownFilenames.has(edge.source) && knownFilenames.has(edge.target)
  )

  const edges: Edge[] = mergeRelationsIntoEdges(relations, positions).map((edge) => ({
    ...edge,
    data: {
      ...(edge.data as Record<string, unknown> | undefined),
      onChanged: callbacks.onEdgeChanged
    }
  }))

  if (interaction.type === 'draft') {
    nodes.push({
      id: interaction.clientId,
      type: 'note',
      position: interaction.position,
      width: NODE_WIDTH,
      height: DRAFT_NODE_HEIGHT,
      selectable: true,
      dragHandle: '.note-drag-handle',
      data: {
        kind: 'draft',
        showRelation: interaction.sourceFilename !== null,
        onSave: (body, label, reverse) => callbacks.onSaveDraft(interaction, body, label, reverse),
        onCancel: callbacks.onCancelInteraction
      }
    })

    // The source note may have been deleted while this draft was still open - the
    // draft card itself still works (it just won't create a relation on save), but
    // don't draw a preview line to a node that no longer exists.
    if (interaction.sourceFilename && knownFilenames.has(interaction.sourceFilename)) {
      edges.push({
        id: `${interaction.clientId}__preview`,
        source: interaction.sourceFilename,
        target: interaction.clientId,
        type: 'floating',
        style: { stroke: '#b9a68f', strokeWidth: 1.4, strokeDasharray: '4 4' }
      })
    }
  }

  if (interaction.type === 'connecting') {
    // Same defensive check: either note may have been deleted while this
    // confirm-the-label popover was still open.
    if (knownFilenames.has(interaction.source) && knownFilenames.has(interaction.target)) {
      edges.push({
        id: `pending:${interaction.source}->${interaction.target}`,
        source: interaction.source,
        target: interaction.target,
        type: 'pendingConnection',
        data: {
          onConfirm: (label: string) => callbacks.onConfirmConnection(interaction, label),
          onCancel: callbacks.onCancelInteraction
        }
      })
    }
  }

  return { nodes, edges }
}

function FlowScene({
  graph,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth,
  onRefetch
}: {
  graph: NoteGraph
  pins: ReadonlyMap<string, number>
  onPinNote: (filename: string, depth: number) => void
  onUnpinNote: (filename: string) => void
  onSetPinDepth: (filename: string, depth: number) => void
  onRefetch: () => void
}): React.JSX.Element {
  const { fitView, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layouted, setLayouted] = useState<LayoutedGraph>({ nodes: [] })
  const [interaction, setInteraction] = useState<Interaction>(IDLE_INTERACTION)
  const connectingFromRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const runLayout = async (): Promise<void> => {
      try {
        const nextLayout = await getLayoutedGraph(graph)
        if (!cancelled) {
          setLayouted(nextLayout)
        }
      } catch (error) {
        // Never let this fail silently: an uncaught rejection here used to leave
        // `layouted` frozen forever with no visible sign anything had gone wrong.
        console.error('Failed to lay out graph:', error)
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
          maxZoom: 1.15,
          padding: { top: 0.16, right: 0.2, bottom: 0.16, left: 0.2 }
        })
      })
    })

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [fitView, layouted.nodes.length, graph.edges.length, nodesInitialized])

  const onConnectStart: OnConnectStart = useCallback((_event, { nodeId }) => {
    connectingFromRef.current = nodeId
  }, [])

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      const sourceFilename = connectingFromRef.current
      connectingFromRef.current = null
      if (!sourceFilename) {
        return
      }

      const targetFilename = connectionState.toNode?.id
      if (
        targetFilename &&
        targetFilename !== sourceFilename &&
        !targetFilename.startsWith('draft:')
      ) {
        setInteraction({ type: 'connecting', source: sourceFilename, target: targetFilename })
        return
      }

      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      if (!point || !('clientX' in point)) {
        return
      }

      setInteraction({
        type: 'draft',
        clientId: `draft:${sourceFilename}:${Date.now()}`,
        sourceFilename,
        position: screenToFlowPosition({ x: point.clientX, y: point.clientY })
      })
    },
    [screenToFlowPosition]
  )

  const handlePaneDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.classList.contains('react-flow__pane')) {
        return
      }

      setInteraction({
        type: 'draft',
        clientId: `draft:orphan:${Date.now()}`,
        sourceFilename: null,
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY })
      })
    },
    [screenToFlowPosition]
  )

  const handleCancelInteraction = useCallback(() => {
    setInteraction(IDLE_INTERACTION)
  }, [])

  const handleSaveDraft = async (
    draft: DraftInteraction,
    body: string,
    label: string,
    reverse: boolean
  ): Promise<void> => {
    const response = await window.api.notes.createNote({
      relatedFilename: draft.sourceFilename ?? undefined,
      label,
      reverse,
      body
    })

    // The new note becomes its own BFS root, so its relation to the source renders
    // correctly even if the source itself is several hops from every other pin.
    onPinNote(response.filename, CREATED_NOTE_PIN_DEPTH)
    setInteraction(IDLE_INTERACTION)
  }

  const handleDeleteNote = async (filename: string): Promise<void> => {
    await window.api.notes.deleteNote({ filename })
    onUnpinNote(filename)
  }

  const handleConfirmConnection = async (
    connecting: ConnectingInteraction,
    label: string
  ): Promise<void> => {
    await window.api.notes.connectNotes({
      source: connecting.source,
      target: connecting.target,
      label
    })

    setInteraction(IDLE_INTERACTION)
    onRefetch()
  }

  const handleEdgeChanged = useCallback(() => {
    onRefetch()
  }, [onRefetch])

  const handlePinNote = useCallback(
    (filename: string) => {
      onPinNote(filename, MANUAL_PIN_DEPTH)
    },
    [onPinNote]
  )

  const { nodes, edges } = buildView(graph, layouted, pins, interaction, {
    onDeleteNote: handleDeleteNote,
    onSaveDraft: handleSaveDraft,
    onCancelInteraction: handleCancelInteraction,
    onConfirmConnection: handleConfirmConnection,
    onEdgeChanged: handleEdgeChanged,
    onPinNote: handlePinNote,
    onUnpinNote: onUnpinNote,
    onChangeDepth: onSetPinDepth
  })

  return (
    <ReactFlow
      fitView
      nodeOrigin={[0.5, 0.5]}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable
      connectionRadius={CONNECTION_RADIUS}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onDoubleClick={handlePaneDoubleClick}
      zoomOnDoubleClick={false}
      connectionLineStyle={{ stroke: '#d36945', strokeWidth: 1.6, strokeDasharray: '4 4' }}
      minZoom={0.02}
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
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export default function GraphCanvas({
  graph,
  loading,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth,
  onRefetch
}: GraphCanvasProps): React.JSX.Element {
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#dfceb9] bg-[rgba(255,251,246,0.72)] text-sm text-[#715748] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
        Search for a note to pin it.
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[24px] border border-[#e2d4c4] bg-[linear-gradient(180deg,rgba(255,252,247,0.94),rgba(247,239,230,0.9))] shadow-[0_32px_80px_rgba(122,95,74,0.12)]">
      {loading ? (
        <div className="pointer-events-none absolute inset-0 z-20 bg-[rgba(255,250,245,0.6)] backdrop-blur-[1px]" />
      ) : null}
      <ReactFlowProvider>
        <FlowScene
          graph={graph}
          pins={pins}
          onPinNote={onPinNote}
          onUnpinNote={onUnpinNote}
          onSetPinDepth={onSetPinDepth}
          onRefetch={onRefetch}
        />
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

  const knownFilenames = new Set(graph.nodes.map((note) => note.filename))

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: graph.nodes.map((note) => ({
      id: note.filename,
      width: nodeSizes.get(note.filename)?.width ?? NODE_WIDTH,
      height: nodeSizes.get(note.filename)?.height ?? NODE_MIN_HEIGHT
    })),
    // ELK throws if an edge references a node id not present in `children` above -
    // defend against that even though the backend is expected not to send one.
    edges: graph.edges
      .filter((edge) => knownFilenames.has(edge.source) && knownFilenames.has(edge.target))
      .map((edge): ElkExtendedEdge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target]
      }))
  }

  const layout = await elk.layout(elkGraph)
  const children = layout.children ?? []

  // No single "center" to anchor to with multiple simultaneous pins - use ELK's raw
  // coordinates directly. fitView (see the effect above) reframes the viewport after
  // every layout anyway, so the absolute coordinate origin is never visible to the user.
  const positions = new Map(
    children.map((node) => [
      node.id,
      {
        x: (node.x ?? 0) + (node.width ?? NODE_WIDTH) / 2,
        y: (node.y ?? 0) + (node.height ?? NODE_MIN_HEIGHT) / 2
      }
    ])
  )

  const layoutedNodes: LayoutedNode[] = graph.nodes.map((note) => ({
    note,
    position: positions.get(note.filename) ?? { x: 0, y: 0 },
    width: nodeSizes.get(note.filename)?.width ?? NODE_WIDTH,
    height: nodeSizes.get(note.filename)?.height ?? NODE_MIN_HEIGHT
  }))

  return {
    nodes: layoutedNodes
  }
}

/**
 * Groups a flat relation list by unordered node-pair and collapses any
 * reciprocal pair into a single visual edge (see buildReciprocalEdge) so its
 * two labels render merged instead of stacked. This is the *only* place that
 * merging happens - callers must feed it the complete current relation list
 * (backend-confirmed and still-optimistic alike) rather than merging in
 * separate passes, since a merged edge's id no longer matches either of its
 * inputs' raw ids and so can't be reconciled against after the fact.
 */
function mergeRelationsIntoEdges(
  relations: GraphEdgePayload[],
  positions: Map<string, { x: number; y: number }>
): Edge[] {
  const pairGroups = new Map<string, GraphEdgePayload[]>()
  for (const relation of relations) {
    const pairKey = [relation.source, relation.target].sort().join('__')
    const group = pairGroups.get(pairKey)
    if (group) {
      group.push(relation)
    } else {
      pairGroups.set(pairKey, [relation])
    }
  }

  const edges: Edge[] = []
  for (const group of pairGroups.values()) {
    if (group.length === 2 && isReciprocalPair(group[0], group[1])) {
      edges.push(buildReciprocalEdge(group[0], group[1], positions))
    } else {
      for (const relation of group) {
        edges.push(buildDirectedEdge(relation))
      }
    }
  }

  return edges
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
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color
    },
    style: {
      stroke: color,
      ...edgeVisualWeight(edge)
    },
    data: { relations: [edge] }
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
    style: {
      stroke: color,
      ...edgeVisualWeight(first.depth <= second.depth ? first : second)
    },
    data: { relations: [first, second] }
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
