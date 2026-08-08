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
        'note-card',
        'rounded-[24px] border px-5 py-4 text-left shadow-[0_22px_50px_rgba(123,94,74,0.12)]',
        pinDepth !== null ? 'note-card-center border-[#d36945]' : 'border-[#eadbc9]',
        isAnchor ? 'border-dashed' : '',
        'bg-[rgba(255,251,246,0.96)]'
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
            className="btn btn-ghost btn-xs rounded-full text-[#7c5b48] hover:bg-[#f3e8da]"
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
            className="btn btn-ghost btn-xs rounded-full text-[#7c5b48] hover:bg-[#fbdede] hover:text-[#b3462c] disabled:opacity-50"
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

      {error ? <p className="mb-2 text-xs text-[#b3462c]">{error}</p> : null}

      {note.image ? (
        <img src={`media://${note.image}`} alt="" className="mb-3 h-auto w-full rounded-[14px]" />
      ) : null}

      <div className="note-markdown text-[#352921]">
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
          <p className="italic text-[#8b6f5d]">Empty note</p>
        )}
      </div>

      {note.notes.length > 0 ? (
        <div className="mt-3 space-y-2">
          {note.notes.map((entry, index) => (
            <div
              key={index}
              className="flex items-start justify-between gap-2 rounded-[14px] border border-[#f0b8a8] bg-[#fdeae4] px-3 py-2 text-sm text-[#7c2f1c]"
            >
              <p className="whitespace-pre-wrap">{entry}</p>
              <button
                type="button"
                className="btn btn-ghost btn-xs shrink-0 rounded-full text-[#7c2f1c] hover:bg-[#f8d4c8]"
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
