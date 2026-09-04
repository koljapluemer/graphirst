import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { XYPosition } from '@xyflow/react'
import type { GraphNodePayload, NoteGraph } from '../../../shared/notes'

/**
 * The pure ELK layer: given a backend graph (plus optional measured heights and
 * user-dragged positions) it returns absolute positions for every note node.
 * No React, no side effects beyond the shared ELK worker instance - the layout
 * lifecycle (two passes, anchoring, viewport fitting) lives in `useElkLayout`.
 */

export const NODE_WIDTH = 370
export const NODE_MIN_HEIGHT = 220
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

const elk = new ELK()

export interface LayoutedNode {
  note: GraphNodePayload
  position: XYPosition
  width: number
  height: number
}

export interface LayoutedGraph {
  nodes: LayoutedNode[]
}

export const EMPTY_LAYOUT: LayoutedGraph = { nodes: [] }

/**
 * Where the current `layouted` sits in the two-pass layout sequence:
 * - `estimated`: laid out from estimateNodeHeight() guesses, waiting for React
 *   Flow to measure the rendered cards.
 * - `measured`: laid out from real measured heights. `fromHeights` is the
 *   signature of the heights that pass consumed, so a re-measure only triggers
 *   another layout when a card's height has actually changed.
 */
export type LayoutState = { phase: 'estimated' } | { phase: 'measured'; fromHeights: string }

export const ESTIMATED_LAYOUT: LayoutState = { phase: 'estimated' }

// Height delta (px) below which a measured card isn't worth re-laying-out for -
// pairs with the integer rounding in collectMeasuredHeights.
const LAYOUT_HEIGHT_TOLERANCE = 8

/** Minimal shape shared by React Flow's public `Node` and its `InternalNode`. */
export type MeasuredNode = { id: string; type?: string; measured?: { height?: number } }

/**
 * Per-`note`-node measured heights, keyed by filename (which is the node id).
 * Draft/edit cards are excluded - they are placed by hand, not by ELK.
 */
export function collectMeasuredHeights(nodes: Iterable<MeasuredNode>): Map<string, number> {
  const heights = new Map<string, number>()
  for (const node of nodes) {
    if (node.type === 'note' && node.measured?.height) {
      heights.set(node.id, Math.round(node.measured.height))
    }
  }
  return heights
}

/** Order-independent string identity for a set of measured heights. */
export function measuredHeightSignature(heights: ReadonlyMap<string, number>): string {
  return [...heights]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, height]) => `${id}:${height}`)
    .join('|')
}

/**
 * Whether any card's measured height is far enough from the height ELK reserved
 * for its slot to be worth re-running the layout.
 */
export function layoutHeightsDrifted(
  layouted: LayoutedGraph,
  measuredHeights: ReadonlyMap<string, number>
): boolean {
  return layouted.nodes.some((item) => {
    const measured = measuredHeights.get(item.note.filename)
    return measured !== undefined && Math.abs(measured - item.height) > LAYOUT_HEIGHT_TOLERANCE
  })
}

/**
 * Runs ELK over the current graph and returns each note's absolute position.
 *
 * - `previousLayout` seeds ELK's interactive mode so unrelated nodes stay put
 *   across graph changes.
 * - `manualPositions` (notes the user dragged) are merged over that seed, so
 *   neighbours are placed around a moved node rather than ELK relocating it -
 *   the moved node's own rendered position is pinned downstream in buildView.
 * - `measuredHeights` is supplied on the second pass; the first pass falls back
 *   to estimateNodeHeight().
 */
export async function getLayoutedGraph(
  graph: NoteGraph,
  previousLayout: LayoutedGraph,
  anchorFilename: string | null,
  manualPositions?: ReadonlyMap<string, XYPosition>,
  measuredHeights?: ReadonlyMap<string, number>
): Promise<LayoutedGraph> {
  const nodeSizes = new Map(
    graph.nodes.map((note) => [
      note.filename,
      {
        width: NODE_WIDTH,
        height: measuredHeights?.get(note.filename) ?? estimateNodeHeight(note)
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

  if (manualPositions) {
    for (const [filename, position] of manualPositions) {
      if (knownFilenames.has(filename)) {
        previousPositions.set(filename, position)
      }
    }
  }

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
  // coordinates directly. fitView (see useElkLayout) reframes the viewport after
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

  return { nodes: layoutedNodes }
}

// First-paint height allowance for a card with an attached image. NoteCard
// renders the image unconstrained (h-auto w-full), so this is a rough guess for
// the initial estimate only - the measured-height layout pass corrects the
// spacing once the real card exists.
const IMAGE_HEIGHT_ESTIMATE = 176

/**
 * Cheap per-note height guess for the *first* layout pass, before React Flow has
 * measured the real cards. Deliberately approximate - the measured-height pass
 * corrects ELK's spacing once the DOM exists.
 */
function estimateNodeHeight(note: GraphNodePayload): number {
  const lineCount = note.body.split('\n').length
  const textWeight = Math.ceil(note.body.length / 110)
  const imageHeight = note.image ? IMAGE_HEIGHT_ESTIMATE : 0
  return Math.max(NODE_MIN_HEIGHT, 120 + Math.max(lineCount, textWeight) * 20 + imageHeight)
}
