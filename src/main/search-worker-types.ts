/** Corpus entry mirrors what raw/regex search scans: joined aliases and a whitespace-compacted body (same compaction buildPreview already applies, so match indices line up with preview slicing). */
export interface RawSearchCorpusEntry {
  filename: string
  aliases: string
  body: string
}

export type RawSearchWorkerRequest =
  | { type: 'sync'; corpus: RawSearchCorpusEntry[] }
  | {
      type: 'search'
      requestId: number
      pattern: string
      isRegex: boolean
      flags: string
      limit: number
    }

export interface RawSearchMatch {
  filename: string
  aliasHit: boolean
  /** Index of the match within the entry's (compacted) body, or null if the pattern only matched an alias. */
  bodyIndex: number | null
  bodyLength: number
}

export type RawSearchWorkerResponse =
  | { type: 'result'; requestId: number; matches: RawSearchMatch[] }
  | { type: 'error'; requestId: number; message: string }
