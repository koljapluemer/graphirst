import { ExternalLink, Pencil, Tags, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AliasEditorModal from './AliasEditorModal'
import PinControl from './PinControl'
import type { GraphNodePayload } from '../../../shared/notes'

export default function NoteCard({
  note,
  pinDepth,
  isAnchor,
  selected,
  onDelete,
  onEdit,
  onUpdateAliases,
  onPin,
  onUnpin,
  onChangeDepth,
  onDeleteNoteEntry
}: {
  note: GraphNodePayload
  pinDepth: number | null
  isAnchor: boolean
  /** Whether React Flow currently has this node selected - drives the highlight ring. */
  selected: boolean
  onDelete: (filename: string) => Promise<void>
  onEdit: (filename: string) => void
  onUpdateAliases: (
    filename: string,
    body: string,
    image: string | null,
    aliases: string[]
  ) => Promise<void>
  onPin: (filename: string) => void
  onUnpin: (filename: string) => void
  onChangeDepth: (filename: string, nextDepth: number) => void
  onDeleteNoteEntry: (filename: string, index: number) => Promise<void>
}): React.JSX.Element {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aliasModalOpen, setAliasModalOpen] = useState(false)

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    setError(null)

    try {
      await onDelete(note.filename)
    } catch (deleteError) {
      setError((deleteError as Error).message)
      setDeleting(false)
    }
  }

  return (
    <article
      className={[
        'note-card group-focus:ring-2 group-focus:ring-primary/40',
        'rounded-box border bg-base-100 px-5 py-4 text-left shadow-xl',
        pinDepth !== null ? 'border-primary' : 'border-base-300',
        isAnchor ? 'border-dashed' : '',
        selected ? 'ring-2 ring-primary/40' : ''
      ].join(' ')}
    >
      <div className="mb-3 flex min-h-6 items-center justify-between">
        <PinControl
          pinDepth={pinDepth}
          onPin={() => onPin(note.filename)}
          onUnpin={() => onUnpin(note.filename)}
          onChangeDepth={(next) => onChangeDepth(note.filename, next)}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-xs rounded-full"
            onClick={(event) => {
              event.stopPropagation()
              onEdit(note.filename)
            }}
            title="Edit this note"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs rounded-full"
            onClick={(event) => {
              event.stopPropagation()
              setAliasModalOpen(true)
            }}
            title="Edit aliases"
          >
            <Tags className="size-3.5" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs rounded-full hover:bg-error/10 hover:text-error disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation()
              void handleDelete()
            }}
            disabled={deleting}
            title="Delete this note"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {error ? <p className="mb-2 text-xs text-error">{error}</p> : null}

      {note.image ? (
        <img src={`media://${note.image}`} alt="" className="mb-3 h-auto w-full rounded-box" />
      ) : null}

      <div className="prose prose-sm max-w-none prose-code:before:content-none prose-code:after:content-none">
        {note.body.trim() ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  {children}
                  <ExternalLink className="size-3" />
                </a>
              )
            }}
          >
            {note.body}
          </ReactMarkdown>
        ) : (
          <p className="italic text-base-content/50">Empty note</p>
        )}
      </div>

      {note.notes.length > 0 ? (
        <div className="mt-3 space-y-2">
          {note.notes.map((entry, index) => (
            <div
              key={index}
              className="flex items-start justify-between gap-2 rounded-box border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
            >
              <p className="whitespace-pre-wrap">{entry}</p>
              <button
                type="button"
                className="btn btn-ghost btn-xs shrink-0 rounded-full text-accent hover:bg-accent/20"
                onClick={(event) => {
                  event.stopPropagation()
                  void onDeleteNoteEntry(note.filename, index)
                }}
                title="Delete this note"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {aliasModalOpen ? (
        <AliasEditorModal
          aliases={note.aliases}
          onSave={(aliases) => onUpdateAliases(note.filename, note.body, note.image, aliases)}
          onClose={() => setAliasModalOpen(false)}
        />
      ) : null}
    </article>
  )
}
