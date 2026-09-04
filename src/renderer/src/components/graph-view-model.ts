import type { Edge } from '@xyflow/react'
import type { ImageState } from './DraftNoteCard'
import type { NoteFlowNode } from './NoteNode'
import { mergeRelationsIntoEdges } from './graph-edges'
import type { ConnectingInteraction, DraftInteraction, Interaction } from './graph-interaction'
import { NODE_WIDTH, type LayoutedGraph } from '../lib/graph-layout'
import { GRAPH_COLORS } from '../lib/graph-colors'
import type { GraphEdgePayload, NoteGraph } from '../../../shared/notes'

// Resets React Flow's own default node-wrapper styling (border/shadow/padding) and
// marks the wrapper as a hover/focus `group` so NoteNode's connect-handle dots and
// selection ring (see NoteCard) can react to it - applied to every node kind since
// all of them render inside a `.react-flow__node` we don't otherwise control.
//
// `transition-transform` glides a node to its new spot when the layout changes.
// React Flow drives the position by `transform` on this same element, so the
// transition has to be killed while the node is being dragged (`.dragging` is
// React Flow's own class) - otherwise every per-frame drag update animates over
// 300ms and the node lags the cursor.
const NODE_CLASS_NAME =
  'group border-0 bg-transparent shadow-none p-0 transition-transform duration-300 ease-in-out [&.dragging]:transition-none'

// Draft/edit cards can grow past a neighbor's estimated layout slot while their
// content changes - keep them above everything else instead of trying to keep
// the layout from ever overlapping them.
const EDITING_NODE_Z_INDEX = 1000

export interface ViewCallbacks {
  onDeleteNote: (filename: string) => Promise<void>
  onStartEdit: (filename: string) => void
  onSaveEdit: (
    filename: string,
    body: string,
    image: ImageState,
    previousImage: string | null,
    extraContent: string
  ) => Promise<void>
  onUpdateExtra: (filename: string, patch: { body: string; extraContent: string }) => Promise<void>
  onSaveDraft: (
    draft: DraftInteraction,
    body: string,
    label: string,
    reverse: boolean,
    image: ImageState
  ) => Promise<void>
  onCancelInteraction: () => void
  onConfirmConnection: (connecting: ConnectingInteraction, label: string) => Promise<void>
  onDeleteRelation: (relation: GraphEdgePayload) => Promise<void>
  onPinNote: (filename: string) => void
  onUnpinNote: (filename: string) => void
  onChangeDepth: (filename: string, nextDepth: number) => void
  onDeleteNoteEntry: (filename: string, index: number) => Promise<void>
}

/**
 * The single place where the server-derived graph, the ELK layout, the current
 * pin state and the current in-progress interaction are merged into what
 * actually gets handed to <ReactFlow>. Kept as a pure function of its inputs so
 * this merge logic can be reasoned about independently of React's render cycle;
 * `useGraphNodes` runs it in an effect and reconciles the result into React
 * Flow's node state.
 *
 * `layouted` is authoritative for every node's position - including ones the
 * user has dragged. Those are pinned and separated inside the layout layer (see
 * getLayoutedGraph / separateOverlaps and useElkLayout's applyManualDrop), so
 * there is nothing to override here.
 *
 * The backend graph is authoritative for what notes/relations exist - there is
 * no client-side patch layer here, since a pinned note is a real BFS root on the
 * backend rather than an optimistic guess.
 */
export function buildView(
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
    // internal ResizeObserver instead of us forcing one onto the DOM.
    // `item.height` is the height ELK spaced this node's slot with.
    const shared = {
      id: item.note.filename,
      type: 'note' as const,
      position: item.position,
      width: item.width,
      selectable: true,
      className: NODE_CLASS_NAME
    }

    if (interaction.type === 'edit' && interaction.filename === item.note.filename) {
      return {
        ...shared,
        draggable: false,
        zIndex: EDITING_NODE_Z_INDEX,
        data: {
          kind: 'edit',
          initialBody: item.note.body,
          initialImage: item.note.image,
          onSave: (body: string, image: ImageState) =>
            callbacks.onSaveEdit(
              item.note.filename,
              body,
              image,
              item.note.image,
              item.note.extraContent
            ),
          onCancel: callbacks.onCancelInteraction
        }
      }
    }

    return {
      ...shared,
      draggable: true,
      dragHandle: '.note-drag-handle',
      data: {
        kind: 'note',
        note: item.note,
        pinDepth: pins.get(item.note.filename) ?? null,
        isAnchor: item.note.filename === anchorFilename,
        onDelete: callbacks.onDeleteNote,
        onEdit: callbacks.onStartEdit,
        onUpdateExtra: (filename: string, extraContent: string) =>
          callbacks.onUpdateExtra(filename, { body: item.note.body, extraContent }),
        onPin: callbacks.onPinNote,
        onUnpin: callbacks.onUnpinNote,
        onChangeDepth: callbacks.onChangeDepth,
        onDeleteNoteEntry: callbacks.onDeleteNoteEntry
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
      draggable: false,
      className: NODE_CLASS_NAME,
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
        style: { stroke: GRAPH_COLORS.base300, strokeWidth: 1.4, strokeDasharray: '4 4' }
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
