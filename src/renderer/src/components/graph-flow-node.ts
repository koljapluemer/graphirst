import type { HiddenRelationsFlowNode } from './HiddenRelationsNode'
import type { NoteFlowNode } from './NoteNode'

/**
 * Every node kind the canvas renders, discriminated by React Flow's own `type`.
 * A new kind is one more member here plus its entry in GraphCanvas' `nodeTypes`
 * and its equality rule in useGraphNodes' `sameNode`.
 */
export type GraphFlowNode = NoteFlowNode | HiddenRelationsFlowNode
