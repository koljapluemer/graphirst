import { parentPort } from 'node:worker_threads'
import { RE2 } from 're2-wasm'
import type {
  RawSearchCorpusEntry,
  RawSearchMatch,
  RawSearchWorkerRequest,
  RawSearchWorkerResponse
} from './search-worker-types'

/**
 * Runs raw/regex search off the Electron main thread: NoteStore posts a fresh
 * corpus snapshot here on every reindex, then each search is a cheap
 * postMessage round-trip against the already-resident copy - no per-keystroke
 * corpus copy, and a slow or pathological scan can never block IPC/UI.
 * RE2 (via re2-wasm) is linear-time by construction, so unlike RegExp this
 * can't blow up on a hostile pattern even if it does run for a while.
 */

let corpus: RawSearchCorpusEntry[] = []
/** filename -> its index in `corpus`, kept in step so upsert/remove are O(1) lookups. */
let indexByFilename = new Map<string, number>()

function reindex(): void {
  indexByFilename = new Map(corpus.map((entry, index) => [entry.filename, index]))
}

function upsertEntries(entries: RawSearchCorpusEntry[]): void {
  for (const entry of entries) {
    const at = indexByFilename.get(entry.filename)
    if (at === undefined) {
      indexByFilename.set(entry.filename, corpus.length)
      corpus.push(entry)
    } else {
      corpus[at] = entry
    }
  }
}

function removeEntries(filenames: string[]): void {
  const drop = new Set(filenames)
  if (!filenames.some((filename) => indexByFilename.has(filename))) {
    return
  }
  corpus = corpus.filter((entry) => !drop.has(entry.filename))
  reindex()
}

interface FieldMatch {
  index: number
  length: number
}

function send(message: RawSearchWorkerResponse): void {
  parentPort?.postMessage(message)
}

function findLiteral(haystack: string, lowerNeedle: string): FieldMatch | null {
  const index = haystack.toLowerCase().indexOf(lowerNeedle)
  return index === -1 ? null : { index, length: lowerNeedle.length }
}

function findRegex(haystack: string, re: RE2): FieldMatch | null {
  const result = re.exec(haystack)
  return result ? { index: result.index, length: result[0]?.length ?? 0 } : null
}

function runSearch(
  requestId: number,
  pattern: string,
  isRegex: boolean,
  flags: string,
  limit: number
): void {
  let re: RE2 | null = null
  let lowerNeedle = ''

  if (isRegex) {
    try {
      re = new RE2(pattern, flags.includes('u') ? flags : `${flags}u`)
    } catch (error) {
      send({ type: 'error', requestId, message: (error as Error).message })
      return
    }
  } else {
    lowerNeedle = pattern.toLowerCase()
  }

  const matches: RawSearchMatch[] = []
  for (const entry of corpus) {
    const bodyMatch = isRegex ? findRegex(entry.body, re!) : findLiteral(entry.body, lowerNeedle)
    const extraMatch = isRegex ? findRegex(entry.extra, re!) : findLiteral(entry.extra, lowerNeedle)

    if (!bodyMatch && !extraMatch) {
      continue
    }

    matches.push({
      filename: entry.filename,
      bodyIndex: bodyMatch ? bodyMatch.index : null,
      bodyLength: bodyMatch ? bodyMatch.length : 0,
      extraIndex: extraMatch ? extraMatch.index : null,
      extraLength: extraMatch ? extraMatch.length : 0
    })

    if (matches.length >= limit) {
      break
    }
  }

  send({ type: 'result', requestId, matches })
}

parentPort?.on('message', (message: RawSearchWorkerRequest) => {
  switch (message.type) {
    case 'sync':
      corpus = message.corpus
      reindex()
      return
    case 'upsert':
      upsertEntries(message.entries)
      return
    case 'remove':
      removeEntries(message.filenames)
      return
    case 'search':
      runSearch(message.requestId, message.pattern, message.isRegex, message.flags, message.limit)
      return
  }
})
