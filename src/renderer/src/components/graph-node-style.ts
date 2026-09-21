// Resets React Flow's own default node-wrapper styling (border/shadow/padding) and
// marks the wrapper as a hover `group` so NoteNode's connect-handle dots can react
// to it - applied to every node kind since all of them render inside a
// `.react-flow__node` we don't otherwise control.
//
// `transition-transform` glides a node to its new spot when the layout changes.
// React Flow drives the position by `transform` on this same element, so the
// transition has to be killed while the node is being dragged (`.dragging` is
// React Flow's own class) - otherwise every per-frame drag update animates over
// 300ms and the node lags the cursor. Nodes that follow a dragged parent never get
// `.dragging` themselves - see FOLLOWER_NODE_CLASS_NAME.
export const NODE_CLASS_NAME =
  'group border-0 bg-transparent shadow-none p-0 transition-transform duration-300 ease-in-out [&.dragging]:transition-none'

/**
 * Marks a node React Flow positions relative to a parent (see graph-hidden-relations).
 * It moves whenever the parent does but is never itself `.dragging`, so
 * NODE_CLASS_NAME can't stop its glide - GraphCanvas applies
 * FOLLOWERS_STOP_GLIDING_CLASS_NAME to the canvas for the duration of a drag instead.
 * (Not written against React Flow's own `react-flow__*` classes: Tailwind reads
 * the `__` in an arbitrary variant as a space.)
 */
export const FOLLOWER_NODE_CLASS_NAME = 'follower-node'
export const FOLLOWERS_STOP_GLIDING_CLASS_NAME = '[&_.follower-node]:transition-none'
