import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import DraftNoteCard from './DraftNoteCard'
import NoteCard from './NoteCard'
import type { GraphNodePayload } from '../../../shared/notes'

export type NoteNodeData =
  | {
      kind: 'note'
      note: GraphNodePayload
      onOpenNote: (filename: string) => void
    }
  | {
      kind: 'draft'
      onSave: (body: string, label: string, reverse: boolean) => Promise<void>
      onCancel: () => void
    }

export type NoteFlowNode = Node<NoteNodeData, 'note'>

const CONNECT_HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left]

export default function NoteNode({ data }: NodeProps<NoteFlowNode>): React.JSX.Element {
  return (
    <>
      {/*
        A single untyped target handle so React Flow can resolve *some* handle for
        edges pointing at this node - FloatingEdge recomputes the actual path from
        the node rect anyway, so its position doesn't matter. Without this, nodes
        with only source handles (below) can't be an edge target at all, and every
        edge into them silently fails to render.
      */}
      <Handle type="target" position={Position.Top} />

      {data.kind === 'note'
        ? CONNECT_HANDLE_POSITIONS.map((position) => (
            <Handle
              key={position}
              id={position}
              type="source"
              position={position}
              className="note-connect-handle"
            />
          ))
        : null}

      {data.kind === 'note' ? (
        <NoteCard note={data.note} onOpenNote={data.onOpenNote} />
      ) : (
        <DraftNoteCard onSave={data.onSave} onCancel={data.onCancel} />
      )}
    </>
  )
}
