export type NoteRelationTuple = [label: string, target: string]

export interface RawNoteFile {
  body?: string
  rels?: NoteRelationTuple[]
  aliases?: string[]
  /** Filename of an attached image inside the graph folder's media/ subdirectory. */
  image?: string
}

export interface NoteLink {
  label: string
  target: string
}

export interface IndexedNote {
  filename: string
  body: string
  /** Whitespace-compacted body, computed once at index time and reused by preview building and raw/regex search instead of recompacting per query. */
  bodyCompact: string
  aliases: string[]
  rels: NoteLink[]
  degree: number
  image: string | null
}

export interface PinSpec {
  filename: string
  depth: number
}

export interface GraphNodePayload {
  filename: string
  body: string
  image: string | null
  aliases: string[]
  /** Hops from the nearest pin that discovered this node. Informational only. */
  depth: number
  degree: number
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

/**
 * 'fuzzy' is the default FlexSearch-backed token search. 'raw' bypasses
 * tokenization entirely (literal, non-stripped substring matching) and
 * additionally treats a query wrapped in `/pattern/flags` as a regular
 * expression - see NoteStore.search.
 */
export type SearchMode = 'fuzzy' | 'raw'

export interface IndexStats {
  noteCount: number
  relationCount: number
  lastIndexedAt: string
}

/** Progress ticks emitted while rebuildIndex works through the note directory, so the UI can show a determinate count instead of an indefinite spinner. */
export interface IndexProgress {
  loaded: number
  total: number
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
  /** Filename of an image already written via saveImage(), or omit for none. */
  image?: string
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
  /** Full desired image state - null means "no image", always sent (unlike a PATCH-style partial). */
  image: string | null
  /** Full desired alias list, always sent (unlike a PATCH-style partial). */
  aliases: string[]
}

export interface SaveImageRequest {
  /** A data: URL, e.g. "data:image/webp;base64,...". */
  dataUrl: string
}

export interface SaveImageResponse {
  /** Filename the image was written under inside the graph folder's media/ subdirectory. */
  filename: string
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

export interface RandomOrphanRequest {
  /** Filenames to exclude from the pick, i.e. notes already open on the graph. */
  exclude: string[]
}

export interface RandomOrphanResponse {
  /** Null when no orphan note is available to pick. */
  filename: string | null
}

export interface UndoDeleteResponse {
  /** False when there was nothing pending to undo (already restored, or superseded by a later delete). */
  restored: boolean
}

export interface NotesApi {
  getBootstrap: () => Promise<NotesBootstrap>
  search: (query: string, mode?: SearchMode) => Promise<NotesSearchResponse>
  openGraph: (pins: PinSpec[]) => Promise<NotesGraphResponse>
  pickDirectory: () => Promise<NotesBootstrap>
  refresh: () => Promise<NotesBootstrap>
  createNote: (request: CreateNoteRequest) => Promise<CreateNoteResponse>
  deleteNote: (request: DeleteNoteRequest) => Promise<void>
  updateNote: (request: UpdateNoteRequest) => Promise<void>
  saveImage: (request: SaveImageRequest) => Promise<SaveImageResponse>
  connectNotes: (request: ConnectNotesRequest) => Promise<ConnectNotesResponse>
  updateRelationLabel: (request: UpdateRelationRequest) => Promise<void>
  deleteRelation: (request: DeleteRelationRequest) => Promise<void>
  randomOrphan: (request: RandomOrphanRequest) => Promise<RandomOrphanResponse>
  /** Restores whatever `deleteNote`/`deleteRelation` most recently removed. */
  undoDelete: () => Promise<UndoDeleteResponse>
  /**
   * Fires whenever the backend's note index is rebuilt - after any mutation
   * (create/update/delete/connect/relation change/undo) as well as manual
   * re-index and folder switches. This is the single signal every note-derived
   * view (graph, search, ...) should key its own refresh off of, rather than
   * each mutation call site remembering to poke every consumer individually.
   * Returns an unsubscribe function.
   */
  onChanged: (callback: () => void) => () => void
  /** Fires repeatedly while a note index rebuild is in progress. Returns an unsubscribe function. */
  onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
}
