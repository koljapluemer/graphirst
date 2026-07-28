import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function AliasEditorModal({
  aliases,
  onSave,
  onClose
}: {
  aliases: string[]
  onSave: (aliases: string[]) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  // Always renders with one trailing empty row - typing into it appends a fresh
  // trailing row, so the list keeps growing without an explicit "add" action.
  const [rows, setRows] = useState<string[]>(aliases.length > 0 ? [...aliases, ''] : [''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (index: number, value: string): void => {
    setRows((prev) => {
      const next = [...prev]
      next[index] = value
      if (index === next.length - 1 && value.trim() !== '') {
        next.push('')
      }
      return next
    })
  }

  const handleRemove = (index: number): void => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0 || next[next.length - 1].trim() !== '') {
        next.push('')
      }
      return next
    })
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const cleaned = rows.map((row) => row.trim()).filter((row) => row.length > 0)
      await onSave(cleaned)
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
          <legend className="fieldset-legend">Aliases</legend>

          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                autoFocus={index === 0}
                value={row}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    onClose()
                  }
                }}
                placeholder="Alias"
                className="input input-sm w-full"
              />
              <button
                type="button"
                className={[
                  'btn btn-sm btn-circle btn-ghost text-error',
                  index === rows.length - 1 ? 'invisible' : ''
                ].join(' ')}
                onClick={() => handleRemove(index)}
                disabled={index === rows.length - 1}
                title="Remove alias"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
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
