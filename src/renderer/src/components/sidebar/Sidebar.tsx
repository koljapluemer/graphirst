import { useReducer } from 'react'
import RecentTab from './RecentTab'
import SearchTab, { type SearchTabProps } from './SearchTab'
import { INITIAL_SIDEBAR_STATE, sidebarReducer, type SidebarTab } from './sidebar-state'

const TABS: { tab: SidebarTab; label: string }[] = [
  { tab: 'search', label: 'Search' },
  { tab: 'recent', label: 'Recent' }
]

export interface SidebarProps {
  search: Omit<SearchTabProps, 'pins' | 'onSelectNote'>
  pins: ReadonlyMap<string, number>
  onSelectNote: (filename: string) => void
  onError: (error: Error) => void
}

export default function Sidebar({
  search,
  pins,
  onSelectNote,
  onError
}: SidebarProps): React.JSX.Element {
  const [state, dispatch] = useReducer(sidebarReducer, INITIAL_SIDEBAR_STATE)

  return (
    <aside className="flex min-h-0 flex-col border border-base-300 bg-base-100/90 shadow-xl backdrop-blur">
      <div role="tablist" className="tabs tabs-border">
        {TABS.map(({ tab, label }) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.tab === tab}
            className={['tab flex-1', state.tab === tab ? 'tab-active' : ''].join(' ')}
            onClick={() => dispatch({ type: 'SELECT_TAB', tab })}
          >
            {label}
          </button>
        ))}
      </div>

      {state.tab === 'search' ? (
        <SearchTab {...search} pins={pins} onSelectNote={onSelectNote} />
      ) : (
        <RecentTab
          sort={state.recentSort}
          onSortChange={(sort) => dispatch({ type: 'SELECT_RECENT_SORT', sort })}
          pins={pins}
          onSelectNote={onSelectNote}
          onError={onError}
        />
      )}
    </aside>
  )
}
