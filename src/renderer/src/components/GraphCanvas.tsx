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
  onOpenNote: (filename: string) => void
  onNoteDeleted: (filename: string) => void
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

interface PinnedNote {
  note: GraphNodePayload
  position: { x: number; y: number }
}

/**
 * A relation the backend may never surface: its graph query only ever walks the
 * *outgoing/incoming* relations of the center note and its direct neighbors - a note
 * two hops out from center is a traversal leaf whose own relations are never
 * examined, no matter how deep MAX_GRAPH_DEPTH allows nodes to be registered. Any
 * relation we just created client-side is pinned here so it renders regardless of
 * whether the backend's BFS would ever have found it, and is dropped once the
 * backend graph includes an edge with the same id.
 */
interface PinnedRelation {
  source: string
  target: string
  label: string
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
}

/**
 * The single place where the server-derived graph, the local cache of
 * freshly-created freestanding notes, and the current in-progress interaction
 * are merged into what actually gets handed to <ReactFlow>. Kept as a pure
 * function of its inputs so this merge logic can be reasoned about (and
 * tested) independently of React's render cycle.
 */
function buildView(
  layouted: LayoutedGraph,
  pinnedNotes: Map<string, PinnedNote>,
  pinnedRelations: Map<string, PinnedRelation>,
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
      onDelete: callbacks.onDeleteNote
    }
  }))

  const knownFilenames = new Set(nodes.map((node) => node.id))

  for (const [filename, pinned] of pinnedNotes) {
    // Once the backend graph can reach this note on its own, that copy is authoritative.
    if (knownFilenames.has(filename)) {
      continue
    }

    nodes.push({
      id: filename,
      type: 'note',
      position: pinned.position,
      width: NODE_WIDTH,
      height: estimateNodeHeight(pinned.note),
      selectable: true,
      dragHandle: '.note-drag-handle',
      data: {
        kind: 'note',
        note: pinned.note,
        onDelete: callbacks.onDeleteNote
      }
    })
    knownFilenames.add(filename)
  }

  const rawEdges: Edge[] = [...layouted.edges]
  const knownEdgeIds = new Set(layouted.edges.map((edge) => edge.id))

  for (const [edgeId, relation] of pinnedRelations) {
    // Same idea as pinned notes: once the backend's own graph includes this edge,
    // defer to it instead of drawing a second, parallel copy.
    if (knownEdgeIds.has(edgeId)) {
      continue
    }
    if (!knownFilenames.has(relation.source) || !knownFilenames.has(relation.target)) {
      continue
    }

    rawEdges.push(
      buildDirectedEdge({
        id: edgeId,
        source: relation.source,
        target: relation.target,
        label: relation.label,
        depth: 1,
        direction: 'outgoing'
      })
    )
  }

  const edges: Edge[] = rawEdges.map((edge) => ({
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
  onOpenNote,
  onNoteDeleted
}: {
  graph: NoteGraph
  onOpenNote: (filename: string) => void
  onNoteDeleted: (filename: string) => void
}): React.JSX.Element {
  const { fitView, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layouted, setLayouted] = useState<LayoutedGraph>({ nodes: [], edges: [] })
  const [interaction, setInteraction] = useState<Interaction>(IDLE_INTERACTION)
  const [pinnedNotes, setPinnedNotes] = useState<Map<string, PinnedNote>>(new Map())
  const [pinnedRelations, setPinnedRelations] = useState<Map<string, PinnedRelation>>(new Map())
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

    // Always pin the new note locally rather than trusting the next backend refresh
    // to include it: the graph query only ever walks relations belonging to the
    // center and its direct neighbors, so a note connected from a two-hops-out note
    // would otherwise never appear at all, silently, with no error - see
    // PinnedRelation above.
    setPinnedNotes((prev) => {
      const next = new Map(prev)
      next.set(response.filename, {
        position: draft.position,
        note: {
          filename: response.filename,
          body,
          aliases: [],
          depth: 1,
          direction: 'mixed',
          degree: 0
        }
      })
      return next
    })

    if (draft.sourceFilename && response.label) {
      const [relationSource, relationTarget] = reverse
        ? [response.filename, draft.sourceFilename]
        : [draft.sourceFilename, response.filename]
      const edgeId = `${relationSource}__${relationTarget}__${response.label}`

      setPinnedRelations((prev) => {
        const next = new Map(prev)
        next.set(edgeId, { source: relationSource, target: relationTarget, label: response.label! })
        return next
      })
    }

    setInteraction(IDLE_INTERACTION)
    onOpenNote(graph.center)
  }

  const handleDeleteNote = async (filename: string): Promise<void> => {
    await window.api.notes.deleteNote({ filename })

    setPinnedNotes((prev) => {
      if (!prev.has(filename)) {
        return prev
      }
      const next = new Map(prev)
      next.delete(filename)
      return next
    })

    onNoteDeleted(filename)
  }

  const handleConfirmConnection = async (
    connecting: ConnectingInteraction,
    label: string
  ): Promise<void> => {
    const response = await window.api.notes.connectNotes({
      source: connecting.source,
      target: connecting.target,
      label
    })

    // Same reasoning as handleSaveDraft: the backend's graph query may never surface
    // this relation on its own if either note is two hops out from center.
    const edgeId = `${connecting.source}__${connecting.target}__${response.label}`
    setPinnedRelations((prev) => {
      const next = new Map(prev)
      next.set(edgeId, {
        source: connecting.source,
        target: connecting.target,
        label: response.label
      })
      return next
    })

    setInteraction(IDLE_INTERACTION)
    onOpenNote(graph.center)
  }

  const handleEdgeChanged = useCallback(() => {
    onOpenNote(graph.center)
  }, [onOpenNote, graph.center])

  const { nodes, edges } = buildView(layouted, pinnedNotes, pinnedRelations, interaction, {
    onDeleteNote: handleDeleteNote,
    onSaveDraft: handleSaveDraft,
    onCancelInteraction: handleCancelInteraction,
    onConfirmConnection: handleConfirmConnection,
    onEdgeChanged: handleEdgeChanged
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
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export default function GraphCanvas({
  graph,
  loading,
  onOpenNote,
  onNoteDeleted
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
        {/*
          Keyed on center: a real navigation should reset all of FlowScene's local UI
          state (in-progress draft/connection interaction, pinned freestanding notes)
          rather than trying to reconcile it, so a remount is simpler and cheaper than
          manual effect-driven resets.
        */}
        <FlowScene
          key={graph.center}
          graph={graph}
          onOpenNote={onOpenNote}
          onNoteDeleted={onNoteDeleted}
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
