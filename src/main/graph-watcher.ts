import { EventEmitter } from 'node:events'
import { isAbsolute, relative, sep } from 'node:path'
import { watch, type ChokidarOptions, type FSWatcher } from 'chokidar'
import { IMAGES_DIR_NAME, SUPPORTED_IMAGE_EXTENSIONS } from './graph-fs'

/** Trailing debounce: how long the buffer waits for the next event before flushing. */
const DEFAULT_DEBOUNCE_MS = 150
/** Hard cap: a continuous event stream is flushed at least this often regardless of the debounce. */
const DEFAULT_MAX_BATCH_WAIT_MS = 1000
/** awaitWriteFinish: a file must keep the same size for this long before it counts as written. */
const DEFAULT_STABILITY_THRESHOLD_MS = 200
const DEFAULT_POLL_INTERVAL_MS = 50

/**
 * One coalesced description of what changed in the graph folder since the last
 * flush. Note names are bare `*.json` basenames (as NoteStore keys them);
 * `images.paths` are absolute paths.
 */
export interface GraphChangeBatch {
  notes: { added: string[]; changed: string[]; removed: string[] }
  images: { touched: boolean; paths: string[] }
}

export interface GraphWatcherOptions {
  debounceMs?: number
  maxBatchWaitMs?: number
  stabilityThresholdMs?: number
  pollIntervalMs?: number
}

type NoteEventKind = 'add' | 'change' | 'unlink'

type Classification = { kind: 'note'; name: string } | { kind: 'image'; name: string } | null

interface GraphWatcherEvents {
  batch: [batch: GraphChangeBatch]
  error: [error: Error]
  ready: []
}

/**
 * Watches one graph folder - a flat set of `*.json` note files plus an `images/`
 * subdirectory - and emits coalesced `batch` events describing what changed on
 * disk. It translates filesystem events into batches and nothing more: it has no
 * knowledge of the note index, the search corpus, or how a batch is applied.
 */
export class GraphWatcher extends EventEmitter<GraphWatcherEvents> {
  private readonly debounceMs: number
  private readonly maxBatchWaitMs: number
  private readonly stabilityThresholdMs: number
  private readonly pollIntervalMs: number

  private watcher: FSWatcher | null = null
  private path: string | null = null
  private starting: Promise<void> | null = null

  private readonly added = new Set<string>()
  private readonly changed = new Set<string>()
  private readonly removed = new Set<string>()
  private imagesTouched = false
  private readonly imagePaths = new Set<string>()

  private debounceTimer: NodeJS.Timeout | null = null
  private capTimer: NodeJS.Timeout | null = null

  constructor(options: GraphWatcherOptions = {}) {
    super()
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.maxBatchWaitMs = options.maxBatchWaitMs ?? DEFAULT_MAX_BATCH_WAIT_MS
    this.stabilityThresholdMs = options.stabilityThresholdMs ?? DEFAULT_STABILITY_THRESHOLD_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  isWatching(): boolean {
    return this.watcher !== null
  }

  watchedPath(): string | null {
    return this.path
  }

  /**
   * Begins (or moves) the watch to `graphPath`. Resolves once the initial
   * directory scan has completed. Idempotent for an unchanged path.
   */
  async start(graphPath: string): Promise<void> {
    if (this.path === graphPath && (this.watcher || this.starting)) {
      return this.starting ?? Promise.resolve()
    }

    await this.stop()
    this.path = graphPath

    const options: ChokidarOptions = {
      persistent: true,
      ignoreInitial: true,
      // depth 1 covers the root `*.json` files and the one level of `images/*`.
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: this.stabilityThresholdMs,
        pollInterval: this.pollIntervalMs
      },
      ignored: (candidate: string) => this.isIgnored(graphPath, candidate)
    }

    const watcher = watch(graphPath, options)
    this.watcher = watcher

    watcher.on('add', (p) => this.onNoteEvent('add', graphPath, p))
    watcher.on('change', (p) => this.onNoteEvent('change', graphPath, p))
    watcher.on('unlink', (p) => this.onNoteEvent('unlink', graphPath, p))
    watcher.on('error', (error) => this.emit('error', error as Error))

    this.starting = new Promise<void>((resolve) => {
      watcher.once('ready', () => {
        this.starting = null
        this.emit('ready')
        resolve()
      })
    })
    return this.starting
  }

  /** Closes the watcher and drops any buffered, un-flushed events. */
  async stop(): Promise<void> {
    this.clearTimers()
    this.discardBuffer()
    this.path = null
    this.starting = null

    const watcher = this.watcher
    this.watcher = null
    if (watcher) {
      await watcher.close()
    }
  }

  /**
   * chokidar consults this for every path it encounters, directories included, so
   * the graph root and the `images/` directory must be allowed through for their
   * contents to be walked at all.
   */
  private isIgnored(graphPath: string, candidate: string): boolean {
    if (candidate === graphPath) {
      return false
    }
    if (relative(graphPath, candidate) === IMAGES_DIR_NAME) {
      return false
    }
    return classify(graphPath, candidate) === null
  }

  private onNoteEvent(kind: NoteEventKind, graphPath: string, absPath: string): void {
    const entry = classify(graphPath, absPath)
    if (!entry) {
      return
    }

    if (entry.kind === 'image') {
      this.imagesTouched = true
      this.imagePaths.add(absPath)
      this.scheduleFlush()
      return
    }

    this.reconcileNoteEvent(kind, entry.name)
    this.scheduleFlush()
  }

  /** Folds a raw event into the pending buffer, collapsing add/change/unlink churn on one file. */
  private reconcileNoteEvent(kind: NoteEventKind, name: string): void {
    switch (kind) {
      case 'add':
        if (this.removed.delete(name)) {
          this.changed.add(name)
        } else {
          this.added.add(name)
        }
        return
      case 'change':
        if (!this.added.has(name)) {
          this.changed.add(name)
        }
        return
      case 'unlink':
        this.changed.delete(name)
        // A file created and destroyed within one batch never existed as far as
        // consumers are concerned - drop it entirely rather than reporting it.
        if (!this.added.delete(name)) {
          this.removed.add(name)
        }
        return
    }
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs)
    if (!this.capTimer) {
      this.capTimer = setTimeout(() => this.flush(), this.maxBatchWaitMs)
    }
  }

  private flush(): void {
    this.clearTimers()
    if (!this.hasBufferedChanges()) {
      return
    }

    const batch: GraphChangeBatch = {
      notes: {
        added: [...this.added].sort(),
        changed: [...this.changed].sort(),
        removed: [...this.removed].sort()
      },
      images: { touched: this.imagesTouched, paths: [...this.imagePaths].sort() }
    }
    this.discardBuffer()
    this.emit('batch', batch)
  }

  private hasBufferedChanges(): boolean {
    return (
      this.added.size > 0 || this.changed.size > 0 || this.removed.size > 0 || this.imagesTouched
    )
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.capTimer) {
      clearTimeout(this.capTimer)
      this.capTimer = null
    }
  }

  private discardBuffer(): void {
    this.added.clear()
    this.changed.clear()
    this.removed.clear()
    this.imagePaths.clear()
    this.imagesTouched = false
  }
}

/**
 * Maps an absolute path to the graph entity it represents, or null when the path
 * is not part of the graph (nested deeper, a non-JSON root file, a dotfile, a
 * temp/swap file, an unsupported image type, ...).
 */
function classify(graphPath: string, absPath: string): Classification {
  const rel = relative(graphPath, absPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }

  const segments = rel.split(sep)

  if (segments.length === 1) {
    const name = segments[0]
    if (name.startsWith('.') || !name.toLowerCase().endsWith('.json')) {
      return null
    }
    return { kind: 'note', name }
  }

  if (segments.length === 2 && segments[0] === IMAGES_DIR_NAME) {
    const name = segments[1]
    if (name.startsWith('.')) {
      return null
    }
    const dot = name.lastIndexOf('.')
    const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return null
    }
    return { kind: 'image', name }
  }

  return null
}
