import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document } from 'flexsearch'
import type {
  GraphDirection,
  GraphEdgePayload,
  GraphNodePayload,
  IndexedNote,
  IndexStats,
  NoteGraph,
  NoteLink,
  NotesBootstrap,
  NotesOpenResponse,
  NotesSearchResponse,
  RawNoteFile,
  SearchResult
} from '../shared/notes'

const DEFAULT_GRAPH_PATH = '/home/brokkoli/Sync/Graph'
const SETTINGS_FILE_NAME = 'graphirst-settings.json'
const MAX_SEARCH_RESULTS = 40
const MAX_GRAPH_DEPTH = 2
const MAX_DIRECT_RELATIONS = 28
const MAX_SECONDARY_RELATIONS = 12
const MAX_GRAPH_NODES = 140

interface StoredSettings {
  graphPath?: string
  lastOpened?: string
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
  lanes: Set<Exclude<GraphDirection, 'center' | 'mixed'>>
  order: number
}

interface QueueItem {
  filename: string
  depth: number
  lane: Exclude<GraphDirection, 'center' | 'mixed'>
}

export class NoteStore {
  private readonly settingsPath: string
  private graphPath = DEFAULT_GRAPH_PATH
  private lastOpened?: string
  private notes = new Map<string, IndexedNote>()
  private reverseRefs = new Map<string, IncomingRelation[]>()
  private searchDocs = new Map<number, SearchDocument>()
  private searchIndex = this.createSearchIndex()
  private stats: IndexStats | null = null
  private status: NotesBootstrap['status'] = 'empty'
  private message?: string
  private hasIndexed = false
  private inFlightIndex: Promise<void> | null = null

  constructor(settingsDir: string) {
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
      lastOpened: this.lastOpened
    }
  }

  async setGraphPath(graphPath: string): Promise<NotesBootstrap> {
    this.graphPath = graphPath
    this.hasIndexed = false
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

  async openNote(filename: string): Promise<NotesOpenResponse> {
    await this.ensureIndexed()

    if (!this.stats) {
      throw new Error(this.message ?? 'The note index is not ready yet.')
    }

    const noteExists = this.notes.has(filename)
    if (!noteExists) {
      throw new Error(`Could not find "${filename}" in ${this.graphPath}.`)
    }

    this.lastOpened = filename
    await this.persistSettings()

    return {
      graphPath: this.graphPath,
      stats: this.stats,
      graph: this.buildGraph(filename)
    }
  }

  async loadSettings(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as StoredSettings

      if (typeof parsed.graphPath === 'string' && parsed.graphPath.trim()) {
        this.graphPath = parsed.graphPath
      }

      if (typeof parsed.lastOpened === 'string' && parsed.lastOpened.trim()) {
        this.lastOpened = parsed.lastOpened
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
      this.inFlightIndex = this.rebuildIndex().finally(() => {
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

    if (this.lastOpened && !this.notes.has(this.lastOpened)) {
      this.lastOpened = undefined
      await this.persistSettings()
    }
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

      return {
        filename,
        body,
        aliases,
        rels,
        degree: rels.length
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

  private buildGraph(centerFilename: string): NoteGraph {
    const centerNote = this.notes.get(centerFilename)
    const nodes = new Map<string, NodeMeta>()
    const edges = new Map<string, GraphEdgePayload>()
    const queue: QueueItem[] = []
    const warnings: string[] = []
    let skippedRelations = 0
    let skippedNodes = 0

    nodes.set(centerFilename, {
      depth: 0,
      lanes: new Set(),
      order: 0
    })

    if (!centerNote) {
      return {
        center: centerFilename,
        nodes: [
          {
            filename: centerFilename,
            body: 'Referenced note is missing from the current graph folder.',
            aliases: [],
            depth: 0,
            direction: 'center',
            degree: 0,
            missing: true
          }
        ],
        edges: [],
        truncated: false,
        warnings: ['The requested note is missing from the current folder.']
      }
    }

    const registerNode = (
      filename: string,
      depth: number,
      lane: Exclude<GraphDirection, 'center' | 'mixed'>
    ): boolean => {
      const existing = nodes.get(filename)
      if (!existing) {
        if (nodes.size >= MAX_GRAPH_NODES) {
          skippedNodes += 1
          return false
        }

        nodes.set(filename, {
          depth,
          lanes: new Set([lane]),
          order: nodes.size
        })
        return true
      }

      if (depth < existing.depth) {
        existing.depth = depth
      }

      existing.lanes.add(lane)
      return false
    }

    const enqueueRelations = (
      origin: string,
      lane: Exclude<GraphDirection, 'center' | 'mixed'>,
      depth: number,
      relations: Array<Omit<GraphEdgePayload, 'id' | 'depth'>>
    ): void => {
      const limit = depth === 0 ? MAX_DIRECT_RELATIONS : MAX_SECONDARY_RELATIONS
      const visible = relations.slice(0, limit)
      skippedRelations += Math.max(0, relations.length - visible.length)

      for (const relation of visible) {
        const edgeId = `${relation.source}__${relation.target}__${relation.label}`
        if (!edges.has(edgeId)) {
          edges.set(edgeId, {
            id: edgeId,
            ...relation,
            depth: depth + 1
          })
        }

        const neighbor = relation.source === origin ? relation.target : relation.source
        if (depth + 1 > MAX_GRAPH_DEPTH) {
          continue
        }

        const isNew = registerNode(neighbor, depth + 1, lane)
        if (isNew && depth + 1 < MAX_GRAPH_DEPTH) {
          queue.push({
            filename: neighbor,
            depth: depth + 1,
            lane
          })
        }
      }
    }

    const directOutgoing = this.getOutgoing(centerFilename).map((rel) => ({
      source: centerFilename,
      target: rel.target,
      label: rel.label,
      direction: 'outgoing' as const
    }))
    const directIncoming = this.getIncoming(centerFilename).map((rel) => ({
      source: rel.source,
      target: centerFilename,
      label: rel.label,
      direction: 'incoming' as const
    }))

    enqueueRelations(centerFilename, 'outgoing', 0, directOutgoing)
    enqueueRelations(centerFilename, 'incoming', 0, directIncoming)

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) {
        continue
      }

      const outgoing = this.getOutgoing(current.filename).map((rel) => ({
        source: current.filename,
        target: rel.target,
        label: rel.label,
        direction: 'outgoing' as const
      }))
      const incoming = this.getIncoming(current.filename).map((rel) => ({
        source: rel.source,
        target: current.filename,
        label: rel.label,
        direction: 'incoming' as const
      }))

      enqueueRelations(current.filename, current.lane, current.depth, outgoing)
      enqueueRelations(current.filename, current.lane, current.depth, incoming)
    }

    if (skippedRelations > 0) {
      warnings.push(`Truncated ${skippedRelations} relationships to keep the graph responsive.`)
    }

    if (skippedNodes > 0) {
      warnings.push(`Skipped ${skippedNodes} additional notes after hitting the graph size cap.`)
    }

    return {
      center: centerFilename,
      nodes: Array.from(nodes.entries())
        .map(([filename, meta]) => this.buildGraphNode(filename, meta))
        .sort(
          (left, right) =>
            left.depth - right.depth ||
            right.degree - left.degree ||
            left.filename.localeCompare(right.filename)
        ),
      edges: Array.from(edges.values()),
      truncated: warnings.length > 0,
      warnings
    }
  }

  private buildGraphNode(filename: string, meta: NodeMeta): GraphNodePayload {
    const note = this.notes.get(filename)
    const missing = !note

    let direction: GraphDirection = 'center'
    if (meta.depth > 0) {
      direction = meta.lanes.size > 1 ? 'mixed' : (Array.from(meta.lanes)[0] ?? 'mixed')
    }

    return {
      filename,
      body: note?.body ?? 'Referenced note is missing from the current graph folder.',
      aliases: note?.aliases ?? [],
      depth: meta.depth,
      direction,
      degree: note?.degree ?? 0,
      missing
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

  private async persistSettings(): Promise<void> {
    const directory = this.settingsPath.replace(/\/[^/]+$/, '')
    await mkdir(directory, { recursive: true })
    await writeFile(
      this.settingsPath,
      JSON.stringify(
        {
          graphPath: this.graphPath,
          lastOpened: this.lastOpened
        } satisfies StoredSettings,
        null,
        2
      ),
      'utf8'
    )
  }
}
