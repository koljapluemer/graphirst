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
    const aliasMatch = isRegex
      ? findRegex(entry.aliases, re!)
      : findLiteral(entry.aliases, lowerNeedle)
    const bodyMatch = isRegex ? findRegex(entry.body, re!) : findLiteral(entry.body, lowerNeedle)

    if (!aliasMatch && !bodyMatch) {
      continue
    }

    matches.push({
      filename: entry.filename,
      aliasHit: aliasMatch !== null,
      bodyIndex: bodyMatch ? bodyMatch.index : null,
      bodyLength: bodyMatch ? bodyMatch.length : 0
    })

    if (matches.length >= limit) {
      break
    }
  }

  send({ type: 'result', requestId, matches })
}

parentPort?.on('message', (message: RawSearchWorkerRequest) => {
  if (message.type === 'sync') {
    corpus = message.corpus
    return
  }

  runSearch(message.requestId, message.pattern, message.isRegex, message.flags, message.limit)
})
