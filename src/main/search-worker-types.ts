/** Corpus entry mirrors what raw/regex search scans: whitespace-compacted body and extra content (same compaction buildPreview already applies, so match indices line up with preview slicing). */
export interface RawSearchCorpusEntry {
  filename: string
  body: string
  extra: string
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
  /** Index of the match within the entry's (compacted) body, or null if the pattern only matched extra content. */
  bodyIndex: number | null
  bodyLength: number
  /** Index of the match within the entry's (compacted) extra content, or null if the pattern only matched the body. */
  extraIndex: number | null
  extraLength: number
}

export type RawSearchWorkerResponse =
  | { type: 'result'; requestId: number; matches: RawSearchMatch[] }
  | { type: 'error'; requestId: number; message: string }
