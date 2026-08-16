import { describe, it, expect } from 'vitest'
import {
  highlightRuns,
  matchEntry,
  parseQuery,
  plainText,
  searchEntries,
  snippetAround,
  type SearchEntry
} from '@shared/search'

/**
 * Search over note bodies (Issues #59, #60).
 *
 * The matcher is pure and shared between the desktop app (which reads files in
 * the main process) and a published export (which reads the bundle), so these
 * tests cover both hosts at once.
 */

const entry = (over: Partial<SearchEntry> = {}): SearchEntry => ({
  boardId: 'adm',
  kind: 'note',
  id: 'phase-e',
  title: 'Opportunities & Solutions',
  tags: ['phase', 'transition'],
  body: 'Consolidate the gap analysis from Phases B to D into work packages.',
  ...over
})

describe('parseQuery', () => {
  it('splits on whitespace and lower-cases', () => {
    expect(parseQuery('Gap  Analysis')).toEqual(['gap', 'analysis'])
  })

  it('keeps a quoted phrase together', () => {
    expect(parseQuery('"gap analysis" phase')).toEqual(['gap analysis', 'phase'])
  })

  it('is empty for blank input', () => {
    expect(parseQuery('   ')).toEqual([])
  })
})

describe('plainText', () => {
  it('strips headings, emphasis and list markers', () => {
    expect(plainText('## Steps\n\n- **Bold** and _thin_')).toBe('Steps Bold and thin')
  })

  it('drops fenced code and image syntax', () => {
    expect(plainText('a\n```js\nconst x = 1\n```\n![alt](assets/x.png) b')).toBe('a b')
  })

  it('keeps the label of a link and of a wiki-link', () => {
    expect(plainText('see [the doc](http://x) and [[phase-a|Phase A]]')).toBe(
      'see the doc and Phase A'
    )
  })
})

describe('matchEntry', () => {
  it('matches a term in the body', () => {
    const hit = matchEntry(entry(), ['work packages'])
    expect(hit).not.toBeNull()
    expect(hit!.where).toBe('body')
    expect(hit!.snippet).toContain('work packages')
  })

  it('matches a term in the title and ranks it above a body match', () => {
    const titleHit = matchEntry(entry(), ['solutions'])!
    const bodyHit = matchEntry(entry(), ['consolidate'])!
    expect(titleHit.where).toBe('title')
    expect(titleHit.score).toBeGreaterThan(bodyHit.score)
  })

  it('matches a tag', () => {
    expect(matchEntry(entry(), ['transition'])!.where).toBe('tag')
  })

  it('requires every term to match somewhere (AND, not OR)', () => {
    expect(matchEntry(entry(), ['gap', 'packages'])).not.toBeNull()
    expect(matchEntry(entry(), ['gap', 'nonexistent'])).toBeNull()
  })

  it('returns null for no terms', () => {
    expect(matchEntry(entry(), [])).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(matchEntry(entry(), ['CONSOLIDATE'])).not.toBeNull()
  })

  it('does not offer a snippet when only the title matched', () => {
    expect(matchEntry(entry({ body: '' }), ['solutions'])!.snippet).toBeNull()
  })
})

describe('snippetAround', () => {
  it('pads either side and marks the truncation', () => {
    const text = 'x'.repeat(200) + 'needle' + 'y'.repeat(200)
    const snippet = snippetAround(text, 'needle')!
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('needle')
    expect(snippet.length).toBeLessThan(text.length)
  })

  it('returns null when the term is absent', () => {
    expect(snippetAround('nothing here', 'needle')).toBeNull()
  })
})

describe('searchEntries', () => {
  const entries: SearchEntry[] = [
    entry(),
    entry({ boardId: 'concepts', id: 'gap', title: 'Gap', body: 'A statement of difference.' }),
    entry({ kind: 'character', id: 'phase-a', title: 'Phase A', tags: [], body: 'Architecture Vision.' })
  ]

  it('searches every board when boardIds is empty (#60)', () => {
    const hits = searchEntries(entries, 'difference', { boardIds: [] })
    expect(hits.map((h) => h.boardId)).toEqual(['concepts'])
  })

  it('restricts to the given boards', () => {
    expect(searchEntries(entries, 'difference', { boardIds: ['adm'] })).toEqual([])
  })

  it('restricts by kind', () => {
    const hits = searchEntries(entries, 'phase', { kinds: ['character'] })
    expect(hits.every((h) => h.kind === 'character')).toBe(true)
  })

  it('restricts by tag', () => {
    const hits = searchEntries(entries, 'phase', { tag: 'transition' })
    expect(hits.every((h) => h.tags.includes('transition'))).toBe(true)
  })

  it('returns everything in scope for an empty query', () => {
    expect(searchEntries(entries, '')).toHaveLength(3)
    expect(searchEntries(entries, '', { boardIds: ['adm'] })).toHaveLength(2)
  })

  it('honours the limit', () => {
    expect(searchEntries(entries, '', { limit: 2 })).toHaveLength(2)
  })

  it('orders title matches before body matches', () => {
    const hits = searchEntries(entries, 'gap')
    expect(hits[0].title).toBe('Gap')
  })
})

describe('highlightRuns', () => {
  it('splits into alternating hit and non-hit runs', () => {
    expect(highlightRuns('a gap here', ['gap'])).toEqual([
      { text: 'a ', hit: false },
      { text: 'gap', hit: true },
      { text: ' here', hit: false }
    ])
  })

  it('is case-insensitive but preserves the original casing', () => {
    expect(highlightRuns('A Gap', ['gap'])).toEqual([
      { text: 'A ', hit: false },
      { text: 'Gap', hit: true }
    ])
  })

  it('merges overlapping terms into one run', () => {
    expect(highlightRuns('gapped', ['gap', 'gapp'])).toEqual([
      { text: 'gapp', hit: true },
      { text: 'ed', hit: false }
    ])
  })

  it('returns one run when there are no terms', () => {
    expect(highlightRuns('unchanged', [])).toEqual([{ text: 'unchanged', hit: false }])
  })
})
