import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface ListPagerProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

export default function ListPager({
  page,
  pageCount,
  onPageChange
}: ListPagerProps): React.JSX.Element {
  return (
    <div className="join">
      <button
        type="button"
        className="join-item btn btn-xs"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="join-item btn btn-xs pointer-events-none tabular-nums">
        {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="join-item btn btn-xs"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}
