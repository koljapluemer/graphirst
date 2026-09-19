import type { RecentNotesSort } from '../../../../shared/notes'

export type SidebarTab = 'search' | 'recent'

/**
 * `recentSort` sits beside `tab` rather than inside a per-tab variant so the chosen
 * sort survives a trip to the search tab and back.
 */
export interface SidebarState {
  tab: SidebarTab
  recentSort: RecentNotesSort
}

export type SidebarEvent =
  { type: 'SELECT_TAB'; tab: SidebarTab } | { type: 'SELECT_RECENT_SORT'; sort: RecentNotesSort }

export const INITIAL_SIDEBAR_STATE: SidebarState = { tab: 'search', recentSort: 'opened' }

export function sidebarReducer(state: SidebarState, event: SidebarEvent): SidebarState {
  switch (event.type) {
    case 'SELECT_TAB':
      return { ...state, tab: event.tab }
    case 'SELECT_RECENT_SORT':
      return { ...state, recentSort: event.sort }
  }
}
