import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Document } from 'flexsearch'
import type {
  AttachImageRequest,
  AttachImageResponse,
  ClearImageRequest,
  ConnectNotesRequest,
  ConnectNotesResponse,
  CreateNoteRequest,
  CreateNoteResponse,
  DeleteNoteEntryRequest,
  DeleteNoteRequest,
  DeleteRelationRequest,
  GraphEdgePayload,
  GraphNodePayload,
  IndexedNote,
  IndexProgress,
  IndexStats,
  NoteGraph,
  NoteLink,
  NoteRelationTuple,
  NotesBootstrap,
  NotesGraphResponse,
  NotesSearchResponse,
  PinSpec,
  RandomOrphanRequest,
  RandomOrphanResponse,
  RawNoteFile,
  SearchMode,
  SearchResult,
  StatsResponse,
  StatsSample,
  DailyStatsSnapshot,
  UndoDeleteResponse,
  UpdateNoteRequest,
  UpdateRelationRequest
} from '../shared/notes'
import type {
  RawSearchCorpusEntry,
  RawSearchMatch,
  RawSearchWorkerRequest,
  RawSearchWorkerResponse
} from './search-worker-types'

const DEFAULT_GRAPH_PATH = '/home/brokkoli/Sync/Graph'
const SETTINGS_FILE_NAME = 'graphirst-settings.json'
/**
 * Loose image files live here, matched to a note by filename stem
 * (`<noteStem>-<epochMillis><ext>`, newest timestamp wins) with no reference in
 * the note JSON. Same layout the sibling `../note` app uses, so an image
 * attached in either app shows in both.
 */
const IMAGES_DIR_NAME = 'images'
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
/** basename-without-extension of an image file: `<stem>-<digits>`. */
const IMAGE_STEM_PATTERN = /^(.+)-(\d+)$/
const MAX_SEARCH_RESULTS = 40
/**
 * Subtracted from the score of a result that matched only in a note's extra
 * content (nothing in the body). Large enough to sink every such result below
 * every body match, so they land at the tail of the same list without being
 * split out or labelled.
 */
const EXTRA_ONLY_RANK_PENALTY = 100_000
const MAX_DIRECT_RELATIONS = 28
const MAX_SECONDARY_RELATIONS = 12
const MAX_GRAPH_NODES = 140
/** Candidate cap for the raw/regex worker scan, mirroring the fuzzy path's FlexSearch `limit`. */
const RAW_SEARCH_CANDIDATE_LIMIT = 120
/** Defense in depth only - RE2 is linear-time, so this should never actually fire. */
const RAW_SEARCH_TIMEOUT_MS = 5000

interface StoredSettings {
  graphPath?: string
  pins?: PinSpec[]
  statsHistory?: Record<string, DailyStatsSnapshot[]>
}

interface SearchDocument extends Record<string, string> {
  id: string
  body: string
  extra: string
}

interface IncomingRelation {
  source: string
  label: string
}

interface NodeMeta {
  depth: number
  order: number
}

interface QueueItem {
  filename: string
  depth: number
  /** The depth budget of the pin that discovered this item - not a global constant. */
  maxDepth: number
}

interface RelationDraft {
  source: string
  target: string
  label: string
  direction: 'incoming' | 'outgoing'
}

interface PendingNoteImage {
  /** The exact `images/` filename to restore the bytes under on undo. */
  filename: string
  data: Buffer
}

/** The single most recent deletion, kept just long enough for the UI's undo popup to act on it. */
type PendingUndo =
  | { type: 'note'; filename: string; raw: string; image: PendingNoteImage | null }
  | { type: 'relation'; source: string; relation: NoteRelationTuple }

interface GraphBuildContext {
  nodes: Map<string, NodeMeta>
  edges: Map<string, GraphEdgePayload>
  queue: QueueItem[]
  skippedRelations: number
  skippedNodes: number
}

/** Emitted whenever the note index is rebuilt - the single "notes changed" signal (see NotesApi.onChanged). */
export const NOTES_CHANGED_EVENT = 'changed'
/** Emitted repeatedly while rebuildIndex works through the note directory (see NotesApi.onIndexProgress). */
export const NOTES_INDEX_PROGRESS_EVENT = 'index-progress'

export class NoteStore extends EventEmitter {
  private readonly settingsPath: string
  private graphPath = DEFAULT_GRAPH_PATH
  private lastPins: PinSpec[] = []
  private statsHistory: Record<string, DailyStatsSnapshot[]> = {}
  private notes = new Map<string, IndexedNote>()
  /** noteStem -> newest matching filename in `images/`, rebuilt from a single directory scan each index. */
  private imagesByStem = new Map<string, string>()
  private reverseRefs = new Map<string, IncomingRelation[]>()
  private searchIndex = this.createSearchIndex()
  private stats: IndexStats | null = null
  private status: NotesBootstrap['status'] = 'empty'
  private message?: string
  private hasIndexed = false
  private inFlightIndex: Promise<void> | null = null
  private pendingUndo: PendingUndo | null = null
  /** Resident copy mirrored into the raw-search worker on every reindex - see syncSearchWorker. */
  private rawSearchCorpus: RawSearchCorpusEntry[] = []
  private searchWorker: Worker
  private nextRawRequestId = 1
  private pendingRawRequests = new Map<
    number,
    {
      resolve: (matches: RawSearchMatch[]) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()

  constructor(settingsDir: string) {
    super()
    this.settingsPath = join(settingsDir, SETTINGS_FILE_NAME)
    this.searchWorker = this.spawnSearchWorker()
  }

  getCurrentPath(): string {
    return this.graphPath
  }

  async getBootstrap(): Promise<NotesBootstrap> {
    await this.ensureIndexed()
    return {
      graphPath: this.graphPath,
      status: this.status,
      message: this.message,
      stats: this.stats,
      pins: this.lastPins
    }
  }

  async setGraphPath(graphPath: string): Promise<NotesBootstrap> {
    this.graphPath = graphPath
    this.hasIndexed = false
    this.pendingUndo = null
    await this.persistSettings()
    await this.ensureIndexed(true)
    return this.getBootstrap()
  }

  async refresh(): Promise<NotesBootstrap> {
    await this.ensureIndexed(true)
    return this.getBootstrap()
  }

  async openStats(): Promise<StatsResponse> {
    await this.ensureIndexed()
    if (!this.stats) {
      throw new Error(this.message ?? 'The note index is not ready yet.')
    }

    const now = new Date()
    const sample: StatsSample = {
      capturedAt: now.toISOString(),
      noteCount: this.stats.noteCount,
      relationCount: this.stats.relationCount,
      islandCount: this.stats.islandCount,
      orphanCount: this.stats.orphanCount
    }
    const date = toLocalCalendarDate(now)
    const history = this.statsHistory[this.graphPath] ?? []
    const today = history.find((entry) => entry.date === date)

    if (today) {
      today.last = sample
    } else {
      history.push({ date, first: sample, last: sample })
      history.sort((left, right) => left.date.localeCompare(right.date))
    }
    this.statsHistory[this.graphPath] = history
    await this.persistSettings()

    return { current: this.stats, history }
  }

  async search(query: string, mode: SearchMode = 'fuzzy'): Promise<NotesSearchResponse> {
    await this.ensureIndexed()

    if (!this.stats) {
      throw new Error(this.message ?? 'The note index is not ready yet.')
    }

    const trimmed = query.trim()
    if (!trimmed) {
      return {
        graphPath: this.graphPath,
        stats: this.stats,
        results: []
      }
    }

    const ranked = mode === 'raw' ? await this.searchRaw(trimmed) : this.searchFuzzy(trimmed)

    return {
      graphPath: this.graphPath,
      stats: this.stats,
      results: ranked
    }
  }

  private searchFuzzy(trimmed: string): SearchResult[] {
    const rawResults = this.searchIndex.search(trimmed, {
      enrich: true,
      limit: 120,
      merge: true
    })

    return rawResults
      .map((entry, index) => this.rankSearchResult(entry.id, index, trimmed))
      .filter((result): result is SearchResult => result !== null)
      .sort(
        (left, right) => right.score - left.score || left.filename.localeCompare(right.filename)
      )
      .slice(0, MAX_SEARCH_RESULTS)
  }

  /**
   * Bypasses FlexSearch's tokenizer entirely - a query wrapped in
   * `/pattern/flags` is compiled as a linear-time RE2 regex (see parseRawQuery),
   * anything else is a literal, non-normalized substring match. Runs in a
   * worker thread against a corpus mirrored on every reindex, so this never
   * blocks the Electron main process (see spawnSearchWorker/syncSearchWorker).
   */
  private async searchRaw(trimmed: string): Promise<SearchResult[]> {
    const { pattern, isRegex, flags } = this.parseRawQuery(trimmed)
    const matches = await this.runRawSearch(pattern, isRegex, flags)

    return matches
      .map((match, index) => this.rankRawResult(match, index))
      .filter((result): result is SearchResult => result !== null)
      .sort(
        (left, right) => right.score - left.score || left.filename.localeCompare(right.filename)
      )
      .slice(0, MAX_SEARCH_RESULTS)
  }

  private parseRawQuery(trimmed: string): { pattern: string; isRegex: boolean; flags: string } {
    const delimited = /^\/(.+)\/([a-z]*)$/.exec(trimmed)
    if (delimited && /^[ims]*$/.test(delimited[2])) {
      return { pattern: delimited[1], isRegex: true, flags: delimited[2] }
    }
    return { pattern: trimmed, isRegex: false, flags: '' }
  }

  private runRawSearch(
    pattern: string,
    isRegex: boolean,
    flags: string
  ): Promise<RawSearchMatch[]> {
    return new Promise((resolve, reject) => {
      const requestId = this.nextRawRequestId++
      const timeout = setTimeout(() => {
        this.pendingRawRequests.delete(requestId)
        reject(new Error('Raw search timed out.'))
      }, RAW_SEARCH_TIMEOUT_MS)

      this.pendingRawRequests.set(requestId, { resolve, reject, timeout })

      const request: RawSearchWorkerRequest = {
        type: 'search',
        requestId,
        pattern,
        isRegex,
        flags,
        limit: RAW_SEARCH_CANDIDATE_LIMIT
      }
      this.searchWorker.postMessage(request)
    })
  }

  private spawnSearchWorker(): Worker {
    const worker = new Worker(join(__dirname, 'search-worker.js'))
    // Never let the worker's own liveness hold the Electron main process open.
    worker.unref()
    worker.on('message', (message: RawSearchWorkerResponse) => this.handleWorkerMessage(message))
    worker.on('error', (error: Error) => this.handleWorkerFailure(error))
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.handleWorkerFailure(new Error(`Search worker exited with code ${code}`))
      }
    })

    const sync: RawSearchWorkerRequest = { type: 'sync', corpus: this.rawSearchCorpus }
    worker.postMessage(sync)
    return worker
  }

  private syncSearchWorker(): void {
    const sync: RawSearchWorkerRequest = { type: 'sync', corpus: this.rawSearchCorpus }
    this.searchWorker.postMessage(sync)
  }

  private handleWorkerMessage(message: RawSearchWorkerResponse): void {
    const pending = this.pendingRawRequests.get(message.requestId)
    if (!pending) {
      return
    }

    this.pendingRawRequests.delete(message.requestId)
    clearTimeout(pending.timeout)

    if (message.type === 'error') {
      pending.reject(new Error(message.message))
    } else {
      pending.resolve(message.matches)
    }
  }

  /** A crashed/hung worker fails every request in flight, then gets replaced and resynced so the next raw search isn't left permanently broken. */
  private handleWorkerFailure(error: Error): void {
    for (const pending of this.pendingRawRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRawRequests.clear()
    this.searchWorker = this.spawnSearchWorker()
  }

  async openGraph(pins: PinSpec[]): Promise<NotesGraphResponse> {
    await this.ensureIndexed()

    if (!this.stats) {
      throw new Error(this.message ?? 'The note index is not ready yet.')
    }

    this.lastPins = pins
    await this.persistSettings()

    return {
      graphPath: this.graphPath,
      stats: this.stats,
      graph: this.buildGraph(pins)
    }
  }

  async createNote(request: CreateNoteRequest): Promise<CreateNoteResponse> {
    await this.ensureIndexed()

    if (request.relatedFilename && !this.notes.has(request.relatedFilename)) {
      throw new Error(`Could not find "${request.relatedFilename}" in ${this.graphPath}.`)
    }

    const filename = this.generateFilename()

    if (!request.relatedFilename) {
      await this.writeNoteFile(filename, { body: request.body, rels: [] })
      await this.ensureIndexed(true)
      return { filename }
    }

    const label = (request.label ?? '').trim() || 'related'

    if (request.reverse) {
      await this.writeNoteFile(filename, {
        body: request.body,
        rels: [[label, request.relatedFilename]]
      })
    } else {
      await this.writeNoteFile(filename, { body: request.body, rels: [] })
      await this.appendRelation(request.relatedFilename, [label, filename])
    }

    await this.ensureIndexed(true)

    return { filename, label }
  }

  async deleteNote(request: DeleteNoteRequest): Promise<void> {
    await this.ensureIndexed()

    const existing = this.notes.get(request.filename)
    if (!existing) {
      throw new Error(`Could not find "${request.filename}" in ${this.graphPath}.`)
    }

    const path = join(this.graphPath, request.filename)
    const raw = await readFile(path, 'utf8')

    // Kept in memory (not just deleted-and-forgotten) for the same reason the note's
    // own raw JSON is: `undoDelete` needs to be able to fully restore the note,
    // image included, without a permanently-broken image reference.
    let image: PendingNoteImage | null = null
    if (existing.image) {
      try {
        const data = await readFile(this.imageFilePath(existing.image))
        image = { filename: existing.image, data }
      } catch (error) {
        const maybeError = error as NodeJS.ErrnoException
        if (maybeError.code !== 'ENOENT') {
          throw error
        }
      }
      await this.deleteImageFiles(this.stemOf(request.filename))
    }

    await unlink(path)
    this.pendingUndo = { type: 'note', filename: request.filename, raw, image }
    await this.ensureIndexed(true)
  }

  async updateNote(request: UpdateNoteRequest): Promise<void> {
    await this.ensureIndexed()

    const existing = this.notes.get(request.filename)
    if (!existing) {
      throw new Error(`Could not find "${request.filename}" in ${this.graphPath}.`)
    }

    await this.mutateRawNote(request.filename, (parsed) => {
      parsed.body = request.body
      if (request.extraContent.trim().length > 0) {
        parsed.extra = request.extraContent
      } else {
        delete parsed.extra
      }
    })

    await this.ensureIndexed(true)
  }

  /**
   * Writes `dataUrl`'s bytes to `images/<noteStem>-<epochMillis><ext>`, replacing
   * any image already attached to that note. The note JSON is untouched - the
   * link is by filename stem (see `../note`).
   */
  async attachImage(request: AttachImageRequest): Promise<AttachImageResponse> {
    await this.ensureIndexed()

    if (!this.notes.has(request.filename)) {
      throw new Error(`Could not find "${request.filename}" in ${this.graphPath}.`)
    }

    const match = /^data:image\/(\w+);base64,(.+)$/.exec(request.dataUrl)
    if (!match) {
      throw new Error('Unsupported image data.')
    }

    const [, subtype, base64] = match
    const extension = subtype === 'jpeg' ? 'jpg' : subtype
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported image type: ${extension}.`)
    }

    const stem = this.stemOf(request.filename)
    await this.deleteImageFiles(stem)

    const image = `${stem}-${Date.now()}.${extension}`
    await mkdir(this.imagesDir(), { recursive: true })
    await writeFile(this.imageFilePath(image), Buffer.from(base64, 'base64'))

    await this.ensureIndexed(true)
    return { image }
  }

  /** Removes whatever image is attached to the note (its `images/` file[s]); no-op if none. */
  async clearImage(request: ClearImageRequest): Promise<void> {
    await this.ensureIndexed()

    if (!this.notes.has(request.filename)) {
      throw new Error(`Could not find "${request.filename}" in ${this.graphPath}.`)
    }

    await this.deleteImageFiles(this.stemOf(request.filename))
    await this.ensureIndexed(true)
  }

  async connectNotes(request: ConnectNotesRequest): Promise<ConnectNotesResponse> {
    await this.ensureIndexed()

    if (!this.notes.has(request.source)) {
      throw new Error(`Could not find "${request.source}" in ${this.graphPath}.`)
    }
    if (!this.notes.has(request.target)) {
      throw new Error(`Could not find "${request.target}" in ${this.graphPath}.`)
    }

    const label = request.label.trim() || 'related'
    await this.appendRelation(request.source, [label, request.target])
    await this.ensureIndexed(true)

    return { label }
  }

  async updateRelationLabel(request: UpdateRelationRequest): Promise<void> {
    await this.mutateRelations(request.source, (rels) => {
      const index = rels.findIndex(
        ([label, target]) => label === request.label && target === request.target
      )
      if (index === -1) {
        throw new Error(`Could not find that relationship in "${request.source}".`)
      }
      rels[index] = [request.nextLabel.trim() || request.label, request.target]
    })
    await this.ensureIndexed(true)
  }

  async deleteRelation(request: DeleteRelationRequest): Promise<void> {
    let removed: NoteRelationTuple | null = null

    await this.mutateRelations(request.source, (rels) => {
      const index = rels.findIndex(
        ([label, target]) => label === request.label && target === request.target
      )
      if (index === -1) {
        throw new Error(`Could not find that relationship in "${request.source}".`)
      }
      removed = rels[index]
      rels.splice(index, 1)
    })

    this.pendingUndo = { type: 'relation', source: request.source, relation: removed! }
    await this.ensureIndexed(true)
  }

  async undoDelete(): Promise<UndoDeleteResponse> {
    const pending = this.pendingUndo
    if (!pending) {
      return { restored: false }
    }

    this.pendingUndo = null

    if (pending.type === 'note') {
      await writeFile(join(this.graphPath, pending.filename), pending.raw, 'utf8')
      if (pending.image) {
        await mkdir(this.imagesDir(), { recursive: true })
        await writeFile(this.imageFilePath(pending.image.filename), pending.image.data)
      }
    } else {
      await this.appendRelation(pending.source, pending.relation)
    }

    await this.ensureIndexed(true)
    return { restored: true }
  }

  async randomOrphan(request: RandomOrphanRequest): Promise<RandomOrphanResponse> {
    await this.ensureIndexed()

    if (!this.stats) {
      throw new Error(this.message ?? 'The note index is not ready yet.')
    }

    const excluded = new Set(request.exclude)
    const candidates: string[] = []
    for (const note of this.notes.values()) {
      if (note.degree === 0 && !excluded.has(note.filename)) {
        candidates.push(note.filename)
      }
    }

    if (candidates.length === 0) {
      return { filename: null }
    }

    return { filename: candidates[Math.floor(Math.random() * candidates.length)] }
  }

  async deleteNoteEntry(request: DeleteNoteEntryRequest): Promise<void> {
    await this.ensureIndexed()

    const existing = this.notes.get(request.filename)
    if (!existing) {
      throw new Error(`Could not find "${request.filename}" in ${this.graphPath}.`)
    }

    await this.mutateRawNote(request.filename, (parsed) => {
      const notes = Array.isArray(parsed.notes) ? (parsed.notes as unknown[]) : []
      if (request.index < 0 || request.index >= notes.length) {
        throw new Error(`Note index ${request.index} out of range for "${request.filename}".`)
      }
      notes.splice(request.index, 1)
      if (notes.length > 0) {
        parsed.notes = notes
      } else {
        delete parsed.notes
      }
    })

    await this.ensureIndexed(true)
  }

  async loadSettings(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as StoredSettings

      if (typeof parsed.graphPath === 'string' && parsed.graphPath.trim()) {
        this.graphPath = parsed.graphPath
      }

      if (Array.isArray(parsed.pins)) {
        this.lastPins = parsed.pins.filter(
          (pin): pin is PinSpec =>
            typeof pin === 'object' &&
            pin !== null &&
            typeof pin.filename === 'string' &&
            pin.filename.trim().length > 0 &&
            typeof pin.depth === 'number' &&
            pin.depth >= 0
        )
      }

      if (parsed.statsHistory && typeof parsed.statsHistory === 'object') {
        this.statsHistory = parsed.statsHistory
      }
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException
      if (maybeError.code !== 'ENOENT') {
        console.warn('Failed to load settings:', error)
      }
    }
  }

  private async ensureIndexed(force = false): Promise<void> {
    if (force) {
      this.hasIndexed = false
    }

    if (this.hasIndexed) {
      return
    }

    if (!this.inFlightIndex) {
      this.inFlightIndex = this.rebuildIndex()
        .then(() => {
          this.emit(NOTES_CHANGED_EVENT)
        })
        .finally(() => {
          this.inFlightIndex = null
        })
    }

    await this.inFlightIndex
  }

  private async rebuildIndex(): Promise<void> {
    this.resetIndex()

    if (!existsSync(this.graphPath)) {
      this.status = 'missing-directory'
      this.message = `The graph folder does not exist: ${this.graphPath}`
      this.hasIndexed = true
      return
    }

    let dirEntries: string[]
    try {
      const entries = await readdir(this.graphPath, { withFileTypes: true })
      dirEntries = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right))
    } catch (error) {
      this.status = 'error'
      this.message = `Failed to read ${this.graphPath}: ${(error as Error).message}`
      this.hasIndexed = true
      return
    }

    if (dirEntries.length === 0) {
      this.status = 'empty'
      this.message = `No JSON note files were found in ${this.graphPath}.`
      this.stats = {
        noteCount: 0,
        relationCount: 0,
        islandCount: 0,
        orphanCount: 0,
        lastIndexedAt: new Date().toISOString()
      }
      this.hasIndexed = true
      return
    }

    // Populated before notes are read - readNoteFile resolves each note's image from here.
    await this.scanImages()

    const batchSize = 200
    const corpusEntries: RawSearchCorpusEntry[] = []

    this.emit(NOTES_INDEX_PROGRESS_EVENT, {
      loaded: 0,
      total: dirEntries.length
    } satisfies IndexProgress)

    for (let batchStart = 0; batchStart < dirEntries.length; batchStart += batchSize) {
      const batch = dirEntries.slice(batchStart, batchStart + batchSize)
      const parsedNotes = await Promise.all(batch.map((filename) => this.readNoteFile(filename)))

      for (const note of parsedNotes) {
        if (!note) {
          continue
        }

        this.notes.set(note.filename, note)

        const doc: SearchDocument = {
          id: note.filename,
          body: note.body,
          extra: note.extraContent
        }
        this.searchIndex.add(doc)

        // note.bodyCompact/extraCompact are already whitespace-compacted the same
        // way buildPreview expects, so match indices the worker returns line up
        // with the string rankRawResult/buildPreviewFromIndex actually slices.
        corpusEntries.push({
          filename: note.filename,
          body: note.bodyCompact,
          extra: note.extraCompact
        })
      }

      this.emit(NOTES_INDEX_PROGRESS_EVENT, {
        loaded: Math.min(batchStart + batchSize, dirEntries.length),
        total: dirEntries.length
      } satisfies IndexProgress)
    }

    this.rawSearchCorpus = corpusEntries
    this.syncSearchWorker()

    await this.repairDanglingRelations()

    for (const note of this.notes.values()) {
      for (const rel of note.rels) {
        const incoming = this.reverseRefs.get(rel.target) ?? []
        incoming.push({ source: note.filename, label: rel.label })
        this.reverseRefs.set(rel.target, incoming)
      }
    }

    for (const note of this.notes.values()) {
      const incomingCount = this.reverseRefs.get(note.filename)?.length ?? 0
      note.degree = note.rels.length + incomingCount
    }

    this.stats = {
      noteCount: this.notes.size,
      relationCount: Array.from(this.notes.values()).reduce(
        (sum, note) => sum + note.rels.length,
        0
      ),
      islandCount: this.countIslands(),
      orphanCount: Array.from(this.notes.values()).filter((note) => note.degree === 0).length,
      lastIndexedAt: new Date().toISOString()
    }
    this.status = 'ready'
    this.message = undefined
    this.hasIndexed = true
  }

  private async readNoteFile(filename: string): Promise<IndexedNote | null> {
    try {
      const raw = await readFile(join(this.graphPath, filename), 'utf8')
      const parsed = JSON.parse(raw) as RawNoteFile
      const body = typeof parsed.body === 'string' ? parsed.body : ''
      const rels = Array.isArray(parsed.rels)
        ? parsed.rels.flatMap((rel) => this.normalizeRelation(rel))
        : []
      const image = this.imagesByStem.get(this.stemOf(filename)) ?? null
      const extraContent = typeof parsed.extra === 'string' ? parsed.extra : ''
      const notes = Array.isArray(parsed.notes)
        ? parsed.notes.filter((entry): entry is string => typeof entry === 'string')
        : []

      return {
        filename,
        body,
        bodyCompact: body.replace(/\s+/g, ' ').trim(),
        rels,
        degree: rels.length,
        image,
        extraContent,
        extraCompact: extraContent.replace(/\s+/g, ' ').trim(),
        notes
      }
    } catch (error) {
      console.warn(`Skipping unreadable note ${filename}:`, error)
      return null
    }
  }

  private normalizeRelation(rel: unknown): NoteLink[] {
    if (!Array.isArray(rel) || rel.length < 2) {
      return []
    }

    const [label, target] = rel
    if (typeof label !== 'string' || typeof target !== 'string') {
      return []
    }

    return [{ label, target }]
  }

  /**
   * A relation can point at a target that no longer resolves to a real, non-empty
   * note - most often a note that was just deleted (still within its undo window),
   * or a note whose body was cleared out from under an existing relationship. Either
   * way it must never surface as a graph node/edge (see tckt/issues/do-not-show-broken-nodes.md).
   *
   * The two cases are handled differently on purpose:
   * - Missing target (deleted note): dropped from this in-memory pass only. Writing
   *   this removal back to disk would make `undoDelete` unable to fully restore the
   *   relationship if the delete is undone a moment later.
   * - Empty target (note exists but has no body): a durable state, not a race with an
   *   in-flight delete, so the relationship is actually stripped from the sender's
   *   file, matching the ticket's "auto-delete the relationship from sender note".
   */
  private async repairDanglingRelations(): Promise<void> {
    const writes: Promise<void>[] = []

    for (const note of this.notes.values()) {
      let relationToEmptyTarget = false
      const kept = note.rels.filter((rel) => {
        const target = this.notes.get(rel.target)
        if (!target) {
          return false
        }
        if (this.isEmptyBody(target)) {
          relationToEmptyTarget = true
          return false
        }
        return true
      })

      if (kept.length === note.rels.length) {
        continue
      }

      note.rels = kept
      if (relationToEmptyTarget) {
        writes.push(this.persistRelations(note.filename, kept))
      }
    }

    await Promise.all(writes)
  }

  private isEmptyBody(note: IndexedNote): boolean {
    return note.body.trim().length === 0
  }

  private async persistRelations(filename: string, rels: NoteLink[]): Promise<void> {
    await this.mutateRelations(filename, (raw) => {
      raw.length = 0
      raw.push(...rels.map((rel): NoteRelationTuple => [rel.label, rel.target]))
    })
  }

  private createSearchIndex(): Document<SearchDocument> {
    return new Document<SearchDocument>({
      tokenize: 'forward',
      context: {
        depth: 2,
        resolution: 8,
        bidirectional: true
      },
      document: {
        id: 'id',
        index: [
          { field: 'body', tokenize: 'forward', resolution: 6, context: true },
          { field: 'extra', tokenize: 'forward', resolution: 6, context: true }
        ]
      }
    })
  }

  /** Counts weakly connected components; a degree-zero orphan is a one-node island. */
  private countIslands(): number {
    const unvisited = new Set(this.notes.keys())
    let count = 0

    while (unvisited.size > 0) {
      count += 1
      const start = unvisited.values().next().value as string
      const pending = [start]
      unvisited.delete(start)

      while (pending.length > 0) {
        const filename = pending.pop() as string
        const note = this.notes.get(filename)
        const neighbors = [
          ...(note?.rels.map((relation) => relation.target) ?? []),
          ...(this.reverseRefs.get(filename)?.map((relation) => relation.source) ?? [])
        ]
        for (const neighbor of neighbors) {
          if (unvisited.delete(neighbor)) {
            pending.push(neighbor)
          }
        }
      }
    }

    return count
  }

  private resetIndex(): void {
    this.notes.clear()
    this.imagesByStem.clear()
    this.reverseRefs.clear()
    this.searchIndex = this.createSearchIndex()
    this.stats = null
    this.status = 'empty'
    this.message = undefined
    // Covers rebuildIndex's early-return paths (missing directory, read error,
    // empty folder) - the success path overwrites this with the real corpus
    // and syncs again once it's actually built.
    this.rawSearchCorpus = []
    this.syncSearchWorker()
  }

  private rankSearchResult(id: number | string, order: number, query: string): SearchResult | null {
    const note = this.notes.get(String(id))
    if (!note) {
      return null
    }

    const normalizedQuery = this.normalize(query)
    const queryTokens = this.tokenize(normalizedQuery)
    const body = this.normalize(note.body)
    const extra = this.normalize(note.extraContent)

    let score = 1000 - order * 5

    if (body.includes(normalizedQuery)) {
      score += 140
    }

    const haystacks = [body, extra]
    const matchingTokens = queryTokens.filter((token) =>
      haystacks.some((haystack) => haystack.includes(token))
    )
    score += matchingTokens.length * 35

    if (queryTokens.length > 1 && matchingTokens.length === queryTokens.length) {
      score += 120
    }

    score += Math.min(note.degree, 24)

    // A hit that lives only in the extra content still belongs in the same result
    // list, just after every body hit - sink it below them, and preview from the
    // extra text so the match is actually visible.
    const matchedInBody =
      body.includes(normalizedQuery) || queryTokens.some((token) => body.includes(token))
    const matchedInExtra =
      extra.includes(normalizedQuery) || queryTokens.some((token) => extra.includes(token))
    const extraOnly = matchedInExtra && !matchedInBody

    if (extraOnly) {
      score -= EXTRA_ONLY_RANK_PENALTY
    }

    return {
      filename: note.filename,
      preview: this.buildPreview(extraOnly ? note.extraCompact : note.bodyCompact, queryTokens),
      score
    }
  }

  private rankRawResult(match: RawSearchMatch, order: number): SearchResult | null {
    const note = this.notes.get(match.filename)
    if (!note) {
      return null
    }

    let score = 1000 - order * 5

    if (match.bodyIndex !== null) {
      score += 140
    }

    score += Math.min(note.degree, 24)

    // Matched only in the extra content - keep it in the same list but after every
    // body hit, and preview from the extra text where the match actually is.
    const extraOnly = match.bodyIndex === null && match.extraIndex !== null
    if (extraOnly) {
      score -= EXTRA_ONLY_RANK_PENALTY
    }

    return {
      filename: note.filename,
      preview: extraOnly
        ? this.buildPreviewFromIndex(note.extraCompact, match.extraIndex)
        : this.buildPreviewFromIndex(note.bodyCompact, match.bodyIndex),
      score
    }
  }

  private buildPreview(compact: string, queryTokens: string[]): string {
    if (!compact) {
      return 'Empty note'
    }

    const normalizedBody = this.normalize(compact)
    const matchIndex = queryTokens.reduce<number>((closest, token) => {
      const index = normalizedBody.indexOf(token)
      if (index === -1) {
        return closest
      }
      if (closest === -1) {
        return index
      }
      return Math.min(closest, index)
    }, -1)

    return this.slicePreviewAroundIndex(compact, matchIndex)
  }

  /** Preview building for raw/regex matches, which already know the exact match position rather than needing to search for a token. */
  private buildPreviewFromIndex(compact: string, matchIndex: number | null): string {
    if (!compact) {
      return 'Empty note'
    }

    return this.slicePreviewAroundIndex(compact, matchIndex ?? -1)
  }

  private slicePreviewAroundIndex(compact: string, matchIndex: number): string {
    if (matchIndex === -1) {
      return compact.slice(0, 180)
    }

    const start = Math.max(0, matchIndex - 70)
    const end = Math.min(compact.length, matchIndex + 110)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < compact.length ? '…' : ''
    return `${prefix}${compact.slice(start, end)}${suffix}`
  }

  /**
   * Multi-root BFS union: every pin is seeded (root + first-level expansion) before
   * the shared FIFO queue is drained, so the queue processes strictly in
   * non-decreasing hop-distance order across *all* pins simultaneously. That means
   * when MAX_GRAPH_NODES is hit, the nodes dropped are the globally-farthest ones
   * across the whole pin set, not just the tail of whichever pin was listed last.
   */
  private buildGraph(pins: PinSpec[]): NoteGraph {
    if (pins.length === 0) {
      return { nodes: [], edges: [], truncated: false, warnings: [] }
    }

    const context = this.createBuildContext()
    for (const pin of pins) {
      this.registerPinRoot(pin, context)
    }
    this.drainQueue(context)

    return this.finalizeGraph(context)
  }

  private createBuildContext(): GraphBuildContext {
    return { nodes: new Map(), edges: new Map(), queue: [], skippedRelations: 0, skippedNodes: 0 }
  }

  /**
   * A pin is always registered at depth 0, overwriting any prior (deeper) discovery
   * of the same filename by an earlier pin or by BFS - being a root always wins over
   * being a mere neighbor. Its relation expansion is unconditional, mirroring how the
   * old single-center code always fetched the center's direct relations regardless of
   * anything already queued.
   */
  private registerPinRoot(pin: PinSpec, context: GraphBuildContext): void {
    // A pin can outlive the note it points at (deleted from disk out-of-band, or a
    // stale pin persisted from a previous session) - there is nothing to render for
    // it, so skip the root entirely rather than fabricating a placeholder node.
    if (!this.notes.has(pin.filename)) {
      return
    }

    const existing = context.nodes.get(pin.filename)
    context.nodes.set(pin.filename, { depth: 0, order: existing?.order ?? context.nodes.size })

    if (pin.depth > 0) {
      this.expandRelationsAt(pin.filename, 0, pin.depth, context)
    }
  }

  /** Fetches and registers both relation directions for one note in one place. */
  private expandRelationsAt(
    filename: string,
    depth: number,
    maxDepth: number,
    context: GraphBuildContext
  ): void {
    this.registerRelations(
      filename,
      depth,
      maxDepth,
      this.buildOutgoingRelations(filename),
      context
    )
    this.registerRelations(
      filename,
      depth,
      maxDepth,
      this.buildIncomingRelations(filename),
      context
    )
  }

  private buildOutgoingRelations(filename: string): RelationDraft[] {
    return this.getOutgoing(filename)
      .filter((rel) => this.isRenderableNode(rel.target))
      .map((rel) => ({
        source: filename,
        target: rel.target,
        label: rel.label,
        direction: 'outgoing' as const
      }))
  }

  private buildIncomingRelations(filename: string): RelationDraft[] {
    return this.getIncoming(filename)
      .filter((rel) => this.isRenderableNode(rel.source))
      .map((rel) => ({
        source: rel.source,
        target: filename,
        label: rel.label,
        direction: 'incoming' as const
      }))
  }

  /**
   * Whether a note is fit to be discovered as the *other end* of a relation - i.e.
   * it actually exists and has content. `repairDanglingRelations` already strips
   * empty-target relations from disk, and drops missing-target ones from this
   * in-memory pass, so this is mostly a defensive backstop plus the one case that
   * repair doesn't cover: an empty note that is itself the *source* of a relation
   * into some other, perfectly valid note.
   */
  private isRenderableNode(filename: string): boolean {
    const note = this.notes.get(filename)
    return note !== undefined && !this.isEmptyBody(note)
  }

  /** Caps and registers a relation batch, bounded by the discovering pin's own maxDepth. */
  private registerRelations(
    origin: string,
    depth: number,
    maxDepth: number,
    relations: RelationDraft[],
    context: GraphBuildContext
  ): void {
    const limit = depth === 0 ? MAX_DIRECT_RELATIONS : MAX_SECONDARY_RELATIONS
    const visible = relations.slice(0, limit)
    context.skippedRelations += Math.max(0, relations.length - visible.length)

    for (const relation of visible) {
      const edgeId = `${relation.source}__${relation.target}__${relation.label}`
      if (!context.edges.has(edgeId)) {
        context.edges.set(edgeId, { id: edgeId, ...relation, depth: depth + 1 })
      }

      const neighbor = relation.source === origin ? relation.target : relation.source
      if (depth + 1 > maxDepth) {
        continue
      }

      const isNew = this.registerNode(neighbor, depth + 1, context)
      if (isNew) {
        // Queue even a node sitting exactly at the depth budget: its own relations
        // still need to be examined so edges to other already-known nodes are found,
        // even though no *new* node will be discovered past it (the depth+1 > maxDepth
        // check above already prevents that on the next pass).
        context.queue.push({ filename: neighbor, depth: depth + 1, maxDepth })
      }
    }
  }

  private registerNode(filename: string, depth: number, context: GraphBuildContext): boolean {
    const existing = context.nodes.get(filename)
    if (!existing) {
      if (context.nodes.size >= MAX_GRAPH_NODES) {
        context.skippedNodes += 1
        return false
      }

      context.nodes.set(filename, { depth, order: context.nodes.size })
      return true
    }

    if (depth < existing.depth) {
      existing.depth = depth
    }
    return false
  }

  private drainQueue(context: GraphBuildContext): void {
    let current: QueueItem | undefined
    while ((current = context.queue.shift())) {
      this.expandRelationsAt(current.filename, current.depth, current.maxDepth, context)
    }
  }

  private finalizeGraph(context: GraphBuildContext): NoteGraph {
    const warnings: string[] = []
    if (context.skippedRelations > 0) {
      warnings.push(
        `Truncated ${context.skippedRelations} relationships to keep the graph responsive.`
      )
    }
    if (context.skippedNodes > 0) {
      warnings.push(
        `Skipped ${context.skippedNodes} additional notes after hitting the graph size cap.`
      )
    }

    return {
      nodes: Array.from(context.nodes.entries())
        .map(([filename, meta]) => this.buildGraphNode(filename, meta))
        .sort(
          (left, right) =>
            left.depth - right.depth ||
            right.degree - left.degree ||
            left.filename.localeCompare(right.filename)
        ),
      // An edge can be discovered pointing at a note that never made it into the node
      // set (e.g. it's past a pin's depth budget) - drop those here rather than
      // shipping a dangling reference: the renderer's ELK layout has no tolerance for
      // an edge whose endpoint isn't in its node list and throws on it.
      edges: Array.from(context.edges.values()).filter(
        (edge) => context.nodes.has(edge.source) && context.nodes.has(edge.target)
      ),
      truncated: warnings.length > 0,
      warnings
    }
  }

  private buildGraphNode(filename: string, meta: NodeMeta): GraphNodePayload {
    // Every filename that reaches context.nodes is guaranteed to back a real note:
    // pin roots for missing notes are skipped in registerPinRoot, and neighbors are
    // only ever registered through buildOutgoingRelations/buildIncomingRelations,
    // which filter out missing/empty targets via isRenderableNode before this runs.
    const note = this.notes.get(filename)!

    return {
      filename,
      body: note.body,
      image: note.image,
      extraContent: note.extraContent,
      depth: meta.depth,
      degree: note.degree,
      notes: note.notes
    }
  }

  private getOutgoing(filename: string): NoteLink[] {
    const note = this.notes.get(filename)
    return [...(note?.rels ?? [])].sort((left, right) => {
      const labelSort = left.label.localeCompare(right.label)
      return labelSort !== 0 ? labelSort : left.target.localeCompare(right.target)
    })
  }

  private getIncoming(filename: string): IncomingRelation[] {
    return [...(this.reverseRefs.get(filename) ?? [])].sort((left, right) => {
      const labelSort = left.label.localeCompare(right.label)
      return labelSort !== 0 ? labelSort : left.source.localeCompare(right.source)
    })
  }

  private normalize(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  private tokenize(value: string): string[] {
    return value.match(/[\p{L}\p{N}_-]+/gu) ?? []
  }

  private generateFilename(): string {
    let candidate: string
    do {
      candidate = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`
    } while (this.notes.has(candidate))
    return candidate
  }

  private async writeNoteFile(
    filename: string,
    data: { body: string; rels: NoteRelationTuple[] }
  ): Promise<void> {
    const payload: RawNoteFile = { body: data.body, rels: data.rels }
    await writeFile(join(this.graphPath, filename), JSON.stringify(payload, null, 2), 'utf8')
  }

  private async appendRelation(filename: string, relation: NoteRelationTuple): Promise<void> {
    await this.mutateRelations(filename, (rels) => {
      rels.push(relation)
    })
  }

  /** Reads, mutates, and rewrites a note's raw JSON in place, without disturbing fields this app doesn't otherwise read/write. */
  private async mutateRawNote(
    filename: string,
    mutate: (parsed: Record<string, unknown>) => void
  ): Promise<void> {
    const path = join(this.graphPath, filename)
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    mutate(parsed)
    await writeFile(path, JSON.stringify(parsed, null, 2), 'utf8')
  }

  private async mutateRelations(
    filename: string,
    mutate: (rels: NoteRelationTuple[]) => void
  ): Promise<void> {
    await this.mutateRawNote(filename, (parsed) => {
      const rels: NoteRelationTuple[] = Array.isArray(parsed.rels)
        ? (parsed.rels as NoteRelationTuple[])
        : []
      mutate(rels)
      parsed.rels = rels
    })
  }

  private imagesDir(): string {
    return join(this.graphPath, IMAGES_DIR_NAME)
  }

  private imageFilePath(filename: string): string {
    return join(this.imagesDir(), filename)
  }

  /** `foo.json` -> `foo`. The stem an image filename must be prefixed with to belong to this note. */
  private stemOf(noteFilename: string): string {
    return noteFilename.replace(/\.json$/, '')
  }

  /** Lists `images/` (empty when the folder is absent). */
  private async listImageDir(): Promise<string[]> {
    try {
      return await readdir(this.imagesDir())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  /** `foo-1724900000000.webp` -> `{ stem: 'foo', ts: 1724900000000 }`, or null when it isn't a note image. */
  private parseImageName(entry: string): { stem: string; ts: number } | null {
    const dot = entry.lastIndexOf('.')
    if (dot <= 0 || !SUPPORTED_IMAGE_EXTENSIONS.has(entry.slice(dot + 1).toLowerCase())) {
      return null
    }
    const stemMatch = IMAGE_STEM_PATTERN.exec(entry.slice(0, dot))
    return stemMatch ? { stem: stemMatch[1], ts: Number(stemMatch[2]) } : null
  }

  /** Single scan of `images/` into `imagesByStem`, keeping the newest timestamp per stem. */
  private async scanImages(): Promise<void> {
    this.imagesByStem.clear()

    const newestByStem = new Map<string, number>()
    for (const entry of await this.listImageDir()) {
      const parsed = this.parseImageName(entry)
      if (!parsed) {
        continue
      }
      const newest = newestByStem.get(parsed.stem)
      if (newest === undefined || parsed.ts > newest) {
        newestByStem.set(parsed.stem, parsed.ts)
        this.imagesByStem.set(parsed.stem, entry)
      }
    }
  }

  /** Deletes every `images/<stem>-<digits><ext>` file (current image plus any stale leftovers). */
  private async deleteImageFiles(stem: string): Promise<void> {
    await Promise.all(
      (await this.listImageDir())
        .filter((entry) => this.parseImageName(entry)?.stem === stem)
        .map(async (entry) => {
          try {
            await unlink(this.imageFilePath(entry))
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error
            }
          }
        })
    )
  }

  private async persistSettings(): Promise<void> {
    const directory = this.settingsPath.replace(/\/[^/]+$/, '')
    await mkdir(directory, { recursive: true })
    await writeFile(
      this.settingsPath,
      JSON.stringify(
        {
          graphPath: this.graphPath,
          pins: this.lastPins,
          statsHistory: this.statsHistory
        } satisfies StoredSettings,
        null,
        2
      ),
      'utf8'
    )
  }
}

function toLocalCalendarDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
