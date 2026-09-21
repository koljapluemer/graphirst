import type { Edge } from '@xyflow/react'
import type { HiddenRelationsFlowNode } from './HiddenRelationsNode'
import { FOLLOWER_NODE_CLASS_NAME, NODE_CLASS_NAME } from './graph-node-style'
import { HIDDEN_BADGE_GAP, type LayoutedGraph } from '../lib/graph-layout'

/**
 * Pin depth at which a note's direct relations are all rendered. What a click on a
 * hidden-relations badge pins its note to.
 */
export const EXPAND_PIN_DEPTH = 1

/**
 * Whether pinning at EXPAND_PIN_DEPTH would change anything. When it wouldn't (the
 * note is already pinned that deep) whatever is still hidden is held back by the
 * backend's relation / node caps, which a repeat pin can't lift.
 */
export function needsExpansion(pinDepth: number | null): boolean {
  return pinDepth === null || pinDepth < EXPAND_PIN_DEPTH
}

const HIDDEN_RELATIONS_ID_PREFIX = 'hidden:'

const HIDDEN_RELATIONS_EDGE_STYLE = { strokeWidth: 1.2, opacity: 0.58 }

export interface HiddenRelationsView {
  nodes: HiddenRelationsFlowNode[]
  edges: Edge[]
}

/**
 * Decorates every note that has related notes off the canvas with a small badge
 * hanging below it, joined by an unlabeled edge. Derived purely from the layout
 * and pin state - none of it is part of the backend graph, and none of it goes
 * through ELK (the wider NODE_GAP leaves the room instead).
 *
 * Each badge is a React Flow *child* of its note (`parentId`), so it follows the
 * note when that is dragged and needs no bookkeeping of its own. Its position is
 * relative to the note's top-left corner, and its own `origin` is top-centre, so
 * "centred, HIDDEN_BADGE_GAP under the card" needs only the card's slot size.
 *
 * The badge kind carries none of a note's behaviour: it can't be dragged,
 * selected, deleted or connected to.
 *
 * The note being edited is skipped: its card grows as it is typed into while the
 * layout (and so the slot height used here) is suspended.
 */
export function buildHiddenRelations(
  layouted: LayoutedGraph,
  pins: ReadonlyMap<string, number>,
  editingFilename: string | null,
  onExpand: (filename: string) => void
): HiddenRelationsView {
  const view: HiddenRelationsView = { nodes: [], edges: [] }

  for (const item of layouted.nodes) {
    const { filename, hiddenNeighbors } = item.note
    if (hiddenNeighbors === 0 || filename === editingFilename) {
      continue
    }

    const id = `${HIDDEN_RELATIONS_ID_PREFIX}${filename}`
    view.nodes.push({
      id,
      type: 'hiddenRelations',
      parentId: filename,
      origin: [0.5, 0],
      position: { x: item.width / 2, y: item.height + HIDDEN_BADGE_GAP },
      className: `${NODE_CLASS_NAME} ${FOLLOWER_NODE_CLASS_NAME}`,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      data: {
        filename,
        hiddenCount: hiddenNeighbors,
        expandable: needsExpansion(pins.get(filename) ?? null),
        onExpand
      }
    })
    view.edges.push({
      id: `${id}__edge`,
      source: filename,
      target: id,
      type: 'floating',
      selectable: false,
      focusable: false,
      deletable: false,
      style: HIDDEN_RELATIONS_EDGE_STYLE
    })
  }

  return view
}
