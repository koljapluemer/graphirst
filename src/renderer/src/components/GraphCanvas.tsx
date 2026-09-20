import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type ColorMode,
  type XYPosition
} from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import FloatingEdge from './FloatingEdge'
import NoteNode from './NoteNode'
import PaneSearchMenu from './PaneSearchMenu'
import PendingConnectionEdge from './PendingConnectionEdge'
import GraphToolbar from './graph-toolbar/GraphToolbar'
import { IDLE_INTERACTION, type Interaction } from './graph-interaction'
import { useGraphToolbarGroups } from './graph-toolbar/useGraphToolbarGroups'
import { useElkLayout } from '../hooks/useElkLayout'
import { useGraphInteraction } from '../hooks/useGraphInteraction'
import { useGraphNodes } from '../hooks/useGraphNodes'
import type { NoteGraph } from '../../../shared/notes'

const edgeTypes = { floating: FloatingEdge, pendingConnection: PendingConnectionEdge }
const nodeTypes = { note: NoteNode }

const CONNECTION_RADIUS = 200

interface GraphCanvasProps {
  graph: NoteGraph | null
  loading: boolean
  colorMode: ColorMode
  pins: ReadonlyMap<string, number>
  onPinNote: (filename: string, depth: number) => void
  onUnpinNote: (filename: string) => void
  onSetPinDepth: (filename: string, depth: number) => void
  onClearPins: () => void
  onPinRandomOrphan: () => void
  pinRandomOrphanBusy: boolean
  onOpenRandomNote: () => void
  openRandomNoteBusy: boolean
  onOpenRandomSearchResult: () => void
  openRandomSearchResultDisabled: boolean
}

interface FlowSceneProps {
  graph: NoteGraph
  colorMode: ColorMode
  pins: ReadonlyMap<string, number>
  onPinNote: (filename: string, depth: number) => void
  onUnpinNote: (filename: string) => void
  onSetPinDepth: (filename: string, depth: number) => void
  onClearPins: () => void
  onPinRandomOrphan: () => void
  pinRandomOrphanBusy: boolean
  onOpenRandomNote: () => void
  openRandomNoteBusy: boolean
  onOpenRandomSearchResult: () => void
  openRandomSearchResultDisabled: boolean
}

/**
 * Wires the graph together: `useElkLayout` computes positions, `useGraphInteraction`
 * owns the draft/connect/edit/search gestures, and `useGraphNodes` bridges the
 * derived view into React Flow's own node state (so dragging is React Flow's job,
 * not a re-render of the whole graph). This component just renders the result.
 */
function FlowScene({
  graph,
  colorMode,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth,
  onClearPins,
  onPinRandomOrphan,
  pinRandomOrphanBusy,
  onOpenRandomNote,
  openRandomNoteBusy,
  onOpenRandomSearchResult,
  openRandomSearchResultDisabled
}: FlowSceneProps): React.JSX.Element {
  const [interaction, setInteraction] = useState<Interaction>(IDLE_INTERACTION)

  // Drag lifecycle, owned here so the layout and node hooks stay in step.
  // `dragging` pauses the node-view sync and both ELK passes; `isDraggingRef` is
  // the same flag for the layout hook's async guards. On drop, useGraphNodes
  // patches the layout via `applyManualDrop` - no ELK re-run.
  const manualPositionsRef = useRef<Map<string, XYPosition>>(new Map())
  const isDraggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const beginDrag = useCallback(() => {
    isDraggingRef.current = true
    setDragging(true)
  }, [])
  const endDrag = useCallback(() => {
    isDraggingRef.current = false
    setDragging(false)
  }, [])

  const { layouted, anchorFilename, markInteraction, applyManualDrop } = useElkLayout({
    graph,
    pins,
    interactionType: interaction.type,
    manualPositionsRef,
    dragging,
    isDraggingRef
  })

  const {
    callbacks,
    undoAction,
    onConnectStart,
    onConnectEnd,
    onPaneDoubleClick,
    onPaneContextMenu,
    cancelInteraction,
    addNoteAtCenter,
    selectSearchNote,
    performUndo
  } = useGraphInteraction({
    setInteraction,
    pins,
    onPinNote,
    onUnpinNote,
    onSetPinDepth,
    markInteraction
  })

  const { nodes, edges, onNodesChange, onNodeDragStart, onNodeDragStop } = useGraphNodes({
    graph,
    layouted,
    pins,
    interaction,
    anchorFilename,
    callbacks,
    manualPositionsRef,
    dragging,
    onDragStart: beginDrag,
    onDragStop: endDrag,
    onManualDrop: applyManualDrop
  })

  const toolbarGroups = useGraphToolbarGroups({
    onAddNote: addNoteAtCenter,
    onUnpinAll: onClearPins,
    onPinOrphan: onPinRandomOrphan,
    onOpenRandomNote,
    onOpenRandomSearchResult,
    unpinAllDisabled: pins.size === 0,
    pinOrphanDisabled: pinRandomOrphanBusy,
    openRandomNoteDisabled: openRandomNoteBusy,
    openRandomSearchResultDisabled
  })

  return (
    <ReactFlow
      fitView
      colorMode={colorMode}
      className="[&_.react-flow__renderer]:cursor-grab [&_.react-flow__renderer:active]:cursor-grabbing [&_.react-flow__viewport]:cursor-grab [&_.react-flow__viewport:active]:cursor-grabbing"
      nodeOrigin={[0.5, 0.5]}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable
      nodesDraggable
      // Selection stays enabled on purpose: React Flow gives a node wrapper
      // `pointer-events: none` unless it is selectable or draggable, which would
      // make the (non-draggable) draft/edit cards unclickable. Nothing renders
      // selection, so the only visible effect to switch off is the z-raise.
      nodesFocusable={false}
      elevateNodesOnSelect={false}
      onNodesChange={onNodesChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      deleteKeyCode={null}
      connectionRadius={CONNECTION_RADIUS}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onDoubleClick={onPaneDoubleClick}
      onPaneContextMenu={onPaneContextMenu}
      zoomOnDoubleClick={false}
      connectionLineStyle={{ strokeWidth: 1.6, strokeDasharray: '4 4' }}
      minZoom={0.02}
      maxZoom={1.5}
      panOnScroll
      panOnDrag={[1]}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: 'floating',
        zIndex: 0
      }}
    >
      <Background gap={28} />
      <Panel position="top-left">
        <GraphToolbar groups={toolbarGroups} />
      </Panel>
      {graph.nodes.length === 0 && interaction.type === 'idle' ? (
        <Panel position="top-center">
          <div className="pointer-events-none rounded-full border border-base-300 bg-base-100/90 px-4 py-2 text-sm text-base-content/70 shadow-lg">
            Search for a note to pin it.
          </div>
        </Panel>
      ) : null}
      {undoAction ? (
        <Panel position="bottom-center">
          <div className="flex items-center gap-3 rounded-full border border-base-300 bg-base-100 px-4 py-2 text-sm shadow-lg">
            <span>{undoAction.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs rounded-full text-accent"
              onClick={performUndo}
            >
              Undo
            </button>
          </div>
        </Panel>
      ) : null}
      {interaction.type === 'search' ? (
        <PaneSearchMenu
          screenPosition={interaction.screenPosition}
          pins={pins}
          onSelectNote={selectSearchNote}
          onClose={cancelInteraction}
        />
      ) : null}
    </ReactFlow>
  )
}

export default function GraphCanvas({
  graph,
  loading,
  colorMode,
  pins,
  onPinNote,
  onUnpinNote,
  onSetPinDepth,
  onClearPins,
  onPinRandomOrphan,
  pinRandomOrphanBusy,
  onOpenRandomNote,
  openRandomNoteBusy,
  onOpenRandomSearchResult,
  openRandomSearchResultDisabled
}: GraphCanvasProps): React.JSX.Element {
  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center  border border-dashed border-base-300 bg-base-100/70 text-sm text-base-content/70">
        Search for a note to pin it.
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden  border border-base-300 bg-base-100 shadow-xl">
      {loading ? (
        <div className="pointer-events-none absolute inset-0 z-20 bg-base-100/60 backdrop-blur-sm" />
      ) : null}
      <ReactFlowProvider>
        <FlowScene
          graph={graph}
          colorMode={colorMode}
          pins={pins}
          onPinNote={onPinNote}
          onUnpinNote={onUnpinNote}
          onSetPinDepth={onSetPinDepth}
          onClearPins={onClearPins}
          onPinRandomOrphan={onPinRandomOrphan}
          pinRandomOrphanBusy={pinRandomOrphanBusy}
          onOpenRandomNote={onOpenRandomNote}
          openRandomNoteBusy={openRandomNoteBusy}
          onOpenRandomSearchResult={onOpenRandomSearchResult}
          openRandomSearchResultDisabled={openRandomSearchResultDisabled}
        />
      </ReactFlowProvider>
    </div>
  )
}
