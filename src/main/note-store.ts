import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document } from 'flexsearch'
import type {
  ConnectNotesRequest,
  ConnectNotesResponse,
  CreateNoteRequest,
  CreateNoteResponse,
  DeleteNoteRequest,
  DeleteRelationRequest,
  GraphEdgePayload,
  GraphNodePayload,
  IndexedNote,
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
  SaveImageRequest,
  SaveImageResponse,
  SearchResult,
  UndoDeleteResponse,
  UpdateNoteRequest,
  UpdateRelationRequest
} from '../shared/notes'

const DEFAULT_GRAPH_PATH = '/home/brokkoli/Sync/Graph'
const SETTINGS_FILE_NAME = 'graphirst-settings.json'
const MEDIA_DIR_NAME = 'media'
const MAX_SEARCH_RESULTS = 40
const MAX_DIRECT_RELATIONS = 28
const MAX_SECONDARY_RELATIONS = 12
const MAX_GRAPH_NODES = 140

interface StoredSettings {
  graphPath?: string
  pins?: PinSpec[]
}

interface SearchDocument extends Record<string, string | number> {
  id: number
  filename: string
  aliases: string
  body: string
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

export class NoteStore extends EventEmitter {
  private readonly settingsPath: string
  private graphPath = DEFAULT_GRAPH_PATH
  private lastPins: PinSpec[] = []
  private notes = new Map<string, IndexedNote>()
  private reverseRefs = new Map<string, IncomingRelation[]>()
  private searchDocs = new Map<number, SearchDocument>()
  private searchIndex = this.createSearchIndex()
  private stats: IndexStats | null = null
  private status: NotesBootstrap['status'] = 'empty'
  private message?: string
  private hasIndexed = false
  private inFlightIndex: Promise<void> | null = null
  private pendingUndo: PendingUndo | null = null

  constructor(settingsDir: string) {
    super()
    this.settingsPath = join(settingsDir, SETTINGS_FILE_NAME)
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

  async search(query: string): Promise<NotesSearchResponse> {
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

    const rawResults = this.searchIndex.search(trimmed, {
      enrich: true,
      limit: 120,
      merge: true
    })

    const ranked = rawResults
      .map((entry, index) => this.rankSearchResult(entry.id, index, trimmed))
      .filter((result): result is SearchResult => result !== null)
      .sort(
        (left, right) => right.score - left.score || left.filename.localeCompare(right.filename)
      )
      .slice(0, MAX_SEARCH_RESULTS)

    return {
      graphPath: this.graphPath,
      stats: this.stats,
      results: ranked
    }
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
      await this.writeNoteFile(filename, { body: request.body, rels: [], image: request.image })
      await this.ensureIndexed(true)
      return { filename }
    }

    const label = (request.label ?? '').trim() || 'related'

    if (request.reverse) {
      await this.writeNoteFile(filename, {
        body: request.body,
        rels: [[label, request.relatedFilename]],
        image: request.image
      })
    } else {
      await this.writeNoteFile(filename, { body: request.body, rels: [], image: request.image })
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
        const data = await readFile(this.mediaFilePath(existing.image))
        image = { filename: existing.image, data }
      } catch (error) {
        const maybeError = error as NodeJS.ErrnoException
        if (maybeError.code !== 'ENOENT') {
          throw error
        }
      }
      await this.deleteMediaFile(existing.image)
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
      if (request.image) {
        parsed.image = request.image
      } else {
        delete parsed.image
      }
      if (request.aliases.length > 0) {
        parsed.aliases = request.aliases
      } else {
        delete parsed.aliases
      }
    })

    if (existing.image && existing.image !== request.image) {
      await this.deleteMediaFile(existing.image)
    }

    await this.ensureIndexed(true)
  }

  async saveImage(request: SaveImageRequest): Promise<SaveImageResponse> {
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(request.dataUrl)
    if (!match) {
      throw new Error('Unsupported image data.')
    }

    const [, subtype, base64] = match
    const extension = subtype === 'jpeg' ? 'jpg' : subtype
    const filename = `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`

    await mkdir(this.mediaDir(), { recursive: true })
    await writeFile(this.mediaFilePath(filename), Buffer.from(base64, 'base64'))

    return { filename }
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
        await mkdir(this.mediaDir(), { recursive: true })
        await writeFile(this.mediaFilePath(pending.image.filename), pending.image.data)
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
        lastIndexedAt: new Date().toISOString()
      }
      this.hasIndexed = true
      return
    }

    const batchSize = 200
    let relationCount = 0
    let searchId = 1

    for (let batchStart = 0; batchStart < dirEntries.length; batchStart += batchSize) {
      const batch = dirEntries.slice(batchStart, batchStart + batchSize)
      const parsedNotes = await Promise.all(batch.map((filename) => this.readNoteFile(filename)))

      for (const note of parsedNotes) {
        if (!note) {
          continue
        }

        relationCount += note.rels.length
        this.notes.set(note.filename, note)

        const doc: SearchDocument = {
          id: searchId,
          filename: note.filename,
          aliases: note.aliases.join(' '),
          body: note.body
        }

        this.searchDocs.set(searchId, doc)
        this.searchIndex.add(doc)
        searchId += 1
      }
    }

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
      relationCount,
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
      const aliases = Array.isArray(parsed.aliases)
        ? parsed.aliases.filter((alias): alias is string => typeof alias === 'string')
        : []
      const rels = Array.isArray(parsed.rels)
        ? parsed.rels.flatMap((rel) => this.normalizeRelation(rel))
        : []
      const image = typeof parsed.image === 'string' && parsed.image.trim() ? parsed.image : null

      return {
        filename,
        body,
        aliases,
        rels,
        degree: rels.length,
        image
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
          { field: 'aliases', tokenize: 'forward', resolution: 8 },
          { field: 'body', tokenize: 'forward', resolution: 6, context: true }
        ]
      }
    })
  }

  private resetIndex(): void {
    this.notes.clear()
    this.reverseRefs.clear()
    this.searchDocs.clear()
    this.searchIndex = this.createSearchIndex()
    this.stats = null
    this.status = 'empty'
    this.message = undefined
  }

  private rankSearchResult(id: number | string, order: number, query: string): SearchResult | null {
    const doc = this.searchDocs.get(Number(id))
    if (!doc) {
      return null
    }

    const note = this.notes.get(doc.filename)
    if (!note) {
      return null
    }

    const normalizedQuery = this.normalize(query)
    const queryTokens = this.tokenize(normalizedQuery)
    const aliases = this.normalize(doc.aliases)
    const body = this.normalize(doc.body)

    let score = 1000 - order * 5
    let match: SearchResult['match'] = 'body'

    if (aliases.includes(normalizedQuery)) {
      score += 260
      match = 'alias'
    }

    if (body.includes(normalizedQuery)) {
      score += 140
      match = match === 'alias' ? 'mixed' : 'body'
    }

    const haystacks = [aliases, body]
    const matchingTokens = queryTokens.filter((token) =>
      haystacks.some((haystack) => haystack.includes(token))
    )
    score += matchingTokens.length * 35

    if (queryTokens.length > 1 && matchingTokens.length === queryTokens.length) {
      score += 120
      match = aliases.includes(normalizedQuery) && body.includes(normalizedQuery) ? 'mixed' : match
    }

    score += Math.min(note.degree, 24)

    return {
      filename: doc.filename,
      aliases: note.aliases,
      preview: this.buildPreview(note.body, queryTokens),
      score,
      match
    }
  }

  private buildPreview(body: string, queryTokens: string[]): string {
    const compact = body.replace(/\s+/g, ' ').trim()
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
      aliases: note.aliases,
      depth: meta.depth,
      degree: note.degree
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
    data: { body: string; rels: NoteRelationTuple[]; image?: string }
  ): Promise<void> {
    const payload: RawNoteFile = { body: data.body, rels: data.rels }
    if (data.image) {
      payload.image = data.image
    }
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

  private mediaDir(): string {
    return join(this.graphPath, MEDIA_DIR_NAME)
  }

  private mediaFilePath(filename: string): string {
    return join(this.mediaDir(), filename)
  }

  private async deleteMediaFile(filename: string): Promise<void> {
    try {
      await unlink(this.mediaFilePath(filename))
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException
      if (maybeError.code !== 'ENOENT') {
        throw error
      }
    }
  }

  private async persistSettings(): Promise<void> {
    const directory = this.settingsPath.replace(/\/[^/]+$/, '')
    await mkdir(directory, { recursive: true })
    await writeFile(
      this.settingsPath,
      JSON.stringify(
        {
          graphPath: this.graphPath,
          pins: this.lastPins
        } satisfies StoredSettings,
        null,
        2
      ),
      'utf8'
    )
  }
}
