import type { OrphanFilter, SearchCriteria, SearchMode } from '../../../../shared/notes'

/** Owned by App rather than the sidebar: the toolbar acts on the same search. */
export interface SearchState {
  criteria: SearchCriteria
  page: number
}

export type SearchEvent =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_MODE'; mode: SearchMode }
  | { type: 'SET_ORPHAN'; orphan: OrphanFilter }
  | { type: 'SET_PAGE'; page: number }

export const INITIAL_SEARCH_STATE: SearchState = {
  criteria: { query: '', mode: 'fuzzy', orphan: 'any' },
  page: 0
}

/** Any change to what is searched for starts back on the first page. */
export function searchReducer(state: SearchState, event: SearchEvent): SearchState {
  switch (event.type) {
    case 'SET_QUERY':
      return { criteria: { ...state.criteria, query: event.query }, page: 0 }
    case 'SET_MODE':
      return { criteria: { ...state.criteria, mode: event.mode }, page: 0 }
    case 'SET_ORPHAN':
      return { criteria: { ...state.criteria, orphan: event.orphan }, page: 0 }
    case 'SET_PAGE':
      return { ...state, page: event.page }
  }
}
