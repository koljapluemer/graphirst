import { useNodesInitialized, useReactFlow, useStore, type ReactFlowState } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { XYPosition } from '@xyflow/react'
import {
  collectMeasuredHeights,
  EMPTY_LAYOUT,
  ESTIMATED_LAYOUT,
  getLayoutedGraph,
  layoutHeightsDrifted,
  measuredHeightSignature,
  separateOverlaps,
  type LayoutedGraph,
  type LayoutState
} from '../lib/graph-layout'
import type { Interaction } from '../components/graph-interaction'
import type { NoteGraph } from '../../../shared/notes'

const selectMeasuredHeightSignature = (state: ReactFlowState): string =>
  measuredHeightSignature(collectMeasuredHeights(state.nodeLookup.values()))

export interface UseElkLayoutParams {
  graph: NoteGraph
  pins: ReadonlyMap<string, number>
  interactionType: Interaction['type']
  /** Notes the user has dragged: pinned in the layout and the drop patch below. */
  manualPositionsRef: RefObject<Map<string, XYPosition>>
  /** True for the duration of a node drag - layout passes are suspended so a drag never fights ELK. */
  dragging: boolean
  isDraggingRef: RefObject<boolean>
}

export interface UseElkLayoutResult {
  layouted: LayoutedGraph
  /** The note new/disconnected nodes are seeded next to. Drives NoteCard's dashed border. */
  anchorFilename: string | null
  /** Records that a note was just pinned/created/acted-on, so it becomes the next layout anchor. */
  markInteraction: (filename: string) => void
  /**
   * Re-applies every manual position to the current layout and re-opens space
   * around them - no ELK run. Called on drop so the released card keeps its exact
   * spot while its neighbours shift out of the way.
   */
  applyManualDrop: () => void
}

/**
 * Owns the two-pass ELK layout lifecycle:
 *
 *  1. Whenever the graph changes, lay it out from `estimateNodeHeight()` guesses.
 *  2. Once React Flow has measured every rendered card, re-lay-out from the real
 *     heights - but only if a card drifted far enough to move a neighbour.
 *
 * plus the "seed new nodes next to the note that was just acted on" anchoring, a
 * viewport fit once the layout is final, and `applyManualDrop` for the on-drop
 * separation. Both ELK passes are suspended while a node is being dragged
 * (`dragging`) so a manual move never races a relayout.
 */
export function useElkLayout({
  graph,
  pins,
  interactionType,
  manualPositionsRef,
  dragging,
  isDraggingRef
}: UseElkLayoutParams): UseElkLayoutResult {
  const { fitView, getNodes } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  // Reactive signal: changes whenever any card's measured height changes, so the
  // measured-height pass re-runs when a card grows (body edit, an image finishing
  // load) and not on unrelated store updates like viewport pans.
  const measuredSignature = useStore(selectMeasuredHeightSignature)

  const [layouted, setLayouted] = useState<LayoutedGraph>(EMPTY_LAYOUT)
  const [layoutState, setLayoutState] = useState<LayoutState>(ESTIMATED_LAYOUT)
  // Mirrors `layouted` outside state so a layout pass (and applyManualDrop) can
  // read the latest positions without depending on `layouted` - which would
  // re-trigger the passes.
  const layoutedRef = useRef<LayoutedGraph>(EMPTY_LAYOUT)
  // The graph the estimated pass last consumed. Lets its re-run on drag-end (the
  // `dragging` dep) be a no-op unless the graph actually changed while the drag,
  // and the layout with it, was suspended.
  const laidOutGraphRef = useRef<NoteGraph | null>(null)

  // The note a brand-new, otherwise-unconnected node's position is seeded from -
  // without this, a note pinned with no relation to anything on screen is laid
  // out from scratch and fitView can zoom out past the point where either is
  // actually visible.
  const anchorRef = useRef<string | null>(null)
  const [anchorFilename, setAnchorFilename] = useState<string | null>(null)
  // Most recently added/acted-on note - promoted to the real anchor once it has
  // a resolved position, so a fresh pin never ends up seeded from itself.
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

  const applyManualDrop = useCallback(() => {
    const manual = manualPositionsRef.current
    const withDrops: LayoutedGraph = {
      nodes: layoutedRef.current.nodes.map((item) => {
        const dropped = manual.get(item.note.filename)
        return dropped ? { ...item, position: dropped } : item
      })
    }
    const next: LayoutedGraph = {
      nodes: separateOverlaps(withDrops.nodes, new Set(manual.keys()))
    }
    layoutedRef.current = next
    setLayouted(next)
  }, [manualPositionsRef])

  // Pass 1: estimated heights. Runs on every graph change; its `dragging` dep also
  // fires it on drag-end, which the guard turns into a no-op unless the graph
  // changed while the drag - and the layout - was suspended.
  useEffect(() => {
    if (dragging || graph === laidOutGraphRef.current) {
      return
    }
    let cancelled = false

    const runLayout = async (): Promise<void> => {
      try {
        const nextLayout = await getLayoutedGraph(
          graph,
          layoutedRef.current,
          anchorRef.current,
          manualPositionsRef.current
        )
        if (cancelled || isDraggingRef.current) {
          return
        }
        layoutedRef.current = nextLayout
        laidOutGraphRef.current = graph

        const pending = pendingAnchorRef.current
        if (pending && pending !== anchorRef.current) {
          const resolved = nextLayout.nodes.some((item) => item.note.filename === pending)
          if (resolved) {
            anchorRef.current = pending
            setAnchorFilename(pending)
          }
        }

        setLayouted(nextLayout)
        setLayoutState(ESTIMATED_LAYOUT)
      } catch (error) {
        // Never fail silently: an uncaught rejection here used to leave `layouted`
        // frozen forever with no visible sign anything had gone wrong.
        console.error('Failed to lay out graph:', error)
      }
    }

    void runLayout()

    return () => {
      cancelled = true
    }
  }, [graph, dragging, manualPositionsRef, isDraggingRef])

  // Pass 2: real measured heights. `layoutState` keeps this from looping - a pass
  // records the height signature it consumed and this only fires again when that
  // signature moves. Suppressed mid-interaction (an editing card grows as it is
  // typed into and floats above its neighbours) and mid-drag.
  useEffect(() => {
    if (
      dragging ||
      interactionType !== 'idle' ||
      !nodesInitialized ||
      layouted.nodes.length === 0
    ) {
      return
    }

    const measuredHeights = collectMeasuredHeights(getNodes())
    const everyNodeMeasured = layouted.nodes.every((item) =>
      measuredHeights.has(item.note.filename)
    )
    if (!everyNodeMeasured) {
      return
    }

    const signature = measuredHeightSignature(measuredHeights)
    if (layoutState.phase === 'measured' && layoutState.fromHeights === signature) {
      return
    }

    let cancelled = false

    const settle = async (): Promise<void> => {
      try {
        const nextLayout = layoutHeightsDrifted(layouted, measuredHeights)
          ? await getLayoutedGraph(
              graph,
              layoutedRef.current,
              anchorRef.current,
              manualPositionsRef.current,
              measuredHeights
            )
          : null
        if (cancelled || isDraggingRef.current) {
          return
        }
        if (nextLayout) {
          layoutedRef.current = nextLayout
          setLayouted(nextLayout)
        }
        setLayoutState({ phase: 'measured', fromHeights: signature })
      } catch (error) {
        console.error('Failed to re-lay out graph from measured heights:', error)
      }
    }

    void settle()

    return () => {
      cancelled = true
    }
  }, [
    graph,
    layouted,
    layoutState,
    dragging,
    interactionType,
    nodesInitialized,
    measuredSignature,
    getNodes,
    manualPositionsRef,
    isDraggingRef
  ])

  // Reframe once the layout is final (measured pass done), so fitView never
  // frames the estimated layout and then jumps when the measured pass shifts it.
  useEffect(() => {
    if (layoutState.phase !== 'measured' || layouted.nodes.length === 0) {
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
  }, [fitView, layoutState, layouted.nodes.length])

  return { layouted, anchorFilename, markInteraction, applyManualDrop }
}
