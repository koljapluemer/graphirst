export type SearchField = 'content' | 'body' | 'extra' | 'file'

export type SearchQueryNode =
  | { type: 'term'; value: string; match: 'fuzzy' | 'exact' | 'regex'; flags: string }
  | { type: 'and' | 'or'; children: SearchQueryNode[] }
  | { type: 'not'; child: SearchQueryNode }
  | { type: 'scope'; field: SearchField; child: SearchQueryNode }

interface Token {
  type: 'word' | 'phrase' | 'regex' | 'or' | 'minus' | 'open' | 'close' | 'colon'
  value?: string
  flags?: string
}

const SEARCH_FIELDS = new Set<SearchField>(['content', 'body', 'extra', 'file'])

/** A valid query prefix that only needs more input, rather than a syntax error. */
export class IncompleteSearchQueryError extends Error {}

/** Parses the user-facing search language. Adjacent expressions are an implicit AND. */
export function parseSearchQuery(source: string): SearchQueryNode {
  const parser = new SearchQueryParser(tokenize(source))
  const query = parser.parseExpression()
  parser.assertFinished()
  return query
}

class SearchQueryParser {
  private position = 0

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): SearchQueryNode {
    return this.parseOr()
  }

  assertFinished(): void {
    if (this.peek()) {
      throw new Error('Unexpected token in search query.')
    }
  }

  private parseOr(): SearchQueryNode {
    const children = [this.parseAnd()]
    while (this.peek()?.type === 'or') {
      this.position++
      children.push(this.parseAnd())
    }
    return children.length === 1 ? children[0] : { type: 'or', children }
  }

  private parseAnd(): SearchQueryNode {
    const children: SearchQueryNode[] = []
    while (this.startsExpression(this.peek())) {
      children.push(this.parseUnary())
    }
    if (children.length === 0) {
      throw new IncompleteSearchQueryError('Expected a search term.')
    }
    return children.length === 1 ? children[0] : { type: 'and', children }
  }

  private parseUnary(): SearchQueryNode {
    if (this.peek()?.type === 'minus') {
      this.position++
      return { type: 'not', child: this.parseUnary() }
    }

    const token = this.peek()
    const next = this.tokens[this.position + 1]
    if (token?.type === 'word' && next?.type === 'colon') {
      const field = token.value!.toLowerCase() as SearchField
      if (SEARCH_FIELDS.has(field)) {
        this.position += 2
        return { type: 'scope', field, child: this.parseUnary() }
      }
      const value = this.tokens[this.position + 2]
      if (value?.type === 'word') {
        this.position += 3
        return {
          type: 'term',
          value: `${token.value}:${value.value}`,
          match: 'fuzzy',
          flags: ''
        }
      }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): SearchQueryNode {
    const token = this.tokens[this.position++]
    if (!token) {
      throw new IncompleteSearchQueryError('Expected a search term.')
    }
    if (token.type === 'open') {
      const expression = this.parseExpression()
      if (this.tokens[this.position++]?.type !== 'close') {
        throw new IncompleteSearchQueryError('Unclosed parenthesis in search query.')
      }
      return expression
    }
    if (token.type === 'word') {
      return { type: 'term', value: token.value!, match: 'fuzzy', flags: '' }
    }
    if (token.type === 'phrase') {
      return { type: 'term', value: token.value!, match: 'exact', flags: '' }
    }
    if (token.type === 'regex') {
      return { type: 'term', value: token.value!, match: 'regex', flags: token.flags! }
    }
    throw new Error('Expected a search term.')
  }

  private peek(): Token | undefined {
    return this.tokens[this.position]
  }

  private startsExpression(token: Token | undefined): boolean {
    return Boolean(token && ['word', 'phrase', 'regex', 'minus', 'open'].includes(token.type))
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let position = 0

  while (position < source.length) {
    const char = source[position]
    if (/\s/.test(char)) {
      position++
      continue
    }
    if (char === '(' || char === ')' || char === '-' || char === ':') {
      const type = { '(': 'open', ')': 'close', '-': 'minus', ':': 'colon' }[char]
      tokens.push({ type: type as Token['type'] })
      position++
      continue
    }
    if (char === '"') {
      const quoted = readDelimited(source, position + 1, '"')
      tokens.push({ type: 'phrase', value: quoted.value.replace(/\\(["\\])/g, '$1') })
      position = quoted.end
      continue
    }
    if (char === '/') {
      const regex = readDelimited(source, position + 1, '/')
      position = regex.end
      const flagStart = position
      while (position < source.length && /[a-z]/i.test(source[position])) position++
      const flags = source.slice(flagStart, position)
      if (!/^[ims]*$/.test(flags)) throw new Error('Regex flags may only contain i, m, or s.')
      tokens.push({ type: 'regex', value: regex.value, flags })
      continue
    }

    const start = position
    while (position < source.length && !/[\s():]/.test(source[position])) position++
    const value = source.slice(start, position)
    tokens.push({ type: value === 'OR' ? 'or' : 'word', value })
  }
  return tokens
}

function readDelimited(
  source: string,
  start: number,
  delimiter: '"' | '/'
): { value: string; end: number } {
  let value = ''
  let escaped = false
  for (let position = start; position < source.length; position++) {
    const char = source[position]
    if (!escaped && char === delimiter) return { value, end: position + 1 }
    if (!escaped && char === '\\') {
      escaped = true
      value += char
    } else {
      escaped = false
      value += char
    }
  }
  throw new IncompleteSearchQueryError(
    delimiter === '"' ? 'Unclosed quoted phrase.' : 'Unclosed regular expression.'
  )
}
