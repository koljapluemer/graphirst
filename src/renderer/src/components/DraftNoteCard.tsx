import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface DraftNoteCardProps {
  /** 'edit' reuses this same card to edit an existing note's body in place, in lieu of a separate dialog. */
  mode?: 'create' | 'edit'
  /** Body to prefill the textarea with - only meaningful in 'edit' mode. */
  initialBody?: string
  /** Whether to show the relation-label/reverse fields - false for a freestanding note with no related note. */
  showRelation: boolean
  onSave: (body: string, label: string, reverse: boolean) => Promise<void>
  onCancel: () => void
}

export default function DraftNoteCard({
  mode = 'create',
  initialBody = '',
  showRelation,
  onSave,
  onCancel
}: DraftNoteCardProps): React.JSX.Element {
  const [body, setBody] = useState(initialBody)
  const [label, setLabel] = useState('')
  const [reverse, setReverse] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSave = async (): Promise<void> => {
    if (!body.trim() || saving) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await onSave(body, label, reverse)
    } catch (saveError) {
      setError((saveError as Error).message)
      setSaving(false)
    }
  }

  return (
    <article className="note-card rounded-[24px] border border-dashed border-[#d6b49e] bg-[rgba(255,251,246,0.98)] px-5 py-4 text-left shadow-[0_22px_50px_rgba(123,94,74,0.12)]">
      <div className="note-drag-handle mb-3 flex cursor-grab items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#a3806a]">
          {mode === 'edit' ? 'Edit note' : 'New note'}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs nodrag rounded-full text-[#7c5b48] hover:bg-[#f3e8da]"
          onClick={onCancel}
          title="Discard"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className="note-textarea nodrag nowheel w-full resize-none rounded-[14px] border border-[#eadbc9] bg-white/70 px-3 py-2 text-sm leading-6 text-[#352921] outline-none focus:border-[#d6a17d]"
        placeholder="Write the note…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            onCancel()
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            void handleSave()
          }
        }}
      />

      {showRelation ? (
        <>
          <label className="nodrag mt-3 block text-xs text-[#6b5143]">
            <span className="mb-1 block text-[#8b6f5d]">Relation label</span>
            <input
              className="w-full rounded-[10px] border border-[#eadbc9] bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-[#d6a17d]"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="related"
            />
          </label>

          <label className="nodrag mt-2 flex items-center gap-2 text-xs text-[#6b5143]">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={reverse}
              onChange={(event) => setReverse(event.target.checked)}
            />
            Reverse direction
          </label>
        </>
      ) : null}

      {error ? <p className="mt-2 text-xs text-[#b3462c]">{error}</p> : null}

      <div className="nodrag mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-xs rounded-full" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-xs rounded-full border-[#d6b49e] bg-[#d86f49] text-white hover:bg-[#c8623d]"
          disabled={!body.trim() || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </article>
  )
}
