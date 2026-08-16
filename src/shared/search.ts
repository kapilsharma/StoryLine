/**
 * Full-text search over note, character and timeline bodies (Issues #59, #60).
 *
 * Pure and shared, so the desktop app (main process, reading files) and a
 * published static export (browser, reading the bundle) run the *same* matcher
 * rather than two that drift apart. Nothing here touches a filesystem.
 *
 * Why this exists at all: `listNoteMetas` deliberately drops note bodies so
 * opening a project stays fast, which left the Notes tab able to search titles
 * and nothing else. Rather than undo that decision, the body text is indexed
 * separately and searched on demand.
 */

/** What a hit is attached to. Character/timeline bodies are notes too (#33, #41). */
export type SearchKind = 'note' | 'character' | 'timeline'

export const SEARCH_KINDS: SearchKind[] = ['note', 'character', 'timeline']

/** One indexed thing. `body` is raw markdown; matching lower-cases as it goes. */
export interface SearchEntry {
  boardId: string
  kind: SearchKind
  /** Slug/filename stem — what `openEditor` and `getNote` take. */
  id: string
  title: string
  tags: string[]
  body: string
}

/** Where in an entry the query matched. Title beats tag beats body when ranking. */
export type MatchField = 'title' | 'tag' | 'body'

export interface SearchHit {
  boardId: string
  kind: SearchKind
  id: string
  title: string
  tags: string[]
  /** The strongest field that matched. */
  where: MatchField
  /**
   * A short body excerpt around the first body match, or null when the match was
   * in the title or a tag only. Plain text — markdown syntax is stripped so the
   * result list stays readable.
   */
  snippet: string | null
  /** Higher is better. Used for ordering, not shown. */
  score: number
}

export interface SearchScope {
  /** Board ids to search. Empty or omitted searches every board (#60). */
  boardIds?: string[]
  /** Restrict to entries carrying this tag. */
  tag?: string | null
  /** Restrict to these kinds. Omitted searches all three. */
  kinds?: SearchKind[]
  /** Cap on hits returned. Omitted = no cap. */
  limit?: number
}

/** Characters of body text kept either side of a match in the snippet. */
const SNIPPET_PAD = 60

/**
 * Split a query into terms. Quoted runs stay together, so `"gap analysis"`
 * matches the phrase rather than the two words independently.
 */
export function parseQuery(query: string): string[] {
  const terms: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    const term = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (term) terms.push(term)
  }
  return terms
}

/**
 * Strip enough markdown that a snippet reads as prose. Deliberately crude — this
 * is for a one-line preview, not for rendering.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id: string, label?: string) => label ?? id)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~=]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build a snippet around the first occurrence of `term` in `text`. */
export function snippetAround(text: string, term: string): string | null {
  const at = text.toLowerCase().indexOf(term)
  if (at < 0) return null
  const from = Math.max(0, at - SNIPPET_PAD)
  const to = Math.min(text.length, at + term.length + SNIPPET_PAD)
  return (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '')
}

/**
 * Match one entry against already-parsed terms.
 *
 * **All** terms must match somewhere in the entry (AND), because that is what
 * makes a second word narrow a result list rather than widen it. A single term
 * may match in any field.
 */
export function matchEntry(entry: SearchEntry, rawTerms: string[]): SearchHit | null {
  // `parseQuery` already lower-cases, but lower-casing again is cheap and stops
  // a caller that hand-builds its terms from silently matching nothing.
  const terms = rawTerms.map((t) => t.toLowerCase()).filter(Boolean)
  if (terms.length === 0) return null

  const title = entry.title.toLowerCase()
  const tags = entry.tags.map((t) => t.toLowerCase())
  const plain = plainText(entry.body)
  const body = plain.toLowerCase()

  let score = 0
  let where: MatchField = 'body'
  let snippetTerm: string | null = null

  for (const term of terms) {
    const inTitle = title.includes(term)
    const inTag = tags.some((t) => t.includes(term))
    const inBody = body.includes(term)
    if (!inTitle && !inTag && !inBody) return null

    if (inTitle) {
      // An exact title beats a title that merely contains the term.
      score += title === term ? 100 : 50
      if (where === 'body') where = 'title'
    } else if (inTag) {
      score += 25
      if (where === 'body') where = 'tag'
    }
    if (inBody) {
      score += 10
      if (!snippetTerm) snippetTerm = term
    }
  }

  // Title matches rank above tag matches above body-only matches.
  if (where === 'title') score += 30
  else if (where === 'tag') score += 10

  return {
    boardId: entry.boardId,
    kind: entry.kind,
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    where,
    snippet: snippetTerm ? snippetAround(plain, snippetTerm) : null,
    score
  }
}

/** Does this entry pass the non-text parts of the scope? */
function inScope(entry: SearchEntry, scope: SearchScope): boolean {
  if (scope.boardIds && scope.boardIds.length > 0 && !scope.boardIds.includes(entry.boardId)) {
    return false
  }
  if (scope.kinds && scope.kinds.length > 0 && !scope.kinds.includes(entry.kind)) return false
  if (scope.tag && !entry.tags.includes(scope.tag)) return false
  return true
}

/**
 * Run a query over entries. An empty query returns every in-scope entry (as
 * title hits) so the Notes tab can use one code path for "browse" and "search".
 */
export function searchEntries(
  entries: SearchEntry[],
  query: string,
  scope: SearchScope = {}
): SearchHit[] {
  const terms = parseQuery(query)
  const scoped = entries.filter((e) => inScope(e, scope))

  const hits: SearchHit[] =
    terms.length === 0
      ? scoped.map((e) => ({
          boardId: e.boardId,
          kind: e.kind,
          id: e.id,
          title: e.title,
          tags: e.tags,
          where: 'title' as const,
          snippet: null,
          score: 0
        }))
      : scoped.map((e) => matchEntry(e, terms)).filter((h): h is SearchHit => h !== null)

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return scope.limit && scope.limit > 0 ? hits.slice(0, scope.limit) : hits
}

/**
 * Split `text` into alternating non-match / match runs for highlighting, so the
 * UI never has to build HTML from a search result.
 */
export function highlightRuns(text: string, terms: string[]): Array<{ text: string; hit: boolean }> {
  if (terms.length === 0 || !text) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const marks: boolean[] = new Array(text.length).fill(false)

  for (const term of terms) {
    if (!term) continue
    let at = lower.indexOf(term)
    while (at >= 0) {
      for (let i = at; i < at + term.length; i++) marks[i] = true
      at = lower.indexOf(term, at + term.length)
    }
  }

  const runs: Array<{ text: string; hit: boolean }> = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      runs.push({ text: text.slice(start, i), hit: marks[start] })
      start = i
    }
  }
  return runs
}
