import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PinControl from './PinControl'
import type { GraphNodePayload } from '../../../shared/notes'

export default function NoteCard({
  note,
  pinDepth,
  onDelete,
  onEdit,
  onPin,
  onUnpin,
  onChangeDepth
}: {
  note: GraphNodePayload
  pinDepth: number | null
  onDelete: (filename: string) => Promise<void>
  onEdit: (filename: string) => void
  onPin: (filename: string) => void
  onUnpin: (filename: string) => void
  onChangeDepth: (filename: string, nextDepth: number) => void
}): React.JSX.Element {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        'rounded-[24px] border px-5 py-4 text-left shadow-[0_22px_50px_rgba(123,94,74,0.12)] transition-transform duration-200',
        pinDepth !== null ? 'note-card-center border-[#d36945]' : 'border-[#eadbc9]',
        note.missing ? 'note-card-missing' : '',
        'bg-[rgba(255,251,246,0.96)]'
      ].join(' ')}
    >
      <div className="note-drag-handle mb-3 flex min-h-6 cursor-grab items-center justify-between">
        <PinControl
          pinDepth={pinDepth}
          onPin={() => onPin(note.filename)}
          onUnpin={() => onUnpin(note.filename)}
          onChangeDepth={(next) => onChangeDepth(note.filename, next)}
        />
        <div className="nodrag flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#f3e8da]"
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
            className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#fbdede] hover:text-[#b3462c] disabled:opacity-50"
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
    </article>
  )
}
