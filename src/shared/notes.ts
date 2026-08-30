export type NoteRelationTuple = [label: string, target: string]

export interface RawNoteFile {
  body?: string
  rels?: NoteRelationTuple[]
  /**
   * Long-form content for this note. Shared verbatim with the sibling `../note`
   * app, which owns this key. An attached image is NOT referenced here - it is a
   * loose file in the graph folder's `images/` subdirectory, matched to this note
   * by filename stem (see NoteStore.imagesByStem).
   */
  extra?: string
  /** Freeform comments/to-dos attached to this note, rendered on the node itself. */
  notes?: string[]
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
  rels: NoteLink[]
  degree: number
  /** Filename (inside the graph folder's `images/` subdirectory) of the image matched to this note by stem, or null. */
  image: string | null
  extraContent: string
  /** Whitespace-compacted extra content, the extra-content counterpart to bodyCompact (search now scans this too). */
  extraCompact: string
  notes: string[]
}

export interface PinSpec {
  filename: string
  depth: number
}

export interface GraphNodePayload {
  filename: string
  body: string
  image: string | null
  extraContent: string
  /** Hops from the nearest pin that discovered this node. Informational only. */
  depth: number
  degree: number
  notes: string[]
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
  preview: string
  score: number
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
  islandCount: number
  orphanCount: number
  lastIndexedAt: string
}

export interface StatsSample {
  capturedAt: string
  noteCount: number
  relationCount: number
  islandCount: number
  orphanCount: number
}

export interface DailyStatsSnapshot {
  date: string
  first: StatsSample
  last: StatsSample
}

export interface StatsResponse {
  current: IndexStats
  history: DailyStatsSnapshot[]
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
  /** Full desired extra content - empty string removes the `extra` key. Always sent (unlike a PATCH-style partial). */
  extraContent: string
}

export interface AttachImageRequest {
  /** The note the image is being attached to (its .json filename). */
  filename: string
  /** A data: URL, e.g. "data:image/webp;base64,...". */
  dataUrl: string
}

export interface AttachImageResponse {
  /** Filename the image was written under inside the graph folder's images/ subdirectory. */
  image: string
}

export interface ClearImageRequest {
  /** The note whose attached image should be removed (its .json filename). */
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

export interface DeleteNoteEntryRequest {
  filename: string
  /** Index into that note's `notes` array of the entry to remove. */
  index: number
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
  /** Records today's first/last modal-open sample and returns the graph's timeline. */
  openStats: () => Promise<StatsResponse>
  createNote: (request: CreateNoteRequest) => Promise<CreateNoteResponse>
  deleteNote: (request: DeleteNoteRequest) => Promise<void>
  updateNote: (request: UpdateNoteRequest) => Promise<void>
  attachImage: (request: AttachImageRequest) => Promise<AttachImageResponse>
  clearImage: (request: ClearImageRequest) => Promise<void>
  connectNotes: (request: ConnectNotesRequest) => Promise<ConnectNotesResponse>
  updateRelationLabel: (request: UpdateRelationRequest) => Promise<void>
  deleteRelation: (request: DeleteRelationRequest) => Promise<void>
  randomOrphan: (request: RandomOrphanRequest) => Promise<RandomOrphanResponse>
  deleteNoteEntry: (request: DeleteNoteEntryRequest) => Promise<void>
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
