import { Clipboard, Copy, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import MediaPreview from './MediaPreview'
import { imageUrlToPngDataUrl, mediaUrl } from '../lib/media'
import { isVideoFilename } from '../../../shared/media'

export default function MediaModal({
  filename,
  noteFilename,
  onClose
}: {
  filename: string
  noteFilename: string
  onClose: () => void
}): React.JSX.Element {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isVideo = isVideoFilename(filename)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      setError((operationError as Error).message)
    }
  }

  const deleteMedia = async (): Promise<void> => {
    setDeleting(true)
    await run(async () => {
      await window.api.notes.clearImage({ filename: noteFilename })
      onClose()
    })
    setDeleting(false)
  }

  const copyImage = async (): Promise<void> => {
    const sourceDataUrl = await window.api.notes.getMediaDataUrl({ image: filename })
    const pngDataUrl = await imageUrlToPngDataUrl(sourceDataUrl)
    await window.api.notes.copyMedia({ pngDataUrl })
  }

  return createPortal(
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="Media preview">
      <div className="modal-box flex h-[90vh] w-11/12 max-w-6xl flex-col p-4">
        <div className="mb-3 flex shrink-0 items-center justify-end gap-1">
          {!isVideo ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void run(copyImage)}
            >
              <Clipboard className="size-4" /> Copy
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void run(() => window.api.notes.copyMediaPath({ image: filename }))}
          >
            <Copy className="size-4" /> Copy Path
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-error hover:bg-error/10"
            disabled={deleting}
            onClick={() => void deleteMedia()}
          >
            <Trash2 className="size-4" /> Delete Media
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X className="size-4" /> Close
          </button>
        </div>

        {error ? <p className="mb-2 shrink-0 text-sm text-error">{error}</p> : null}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-base-200">
          <MediaPreview
            src={mediaUrl(filename)}
            kind={isVideo ? 'video' : 'image'}
            className="max-h-full max-w-full object-contain"
          />
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
