import { X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function ExtraContentModal({
  value,
  onSave,
  onClose
}: {
  value: string
  onSave: (extraContent: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSave(text.trim())
      onClose()
    } catch (saveError) {
      setError((saveError as Error).message)
      setSaving(false)
    }
  }

  // Portaled to <body> - this node lives inside a React Flow node, which is
  // positioned via CSS transform, and a `position: fixed` descendant of a
  // transformed ancestor is contained by that ancestor instead of the viewport.
  return createPortal(
    <div className="modal modal-open">
      <div className="modal-box">
        <button
          type="button"
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Extra content</legend>
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Longer-form content for this note…"
            className="textarea h-64 w-full"
          />
        </fieldset>

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </div>,
    document.body
  )
}
