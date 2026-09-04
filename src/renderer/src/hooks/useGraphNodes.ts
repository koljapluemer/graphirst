import {
  useNodesState,
  type Edge,
  type OnNodeDrag,
  type OnNodesChange,
  type XYPosition
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { NoteFlowNode } from '../components/NoteNode'
import { DRAFT_ID_PREFIX, type Interaction } from '../components/graph-interaction'
import { buildView, type ViewCallbacks } from '../components/graph-view-model'
import type { LayoutedGraph } from '../lib/graph-layout'
import type { NoteGraph } from '../../../shared/notes'

const EMPTY_NODES: NoteFlowNode[] = []
const EMPTY_EDGES: Edge[] = []

export interface UseGraphNodesParams {
  graph: NoteGraph
  layouted: LayoutedGraph
  pins: ReadonlyMap<string, number>
  interaction: Interaction
  anchorFilename: string | null
  callbacks: ViewCallbacks
  /** Notes the user has dragged, by filename. Written here on drag end, read by ELK + buildView. */
  manualPositionsRef: RefObject<Map<string, XYPosition>>
  /** True while a node drag is in progress - the view sync is suspended so it never clobbers the live drag. */
  dragging: boolean
  onDragStart: () => void
  onDragStop: () => void
}

export interface UseGraphNodesResult {
  nodes: NoteFlowNode[]
  edges: Edge[]
  onNodesChange: OnNodesChange<NoteFlowNode>
  onNodeDragStart: OnNodeDrag<NoteFlowNode>
  onNodeDragStop: OnNodeDrag<NoteFlowNode>
}

/**
 * Bridges the derived view (buildView) and React Flow's own node state.
 *
 * React Flow owns `nodes` via `useNodesState`, so a drag mutates only the dragged
 * node in place - no per-frame rebuild of the whole array. A `useEffect`
 * re-derives the view and reconciles it into that state whenever a layout / graph
 * / pin / interaction input changes (never during a drag), preserving object
 * identity for untouched nodes so their measured size and edges don't churn. This
 * is React Flow's recommended shape for a flow whose nodes also come from
 * external data (see reactflow.dev/api-reference/hooks/use-nodes-state).
 */
export function useGraphNodes({
  graph,
  layouted,
  pins,
  interaction,
  anchorFilename,
  callbacks,
  manualPositionsRef,
  dragging,
  onDragStart,
  onDragStop
}: UseGraphNodesParams): UseGraphNodesResult {
  const [nodes, setNodes, onNodesChange] = useNodesState<NoteFlowNode>(EMPTY_NODES)
  // Edges are plain state: they carry no interaction changes we round-trip
  // (labels are edited straight through the IPC bridge), so no `onEdgesChange`.
  const [edges, setEdges] = useState<Edge[]>(EMPTY_EDGES)

  const lastGraphRef = useRef<NoteGraph | null>(null)
  const lastCallbacksRef = useRef<ViewCallbacks | null>(null)

  // Sync the derived view into React Flow's node/edge state. Suspended mid-drag
  // (`dragging`) and re-run when the drag ends, so the final dropped position -
  // by then recorded in `manualPositionsRef` - is baked into the view.
  useEffect(() => {
    const reuseIdentity = lastGraphRef.current === graph && lastCallbacksRef.current === callbacks
    lastGraphRef.current = graph
    lastCallbacksRef.current = callbacks

    if (dragging) {
      return
    }

    const view = buildView(
      graph,
      layouted,
      pins,
      manualPositionsRef.current,
      interaction,
      anchorFilename,
      callbacks
    )
    setNodes((current) => reconcileNodes(current, view.nodes, reuseIdentity))
    setEdges((current) => reconcileEdges(current, view.edges, reuseIdentity))
  }, [
    graph,
    layouted,
    pins,
    interaction,
    anchorFilename,
    callbacks,
    dragging,
    manualPositionsRef,
    setNodes
  ])

  // A dragged position lives only while the note is on the canvas - forget it
  // once the note leaves the graph, so a re-pinned note returns to a freshly
  // computed slot. Ref-only: no state update, so nothing re-renders here.
  useEffect(() => {
    const present = new Set(graph.nodes.map((note) => note.filename))
    for (const filename of manualPositionsRef.current.keys()) {
      if (!present.has(filename)) {
        manualPositionsRef.current.delete(filename)
      }
    }
  }, [graph, manualPositionsRef])

  const onNodeDragStart = useCallback<OnNodeDrag<NoteFlowNode>>(() => {
    onDragStart()
  }, [onDragStart])

  const onNodeDragStop = useCallback<OnNodeDrag<NoteFlowNode>>(
    (_event, node) => {
      if (node.type === 'note' && !node.id.startsWith(DRAFT_ID_PREFIX)) {
        manualPositionsRef.current.set(node.id, { x: node.position.x, y: node.position.y })
      }
      onDragStop()
    },
    [manualPositionsRef, onDragStop]
  )

  return { nodes, edges, onNodesChange, onNodeDragStart, onNodeDragStop }
}

/**
 * Merges a freshly derived view into the current React Flow node array:
 *
 *  - Selection is React Flow's to own (it lands via `onNodesChange`, not
 *    `buildView`), so it is carried across from the current node by id.
 *  - When the graph and callbacks are unchanged, the previous node *object* is
 *    reused for any 'note' node whose layout position and card data are
 *    unchanged, so React Flow doesn't re-adopt it - re-adoption drops its
 *    measured size and blinks its edges.
 */
function reconcileNodes(
  current: NoteFlowNode[],
  next: NoteFlowNode[],
  reuseIdentity: boolean
): NoteFlowNode[] {
  if (current.length === 0) {
    return next
  }

  const byId = new Map(current.map((node) => [node.id, node]))
  let changed = current.length !== next.length
  const merged = next.map((node) => {
    const prev = byId.get(node.id)
    const selected = prev?.selected ?? false
    const desired: NoteFlowNode =
      selected === (node.selected ?? false) ? node : { ...node, selected }

    if (prev && reuseIdentity && sameNoteNode(prev, desired)) {
      return prev
    }
    changed = true
    return desired
  })

  return changed ? merged : current
}

function sameNoteNode(a: NoteFlowNode, b: NoteFlowNode): boolean {
  // Only the plain 'note' kind is reused in place - draft/edit cards are
  // transient and singular, so rebuilding them costs nothing.
  if (a.data.kind !== 'note' || b.data.kind !== 'note') {
    return false
  }
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.width === b.width &&
    a.draggable === b.draggable &&
    a.data.note === b.data.note &&
    a.data.pinDepth === b.data.pinDepth &&
    a.data.isAnchor === b.data.isAnchor
  )
}

/**
 * Edges carry no measured state, so identity only needs preserving to spare the
 * FloatingEdge components a re-render on a no-op sync. Safe to keep the previous
 * array wholesale only when the graph is unchanged (same relations) and the id
 * list lines up.
 */
function reconcileEdges(current: Edge[], next: Edge[], reuseIdentity: boolean): Edge[] {
  if (!reuseIdentity || current.length !== next.length) {
    return next
  }
  for (let i = 0; i < next.length; i += 1) {
    if (current[i].id !== next[i].id) {
      return next
    }
  }
  return current
}
