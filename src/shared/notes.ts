export type NoteRelationTuple = [label: string, target: string]

export interface RawNoteFile {
  body?: string
  rels?: NoteRelationTuple[]
  aliases?: string[]
}

export interface NoteLink {
  label: string
  target: string
}

export interface IndexedNote {
  filename: string
  body: string
  aliases: string[]
  rels: NoteLink[]
  degree: number
}

export type GraphDirection = 'center' | 'incoming' | 'outgoing' | 'mixed'

export interface GraphNodePayload {
  filename: string
  body: string
  aliases: string[]
  depth: number
  direction: GraphDirection
  degree: number
  missing?: boolean
}

export interface GraphEdgePayload {
  id: string
  source: string
  target: string
  label: string
  depth: number
  direction: 'incoming' | 'outgoing'
}

export interface NoteGraph {
  center: string
  nodes: GraphNodePayload[]
  edges: GraphEdgePayload[]
  truncated: boolean
  warnings: string[]
}

export interface SearchResult {
  filename: string
  aliases: string[]
  preview: string
  score: number
  match: 'alias' | 'body' | 'mixed'
}

export interface IndexStats {
  noteCount: number
  relationCount: number
  lastIndexedAt: string
}

export interface NotesBootstrap {
  graphPath: string
  status: 'ready' | 'missing-directory' | 'empty' | 'error'
  message?: string
  stats: IndexStats | null
  lastOpened?: string
}

export interface NotesSearchResponse {
  graphPath: string
  stats: IndexStats
  results: SearchResult[]
}

export interface NotesOpenResponse {
  graphPath: string
  stats: IndexStats
  graph: NoteGraph
}

export interface CreateNoteRequest {
  /** Filename (with extension) of the existing note the new note is being connected to. */
  relatedFilename: string
  /** Relation label. Falls back to a sensible default when blank. */
  label: string
  /** When false (default): relatedFilename -> newNote. When true: newNote -> relatedFilename. */
  reverse: boolean
  body: string
}

export interface CreateNoteResponse {
  filename: string
}

export interface NotesApi {
  getBootstrap: () => Promise<NotesBootstrap>
  search: (query: string) => Promise<NotesSearchResponse>
  openNote: (filename: string) => Promise<NotesOpenResponse>
  pickDirectory: () => Promise<NotesBootstrap>
  refresh: () => Promise<NotesBootstrap>
  createNote: (request: CreateNoteRequest) => Promise<CreateNoteResponse>
}
