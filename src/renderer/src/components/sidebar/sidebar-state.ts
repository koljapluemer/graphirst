import type { RecentNotesSort } from '../../../../shared/notes'

export type SidebarTab = 'search' | 'recent'

/**
 * `recentSort` and `recentPage` sit beside `tab` rather than inside a per-tab variant
 * so they survive a trip to the search tab and back.
 */
export interface SidebarState {
  tab: SidebarTab
  recentSort: RecentNotesSort
  recentPage: number
}

export type SidebarEvent =
  | { type: 'SELECT_TAB'; tab: SidebarTab }
  | { type: 'SELECT_RECENT_SORT'; sort: RecentNotesSort }
  | { type: 'SET_RECENT_PAGE'; page: number }

export const INITIAL_SIDEBAR_STATE: SidebarState = {
  tab: 'search',
  recentSort: 'opened',
  recentPage: 0
}

export function sidebarReducer(state: SidebarState, event: SidebarEvent): SidebarState {
  switch (event.type) {
    case 'SELECT_TAB':
      return { ...state, tab: event.tab }
    case 'SELECT_RECENT_SORT':
      return { ...state, recentSort: event.sort, recentPage: 0 }
    case 'SET_RECENT_PAGE':
      return { ...state, recentPage: event.page }
  }
}
