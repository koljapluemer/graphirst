import { Crosshair, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { GraphNodePayload } from '../../../shared/notes'

export default function NoteCard({
  note,
  onOpenNote
}: {
  note: GraphNodePayload
  onOpenNote: (filename: string) => void
}): React.JSX.Element {
  return (
    <article
      className={[
        'note-card',
        'rounded-[24px] border px-5 py-4 text-left shadow-[0_22px_50px_rgba(123,94,74,0.12)] transition-transform duration-200',
        note.direction === 'center' ? 'note-card-center border-[#d36945]' : 'border-[#eadbc9]',
        note.missing ? 'note-card-missing' : '',
        'bg-[rgba(255,251,246,0.96)]'
      ].join(' ')}
    >
      <div className="note-drag-handle mb-3 flex cursor-grab justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#f3e8da]"
          onClick={(event) => {
            event.stopPropagation()
            onOpenNote(note.filename)
          }}
          title="Center this note"
        >
          <Crosshair className="size-3.5" />
        </button>
      </div>

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
