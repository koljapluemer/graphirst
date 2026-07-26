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
      /** Whether this note is the current session's soft anchor for placing new notes. */
      isAnchor: boolean
      onDelete: (filename: string) => Promise<void>
      onEdit: (filename: string) => void
      onPin: (filename: string) => void
      onUnpin: (filename: string) => void
      onChangeDepth: (filename: string, nextDepth: number) => void
    }
  | {
      kind: 'draft'
      /** Whether to show the relation-label/reverse fields - false for a freestanding note with no related note. */
      showRelation: boolean
      onSave: (body: string, label: string, reverse: boolean, image: string | null) => Promise<void>
      onCancel: () => void
    }
  | {
      kind: 'edit'
      initialBody: string
      initialImage: string | null
      onSave: (body: string, image: string | null) => Promise<void>
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

      {/*
        Always mounted, regardless of kind - React Flow derives edge geometry from
        handle bounds even for a custom edge type that recomputes its own path
        (see FloatingEdge/getEdgeParams), so unmounting these while editing/drafting
        would drop that node's outgoing edges. Hide non-'note' kinds visually via the
        base .react-flow__handle rule (opacity:0, pointer-events:none) instead of
        removing them from the DOM - see https://reactflow.dev/learn/customization/handles.
      */}
      {CONNECT_HANDLE_POSITIONS.map((position) => (
        <Handle
          key={position}
          id={position}
          type="source"
          position={position}
          className={data.kind === 'note' ? 'note-connect-handle' : undefined}
        />
      ))}

      {data.kind === 'note' ? (
        <NoteCard
          note={data.note}
          pinDepth={data.pinDepth}
          isAnchor={data.isAnchor}
          onDelete={data.onDelete}
          onEdit={data.onEdit}
          onPin={data.onPin}
          onUnpin={data.onUnpin}
          onChangeDepth={data.onChangeDepth}
        />
      ) : data.kind === 'edit' ? (
        <DraftNoteCard
          mode="edit"
          initialBody={data.initialBody}
          initialImage={data.initialImage}
          showRelation={false}
          onSave={(body, _label, _reverse, image) => data.onSave(body, image)}
          onCancel={data.onCancel}
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
