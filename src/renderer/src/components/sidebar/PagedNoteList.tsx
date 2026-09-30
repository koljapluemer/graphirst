import { useEffect, useRef } from 'react'
import ListPager from './ListPager'
import { NOTE_LIST_PAGE_SIZE } from '../../../../shared/notes'

export interface PagedNoteListProps {
  page: number
  /** Items across all pages. */
  total: number
  loading: boolean
  onPageChange: (page: number) => void
  /** Shown when there is nothing to list; null shows nothing. */
  emptyMessage: string | null
  /** The current page's items. */
  children: React.ReactNode
}

/** Scrollable list body plus a pager below it, shared by the sidebar's note lists. */
export default function PagedNoteList({
  page,
  total,
  loading,
  onPageChange,
  emptyMessage,
  children
}: PagedNoteListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageCount = Math.ceil(total / NOTE_LIST_PAGE_SIZE)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page])

  // A refresh (note deleted, relation changed, ...) can shrink the list below the page being shown.
  useEffect(() => {
    if (!loading && pageCount > 0 && page >= pageCount) {
      onPageChange(pageCount - 1)
    }
  }, [loading, page, pageCount, onPageChange])

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {total === 0 && !loading && emptyMessage ? (
          <div className="px-2 py-2 text-sm text-base-content/60">{emptyMessage}</div>
        ) : null}

        <div className="space-y-2">{children}</div>
      </div>

      {pageCount > 1 ? (
        <div className="flex justify-center border-t border-base-300 px-4 py-2">
          <ListPager page={page} pageCount={pageCount} onPageChange={onPageChange} />
        </div>
      ) : null}
    </>
  )
}
