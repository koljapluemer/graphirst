import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart
} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import FloatingEdge from './FloatingEdge'
import NoteNode, { type NoteFlowNode } from './NoteNode'
import PendingConnectionEdge from './PendingConnectionEdge'
import { CREATED_NOTE_PIN_DEPTH, MANUAL_PIN_DEPTH } from '../hooks/useNoteGraph'
import type { GraphEdgePayload, GraphNodePayload, NoteGraph } from '../../../shared/notes'

const edgeTypes = { floating: FloatingEdge, pendingConnection: PendingConnectionEdge }
const nodeTypes = { note: NoteNode }

const CONNECTION_RADIUS = 200
// Draft/edit cards can grow past a neighbor's estimated layout slot while their
// content changes - keep them above everything else instead of trying to keep
// the layout from ever overlapping them.
const EDITING_NODE_Z_INDEX = 1000

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
  // Interactive mode + seeding each node's previous position (see getLayoutedGraph)
  // biases crossing-minimization and placement toward the existing layout instead
  // of solving fresh each time, so unrelated nodes mostly stay put when the graph
  // changes.
  'elk.interactive': 'true',
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
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
type Interaction = IdleInteraction | DraftInteraction | ConnectingInteraction | EditInteraction

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

interface EditInteraction {
  type: 'edit'
  filename: string
}

const IDLE_INTERACTION: Interaction = { type: 'idle' }

interface ViewCallbacks {
  onDeleteNote: (filename: string) => Promise<void>
  onStartEdit: (filename: string) => void
  onSaveEdit: (filename: string, body: string, image: string | null) => Promise<void>
  onSaveDraft: (
    draft: DraftInteraction,
    body: string,
    label: string,
    reverse: boolean,
    image: string | null
  ) => Promise<void>
  onCancelInteraction: () => void
  onConfirmConnection: (connecting: ConnectingInteraction, label: string) => Promise<void>
  onDeleteRelation: (relation: GraphEdgePayload) => Promise<void>
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
  anchorFilename: string | null,
  callbacks: ViewCallbacks
): { nodes: NoteFlowNode[]; edges: Edge[] } {
  const nodes: NoteFlowNode[] = layouted.nodes.map((item) => {
    // No `height` here - the card sizes to its own content (see .note-card in
    // main.css) and React Flow measures the real rendered height via its
    // internal ResizeObserver instead of us forcing a layout-time estimate onto
    // the DOM. `item.height` remains the estimate ELK used to space this node's
    // layout slot; it's unrelated to what the node actually renders at now.
    const shared = {
      id: item.note.filename,
      type: 'note' as const,
      position: item.position,
      width: item.width,
      selectable: true,
      dragHandle: '.note-drag-handle'
    }

    if (interaction.type === 'edit' && interaction.filename === item.note.filename) {
      return {
        ...shared,
        zIndex: EDITING_NODE_Z_INDEX,
        data: {
          kind: 'edit',
          initialBody: item.note.body,
          initialImage: item.note.image,
          onSave: (body: string, image: string | null) =>
            callbacks.onSaveEdit(item.note.filename, body, image),
          onCancel: callbacks.onCancelInteraction
        }
      }
    }

    return {
      ...shared,
      data: {
        kind: 'note',
        note: item.note,
        pinDepth: pins.get(item.note.filename) ?? null,
        isAnchor: item.note.filename === anchorFilename,
        onDelete: callbacks.onDeleteNote,
        onEdit: callbacks.onStartEdit,
        onPin: callbacks.onPinNote,
        onUnpin: callbacks.onUnpinNote,
        onChangeDepth: callbacks.onChangeDepth
      }
    }
  })

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
      onDeleteRelation: callbacks.onDeleteRelation
    }
  }))

  if (interaction.type === 'draft') {
    nodes.push({
      id: interaction.clientId,
      type: 'note',
      position: interaction.position,
      width: NODE_WIDTH,
      selectable: true,
      dragHandle: '.note-drag-handle',
      zIndex: EDITING_NODE_Z_INDEX,
      data: {
        kind: 'draft',
        showRelation: interaction.sourceFilename !== null,
        onSave: (body, label, reverse, image) =>
          callbacks.onSaveDraft(interaction, body, label, reverse, image),
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

interface UndoAction {
  message: string
  perform: () => Promise<void>
}

const UNDO_TIMEOUT_MS = 6000

/**
 * Backs the bottom "Undo" popover for deletes (see instant-delete elsewhere in
 * this file): notes/relations are removed immediately, with the backend
 * keeping just the single most recent deletion around (see NoteStore.undoDelete)
 * for this to restore. A later delete's popover simply replaces this one,
 * matching the single-slot backend.
 */
function useUndoToast(): {
  undoAction: UndoAction | null
  showUndo: (message: string, perform: () => Promise<void>) => void
  dismissUndo: () => void
} {
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)

  useEffect(() => {
    if (!undoAction) {
      return
    }
    const timer = setTimeout(() => setUndoAction(null), UNDO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [undoAction])

  const showUndo = useCallback((message: string, perform: () => Promise<void>) => {
    setUndoAction({ message, perform })
  }, [])

  const dismissUndo = useCallback(() => setUndoAction(null), [])

  return { undoAction, showUndo, dismissUndo }
}

function FlowScene({
  graph,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth
}: {
  graph: NoteGraph
  pins: ReadonlyMap<string, number>
  onPinNote: (filename: string, depth: number) => void
  onUnpinNote: (filename: string) => void
  onSetPinDepth: (filename: string, depth: number) => void
}): React.JSX.Element {
  const { fitView, screenToFlowPosition } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layouted, setLayouted] = useState<LayoutedGraph>({ nodes: [] })
  const [interaction, setInteraction] = useState<Interaction>(IDLE_INTERACTION)
  const connectingFromRef = useRef<string | null>(null)
  // Mirrors `layouted` outside of state so runLayout can read the latest positions
  // without depending on `layouted` in the effect below - depending on it directly
  // would re-trigger this same effect every time it finishes.
  const layoutedRef = useRef<LayoutedGraph>({ nodes: [] })

  // The filename a brand-new, otherwise-unconnected node's position gets seeded
  // from - without this, a note pinned with no relation to anything already on
  // screen gets laid out from scratch by ELK with no relation to where the
  // existing graph actually is, which can leave the two so far apart that
  // fitView zooms out past the point where either is actually visible.
  const anchorRef = useRef<string | null>(null)
  const [anchorFilename, setAnchorFilename] = useState<string | null>(null)
  // Filename most recently added or acted on - promoted to the real anchor once
  // it has a resolved position (immediately if it already existed, next layout
  // pass if it's new), so a fresh pin never ends up seeded from itself. Tracked
  // as state (not a ref) since it's set from callbacks handed to buildView -
  // refs shouldn't be read/written from code that isn't known to run outside
  // render, and a plain state setter is.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)
  const pendingAnchorRef = useRef<string | null>(null)
  const previousPinsRef = useRef<ReadonlyMap<string, number>>(new Map())

  useEffect(() => {
    pendingAnchorRef.current = pendingAnchor
  }, [pendingAnchor])

  const markInteraction = useCallback((filename: string) => {
    setPendingAnchor(filename)
  }, [])

  useEffect(() => {
    for (const filename of pins.keys()) {
      if (!previousPinsRef.current.has(filename)) {
        markInteraction(filename)
      }
    }
    previousPinsRef.current = pins
  }, [pins, markInteraction])

  useEffect(() => {
    let cancelled = false

    const runLayout = async (): Promise<void> => {
      try {
        const nextLayout = await getLayoutedGraph(graph, layoutedRef.current, anchorRef.current)
        if (!cancelled) {
          layoutedRef.current = nextLayout

          const pending = pendingAnchorRef.current
          if (pending && pending !== anchorRef.current) {
            const resolved = nextLayout.nodes.some((item) => item.note.filename === pending)
            if (resolved) {
              anchorRef.current = pending
              setAnchorFilename(pending)
            }
          }

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

  const { undoAction, showUndo, dismissUndo } = useUndoToast()

  const handleSaveDraft = useCallback(
    async (
      draft: DraftInteraction,
      body: string,
      label: string,
      reverse: boolean,
      image: string | null
    ): Promise<void> => {
      const response = await window.api.notes.createNote({
        relatedFilename: draft.sourceFilename ?? undefined,
        label,
        reverse,
        body,
        image: image ?? undefined
      })

      // The new note becomes its own BFS root, so its relation to the source renders
      // correctly even if the source itself is several hops from every other pin.
      onPinNote(response.filename, CREATED_NOTE_PIN_DEPTH)
      setInteraction(IDLE_INTERACTION)
    },
    [onPinNote]
  )

  const handleDeleteNote = useCallback(
    async (filename: string): Promise<void> => {
      const priorDepth = pins.get(filename) ?? null
      await window.api.notes.deleteNote({ filename })
      onUnpinNote(filename)
      showUndo('Note deleted.', async () => {
        await window.api.notes.undoDelete()
        if (priorDepth !== null) {
          onPinNote(filename, priorDepth)
        }
      })
    },
    [onUnpinNote, onPinNote, pins, showUndo]
  )

  const handleStartEdit = useCallback((filename: string) => {
    setInteraction({ type: 'edit', filename })
  }, [])

  const handleSaveEdit = useCallback(
    async (filename: string, body: string, image: string | null): Promise<void> => {
      await window.api.notes.updateNote({ filename, body, image })
      markInteraction(filename)
      setInteraction(IDLE_INTERACTION)
    },
    [markInteraction]
  )

  const handleConfirmConnection = useCallback(
    async (connecting: ConnectingInteraction, label: string): Promise<void> => {
      await window.api.notes.connectNotes({
        source: connecting.source,
        target: connecting.target,
        label
      })

      markInteraction(connecting.target)
      setInteraction(IDLE_INTERACTION)
    },
    [markInteraction]
  )

  const handleDeleteRelation = useCallback(
    async (relation: GraphEdgePayload): Promise<void> => {
      await window.api.notes.deleteRelation({
        source: relation.source,
        target: relation.target,
        label: relation.label
      })
      showUndo('Relationship deleted.', async () => {
        await window.api.notes.undoDelete()
      })
    },
    [showUndo]
  )

  const handlePinNote = useCallback(
    (filename: string) => {
      onPinNote(filename, MANUAL_PIN_DEPTH)
    },
    [onPinNote]
  )

  const handleUndo = useCallback(() => {
    if (!undoAction) {
      return
    }
    const action = undoAction
    dismissUndo()
    void action.perform()
  }, [undoAction, dismissUndo])

  // Memoized so the node/edge objects handed to <ReactFlow> keep referential identity
  // across renders that don't actually change the view - React Flow's adoptUserNodes
  // only preserves a node's measured DOM size across renders when the node object
  // reference is unchanged (see @xyflow/system's checkEquality gate). Rebuilding this
  // from scratch on every render - e.g. on unrelated App-level state changes like the
  // search query - was resetting every node's measured size and dropping edges whose
  // ResizeObserver hadn't fired again yet.
  const { nodes, edges } = useMemo(
    () =>
      buildView(graph, layouted, pins, interaction, anchorFilename, {
        onDeleteNote: handleDeleteNote,
        onStartEdit: handleStartEdit,
        onSaveEdit: handleSaveEdit,
        onSaveDraft: handleSaveDraft,
        onCancelInteraction: handleCancelInteraction,
        onConfirmConnection: handleConfirmConnection,
        onDeleteRelation: handleDeleteRelation,
        onPinNote: handlePinNote,
        onUnpinNote: onUnpinNote,
        onChangeDepth: onSetPinDepth
      }),
    [
      graph,
      layouted,
      pins,
      interaction,
      anchorFilename,
      handleDeleteNote,
      handleStartEdit,
      handleSaveEdit,
      handleSaveDraft,
      handleCancelInteraction,
      handleConfirmConnection,
      handleDeleteRelation,
      handlePinNote,
      onUnpinNote,
      onSetPinDepth
    ]
  )

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
      {graph.nodes.length === 0 && interaction.type === 'idle' ? (
        <Panel position="top-center">
          <div className="pointer-events-none rounded-full border border-[#e2d3c4] bg-[rgba(255,252,247,0.92)] px-4 py-2 text-sm text-[#715748] shadow-[0_18px_40px_rgba(122,95,74,0.12)]">
            Search for a note to pin it.
          </div>
        </Panel>
      ) : null}
      {undoAction ? (
        <Panel position="bottom-center">
          <div className="flex items-center gap-3 rounded-full border border-[#e2d3c4] bg-[rgba(255,252,247,0.98)] px-4 py-2 text-sm text-[#4a382c] shadow-[0_18px_40px_rgba(122,95,74,0.22)]">
            <span>{undoAction.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs rounded-full text-[#b3672c]"
              onClick={handleUndo}
            >
              Undo
            </button>
          </div>
        </Panel>
      ) : null}
    </ReactFlow>
  )
}

export default function GraphCanvas({
  graph,
  loading,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth
}: GraphCanvasProps): React.JSX.Element {
  if (!graph) {
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
        />
      </ReactFlowProvider>
    </div>
  )
}

async function getLayoutedGraph(
  graph: NoteGraph,
  previousLayout: LayoutedGraph,
  anchorFilename: string | null
): Promise<LayoutedGraph> {
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

  // Previous center positions, converted back to ELK's top-left convention, so
  // ELK's interactive mode has something to anchor to instead of solving from
  // a blank slate.
  const previousPositions = new Map(
    previousLayout.nodes.map((item) => [item.note.filename, item.position])
  )

  // A note with no previous position of its own (freshly pinned, or newly
  // discovered around a freshly pinned note) has nothing tying it to where the
  // rest of the graph already lives. Seed it near the anchor instead of letting
  // ELK place it from scratch - otherwise a disconnected new cluster can land
  // anywhere in the coordinate space, and fitView then has to zoom out to fit
  // both, sometimes far enough that neither ends up actually on screen.
  const anchorSeed = anchorFilename ? previousPositions.get(anchorFilename) : undefined
  // Offset rather than reuse the anchor's exact coordinate, so a fresh node isn't
  // asking ELK to place it directly on top of the node it's anchored to.
  const anchorPosition = anchorSeed
    ? { x: anchorSeed.x + NODE_WIDTH + LAYER_GAP, y: anchorSeed.y }
    : undefined

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: graph.nodes.map((note) => {
      const width = nodeSizes.get(note.filename)?.width ?? NODE_WIDTH
      const height = nodeSizes.get(note.filename)?.height ?? NODE_MIN_HEIGHT
      const previous = previousPositions.get(note.filename) ?? anchorPosition

      return {
        id: note.filename,
        width,
        height,
        ...(previous ? { x: previous.x - width / 2, y: previous.y - height / 2 } : {})
      }
    }),
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

// Matches the max-h-44 (176px) cap the attached-image preview renders at in NoteCard.
const IMAGE_HEIGHT_ESTIMATE = 176

function estimateNodeHeight(note: GraphNodePayload): number {
  const lineCount = note.body.split('\n').length
  const textWeight = Math.ceil(note.body.length / 110)
  const imageHeight = note.image ? IMAGE_HEIGHT_ESTIMATE : 0
  return Math.min(
    Math.max(NODE_MIN_HEIGHT, 120 + Math.max(lineCount, textWeight) * 20 + imageHeight),
    NODE_MAX_HEIGHT
  )
}
