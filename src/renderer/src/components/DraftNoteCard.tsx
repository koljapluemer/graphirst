import { ImageOff, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { compressImage } from '../lib/compress-image'
import { mediaUrl } from '../lib/media'

/**
 * One attached image, one per note. `existing` carries the filename already on
 * disk (unchanged); `new` carries freshly pasted, compressed bytes not yet
 * written; `null` means "no image" (a removal, in edit mode). Persisting it is
 * the save handler's job - this card only tracks the intent.
 */
export type ImageState =
  { status: 'existing'; filename: string } | { status: 'new'; dataUrl: string } | null

export interface DraftNoteCardProps {
  /** 'edit' reuses this same card to edit an existing note's body in place, in lieu of a separate dialog. */
  mode?: 'create' | 'edit'
  /** Body to prefill the textarea with - only meaningful in 'edit' mode. */
  initialBody?: string
  /** Filename of the note's existing attached image, if any - only meaningful in 'edit' mode. */
  initialImage?: string | null
  /** Whether to show the relation-label/reverse fields - false for a freestanding note with no related note. */
  showRelation: boolean
  onSave: (body: string, label: string, reverse: boolean, image: ImageState) => Promise<void>
  onCancel: () => void
}

export default function DraftNoteCard({
  mode = 'create',
  initialBody = '',
  initialImage = null,
  showRelation,
  onSave,
  onCancel
}: DraftNoteCardProps): React.JSX.Element {
  const [body, setBody] = useState(initialBody)
  const [label, setLabel] = useState('')
  const [reverse, setReverse] = useState(false)
  const [image, setImage] = useState<ImageState>(
    initialImage ? { status: 'existing', filename: initialImage } : null
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Deferred a frame: this card can mount mid-drag (dropping a connection onto
    // empty canvas), and React Flow's own pointerup/connection-end handling is
    // still settling focus at that point - focusing synchronously on mount loses
    // that race and the pane keeps focus instead of this textarea.
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleFieldEscape = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      onCancel()
    }
  }

  const handlePaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith('image/')
    )
    if (!file) {
      return
    }

    event.preventDefault()
    try {
      const compressed = await compressImage(file)
      setImage({ status: 'new', dataUrl: compressed.dataUrl })
    } catch (pasteError) {
      setError((pasteError as Error).message)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!body.trim() || saving) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await onSave(body, label, reverse, image)
    } catch (saveError) {
      setError((saveError as Error).message)
      setSaving(false)
    }
  }

  const imagePreviewSrc =
    image?.status === 'existing' ? mediaUrl(image.filename) : (image?.dataUrl ?? null)

  return (
    <article className="note-card group-focus:ring-2 group-focus:ring-primary/40 rounded-box border border-dashed border-primary/50 bg-base-100 px-5 py-4 text-left shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
          {mode === 'edit' ? 'Edit note' : 'New note'}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs rounded-full"
          onClick={onCancel}
          title="Discard"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {imagePreviewSrc ? (
        <div className="nodrag relative mb-3">
          <img src={imagePreviewSrc} alt="" className="h-auto w-full rounded-box" />
          <button
            type="button"
            className="btn btn-ghost btn-xs absolute right-1.5 top-1.5 rounded-full bg-base-100/90 hover:bg-error/10 hover:text-error"
            onClick={() => setImage(null)}
            title="Remove image"
          >
            <ImageOff className="size-3.5" />
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="note-textarea textarea nodrag nowheel min-h-36 w-full resize-none text-sm leading-6 focus:border-primary/60"
        placeholder="Write the note… (paste an image to attach it)"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={(event) => void handlePaste(event)}
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
          <label className="nodrag mt-3 block text-xs text-base-content/70">
            <span className="mb-1 block text-base-content/50">Relation label</span>
            <input
              className="input input-sm w-full focus:border-primary/60"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={handleFieldEscape}
              placeholder="related"
            />
          </label>

          <label className="nodrag mt-2 flex items-center gap-2 text-xs text-base-content/70">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={reverse}
              onChange={(event) => setReverse(event.target.checked)}
              onKeyDown={handleFieldEscape}
            />
            Reverse direction
          </label>
        </>
      ) : null}

      {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}

      <div className="nodrag mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-xs rounded-full" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-xs rounded-full"
          disabled={!body.trim() || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </article>
  )
}
