import { X } from 'lucide-react'
import { useEffect } from 'react'

export interface SearchHelpModalProps {
  onClose: () => void
}

const EXAMPLES = [
  ['words', 'all words (fuzzy)'],
  ['"exact phrase"', 'exact text'],
  ['word -draft', 'exclude'],
  ['one OR two', 'either expression'],
  ['one (two OR three)', 'group expressions'],
  ['/pattern/i', 'regular expression'],
  ['file:name', 'filename only'],
  ['body:word', 'body only'],
  ['extra:"phrase"', 'extra content only'],
  ['content:(one -two)', 'body or extra']
] as const

export default function SearchHelpModal({ onClose }: SearchHelpModalProps): React.JSX.Element {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-help-title"
    >
      <div className="modal-box max-w-sm p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="search-help-title" className="text-base font-semibold">
            Search syntax
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={onClose}
            aria-label="Close search help"
          >
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
          {EXAMPLES.map(([query, meaning]) => (
            <div key={query} className="contents">
              <dt>
                <code className="rounded bg-base-200 px-1.5 py-0.5">{query}</code>
              </dt>
              <dd className="text-base-content/70">{meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        aria-label="Close search help"
      />
    </div>
  )
}
