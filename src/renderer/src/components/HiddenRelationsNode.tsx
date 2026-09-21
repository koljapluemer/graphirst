import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

export type HiddenRelationsNodeData = {
  /** The note this badge hangs off - the one pinned when the badge is clicked. */
  filename: string
  /** How many notes related to `filename` are not on the canvas. Always > 0. */
  hiddenCount: number
  /** False once pinning `filename` again would change nothing (see needsExpansion). */
  expandable: boolean
  onExpand: (filename: string) => void
}

export type HiddenRelationsFlowNode = Node<HiddenRelationsNodeData, 'hiddenRelations'>

// Memoized like NoteNode: while a note is dragged React Flow re-renders every
// node on each frame, but this one's `data` keeps its identity.
function HiddenRelationsNode({ data }: NodeProps<HiddenRelationsFlowNode>): React.JSX.Element {
  return (
    <>
      {/*
        Only there so React Flow can resolve an end for the parent -> badge edge (it
        refuses to render an edge whose endpoint has no handle; FloatingEdge
        recomputes the actual path from the node rects). Never a connection target:
        see connectionTargetFilename, which maps a drop on a badge to its note.
      */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="opacity-0 pointer-events-none"
      />
      {/*
        React Flow gives a node wrapper `pointer-events: none` unless the node is
        selectable/draggable, and this kind is neither - so the button opts back in.
      */}
      <button
        type="button"
        className="nodrag nopan btn btn-xs btn-soft rounded-full pointer-events-auto"
        disabled={!data.expandable}
        aria-label={`${data.hiddenCount} hidden related notes`}
        onClick={() => data.onExpand(data.filename)}
      >
        {data.hiddenCount}
      </button>
    </>
  )
}

export default memo(HiddenRelationsNode)
