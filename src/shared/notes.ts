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

export interface PinSpec {
  filename: string
  depth: number
}

export interface GraphNodePayload {
  filename: string
  body: string
  aliases: string[]
  /** Hops from the nearest pin that discovered this node. Informational only. */
  depth: number
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
  pins?: PinSpec[]
}

export interface NotesSearchResponse {
  graphPath: string
  stats: IndexStats
  results: SearchResult[]
}

export interface NotesGraphResponse {
  graphPath: string
  stats: IndexStats
  graph: NoteGraph
}

export interface CreateNoteRequest {
  /** Filename (with extension) of the existing note the new note is being connected to. Omit to create a freestanding, unconnected note. */
  relatedFilename?: string
  /** Relation label. Falls back to a sensible default when blank. Ignored when relatedFilename is omitted. */
  label?: string
  /** When false (default): relatedFilename -> newNote. When true: newNote -> relatedFilename. */
  reverse?: boolean
  body: string
}

export interface CreateNoteResponse {
  filename: string
  /** The relation label actually written to disk, present whenever relatedFilename was given. */
  label?: string
}

export interface DeleteNoteRequest {
  filename: string
}

export interface UpdateNoteRequest {
  filename: string
  body: string
}

export interface ConnectNotesRequest {
  source: string
  target: string
  label: string
}

export interface ConnectNotesResponse {
  /** The relation label actually written to disk (falls back to a default when blank). */
  label: string
}

export interface UpdateRelationRequest {
  source: string
  target: string
  label: string
  nextLabel: string
}

export interface DeleteRelationRequest {
  source: string
  target: string
  label: string
}

export interface NotesApi {
  getBootstrap: () => Promise<NotesBootstrap>
  search: (query: string) => Promise<NotesSearchResponse>
  openGraph: (pins: PinSpec[]) => Promise<NotesGraphResponse>
  pickDirectory: () => Promise<NotesBootstrap>
  refresh: () => Promise<NotesBootstrap>
  createNote: (request: CreateNoteRequest) => Promise<CreateNoteResponse>
  deleteNote: (request: DeleteNoteRequest) => Promise<void>
  updateNote: (request: UpdateNoteRequest) => Promise<void>
  connectNotes: (request: ConnectNotesRequest) => Promise<ConnectNotesResponse>
  updateRelationLabel: (request: UpdateRelationRequest) => Promise<void>
  deleteRelation: (request: DeleteRelationRequest) => Promise<void>
}
