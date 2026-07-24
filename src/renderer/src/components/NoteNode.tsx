import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import DraftNoteCard from './DraftNoteCard'
import NoteCard from './NoteCard'
import type { GraphNodePayload } from '../../../shared/notes'

export type NoteNodeData =
  | {
      kind: 'note'
      note: GraphNodePayload
      /** How many hops of relations to render from this note, or null if it isn't pinned. */
      pinDepth: number | null
      onDelete: (filename: string) => Promise<void>
      onPin: (filename: string) => void
      onUnpin: (filename: string) => void
      onChangeDepth: (filename: string, nextDepth: number) => void
    }
  | {
      kind: 'draft'
      /** Whether to show the relation-label/reverse fields - false for a freestanding note with no related note. */
      showRelation: boolean
      onSave: (body: string, label: string, reverse: boolean) => Promise<void>
      onCancel: () => void
    }

export type NoteFlowNode = Node<NoteNodeData, 'note'>

const CONNECT_HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left]

export default function NoteNode({ data }: NodeProps<NoteFlowNode>): React.JSX.Element {
  return (
    <>
      {/*
        A single target handle, centered over the whole node and given a generous
        connectionRadius (see GraphCanvas) so any drop point on the card resolves to
        it. Two jobs: (1) lets React Flow resolve *some* handle for edges pointing at
        this node - FloatingEdge recomputes the actual path from the node rect anyway,
        so the handle's position doesn't matter for rendering, but its absence means
        edges into a source-only node silently fail to render; (2) makes "drag from
        one note onto another" reliably detect the drop target via onConnectEnd's
        connectionState.toNode.
      */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
      />

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
        <NoteCard
          note={data.note}
          pinDepth={data.pinDepth}
          onDelete={data.onDelete}
          onPin={data.onPin}
          onUnpin={data.onUnpin}
          onChangeDepth={data.onChangeDepth}
        />
      ) : (
        <DraftNoteCard
          showRelation={data.showRelation}
          onSave={data.onSave}
          onCancel={data.onCancel}
        />
      )}
    </>
  )
}
