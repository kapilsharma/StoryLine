import { describe, it, expect } from 'vitest'
import type { Card, Character, ColumnGroup, Note, TimelineUnit } from '@shared/types'
import {
  buildMarkdownExport,
  shiftHeadings,
  type MarkdownExportInput,
  type MarkdownExportOptions
} from '@shared/exportMarkdown'

const g = (id: string, order: number, parent?: string, label = id): ColumnGroup => ({
  id,
  type: 'colgroup',
  label,
  order,
  ...(parent ? { parent } : {})
})
const u = (id: string, order: number, parent?: string, label = id): TimelineUnit => ({
  id,
  label,
  order,
  ...(parent ? { parent } : {})
})
const row = (id: string, name: string, plot = false): Character => ({
  id,
  type: 'character',
  name,
  colour: '#000',
  ...(plot ? { rowKind: 'plot' as const } : {})
})
const card = (id: string, rowId: string, noteUid: string, col: string): Card => ({
  id,
  noteUid,
  rowId,
  colStart: col,
  colEnd: col
})
const note = (uid: string, title: string, body = ''): Note => ({
  id: uid,
  uid,
  title,
  body
})

/** A board with a tiny Novel ▸ Chapter ▸ Scene tree and one plot row. */
function fixture(over: Partial<MarkdownExportInput> = {}): MarkdownExportInput {
  return {
    boardName: 'My Novel',
    colGroups: [g('novel', 1, undefined, 'Book One'), g('ch1', 1, 'novel', 'Chapter 1')],
    timeline: [
      u('s1', 1, 'ch1', 'Opening'),
      u('s2', 2, 'ch1', 'The Call'),
      u('s3', 2, undefined, 'Epilogue')
    ],
    characters: [row('hero', 'Hero'), row('arc', 'The Mystery', true)],
    cards: [
      card('c1', 'arc', 'n1', 's2'),
      card('c2', 'arc', 'n2', 's1') // out of column order on purpose
    ],
    notes: [note('n1', 'Clue dropped', 'A clue is dropped.'), note('n2', 'Setup', 'The setup.')],
    groupBodies: { novel: 'About the whole book.', ch1: '' },
    unitBodies: { s1: 'The opening scene note.', s2: '', s3: 'Wrap it all up.' },
    ...over
  }
}

const opts = (over: Partial<MarkdownExportOptions> = {}): MarkdownExportOptions => ({
  scenes: true,
  plotRows: false,
  includeNotes: true,
  ...over
})

describe('buildMarkdownExport', () => {
  it('always opens with the board name as an h1', () => {
    const md = buildMarkdownExport(fixture(), opts())
    expect(md.startsWith('# My Novel\n')).toBe(true)
  })

  it('walks the column tree depth-first, heading level tracking depth', () => {
    const md = buildMarkdownExport(fixture(), opts({ includeNotes: false }))
    const headings = md.split('\n\n').map((b) => b.trimEnd()).filter((b) => b.startsWith('#'))
    expect(headings).toEqual([
      '# My Novel',
      '## Scenes',
      '### Book One',
      '#### Chapter 1',
      '##### Opening',
      '##### The Call',
      '### Epilogue'
    ])
  })

  it('includes tier and scene note bodies only when includeNotes is on', () => {
    const withNotes = buildMarkdownExport(fixture(), opts({ includeNotes: true }))
    expect(withNotes).toContain('About the whole book.')
    expect(withNotes).toContain('The opening scene note.')
    expect(withNotes).toContain('Wrap it all up.')

    const outline = buildMarkdownExport(fixture(), opts({ includeNotes: false }))
    expect(outline).not.toContain('About the whole book.')
    expect(outline).not.toContain('The opening scene note.')
  })

  it('skips empty note bodies, leaving a clean heading', () => {
    const md = buildMarkdownExport(fixture(), opts({ includeNotes: true }))
    // s2 "The Call" has an empty unitBody — its heading is immediately followed
    // by the next heading, not a blank body block.
    expect(md).toContain('##### The Call\n\n### Epilogue')
  })

  it('orders a plot row’s cards by column, titled by their note, scene appended', () => {
    const md = buildMarkdownExport(fixture(), opts({ scenes: false, plotRows: true }))
    const headings = md.split('\n\n').map((b) => b.trimEnd()).filter((b) => b.startsWith('#'))
    expect(headings).toEqual([
      '# My Novel',
      '## Plot rows',
      '### The Mystery',
      '#### Setup — Opening', // n2 @ s1 comes first despite being listed second
      '#### Clue dropped — The Call'
    ])
  })

  it('emits plot-card note bodies only when includeNotes is on', () => {
    const full = buildMarkdownExport(fixture(), opts({ scenes: false, plotRows: true }))
    expect(full).toContain('A clue is dropped.')
    const outline = buildMarkdownExport(
      fixture(),
      opts({ scenes: false, plotRows: true, includeNotes: false })
    )
    expect(outline).not.toContain('A clue is dropped.')
    expect(outline).toContain('#### Clue dropped — The Call')
  })

  it('treats only rowKind:plot rows as plot rows', () => {
    const md = buildMarkdownExport(fixture(), opts({ scenes: false, plotRows: true }))
    expect(md).toContain('### The Mystery')
    expect(md).not.toContain('### Hero')
  })

  it('can export both sections into one document', () => {
    const md = buildMarkdownExport(fixture(), opts({ scenes: true, plotRows: true }))
    expect(md.indexOf('## Scenes')).toBeGreaterThan(0)
    expect(md.indexOf('## Plot rows')).toBeGreaterThan(md.indexOf('## Scenes'))
  })

  it('notes an empty section rather than leaving a bare header', () => {
    const empty = fixture({ colGroups: [], timeline: [], characters: [], cards: [] })
    const md = buildMarkdownExport(empty, opts({ scenes: true, plotRows: true }))
    expect(md).toContain('## Scenes\n\n_No scenes yet._')
    expect(md).toContain('## Plot rows\n\n_No plot rows yet._')
  })

  it('caps heading depth at six #', () => {
    const deep = fixture({
      colGroups: [g('a', 1), g('b', 1, 'a'), g('c', 1, 'b'), g('d', 1, 'c')],
      timeline: [u('leaf', 1, 'd', 'Deep scene')],
      cards: [],
      characters: []
    })
    const md = buildMarkdownExport(deep, opts({ includeNotes: false }))
    // a=###(3) b=####(4) c=#####(5) d=######(6) leaf would be depth 4 → clamp 6
    expect(md).toContain('###### Deep scene')
    expect(md).not.toContain('####### ')
  })

  it('falls back to (untitled) when a card’s note is missing', () => {
    const md = buildMarkdownExport(
      fixture({ notes: [] }),
      opts({ scenes: false, plotRows: true })
    )
    expect(md).toContain('#### (untitled) — Opening')
  })

  it('ends with a single trailing newline', () => {
    const md = buildMarkdownExport(fixture(), opts())
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })

  it('drops the ## Notes / ## Research seed skeleton as empty', () => {
    const skeleton = '\n## Notes\n\n\n## Research\n\n'
    const md = buildMarkdownExport(
      fixture({ unitBodies: { s1: skeleton, s2: skeleton, s3: skeleton }, groupBodies: {} }),
      opts({ includeNotes: true })
    )
    expect(md).not.toContain('Notes')
    expect(md).not.toContain('Research')
    // The scene headings themselves still appear.
    expect(md).toContain('##### Opening')
  })

  it('re-bases a scene note’s headings to sit under the scene', () => {
    // One-level project: a leaf scene lands at ### (depth 0 → level 3), so its
    // body’s top heading should become ####.
    const md = buildMarkdownExport(
      fixture({
        colGroups: [],
        timeline: [u('only', 1, undefined, 'Lone scene')],
        cards: [],
        characters: [],
        unitBodies: { only: '# Big beat\n\nsome prose\n\n## Smaller' }
      }),
      opts({ includeNotes: true })
    )
    expect(md).toContain('### Lone scene')
    expect(md).toContain('#### Big beat')
    expect(md).toContain('##### Smaller')
    expect(md).not.toMatch(/^# Big beat$/m) // the un-shifted H1 is gone
  })
})

describe('shiftHeadings', () => {
  it('re-bases the shallowest heading to parentLevel + 1, keeping structure', () => {
    const out = shiftHeadings('# A\n## B\n### C', 3)
    expect(out).toBe('#### A\n##### B\n###### C')
  })

  it('promotes when the body starts deeper than the target', () => {
    expect(shiftHeadings('#### A\n##### B', 2)).toBe('### A\n#### B')
  })

  it('clamps at H6', () => {
    expect(shiftHeadings('# A\n## B\n### C', 5)).toBe('###### A\n###### B\n###### C')
  })

  it('leaves bodies with no headings untouched', () => {
    expect(shiftHeadings('just prose\nmore prose', 3)).toBe('just prose\nmore prose')
  })

  it('does not touch # inside fenced code blocks', () => {
    const body = '# Heading\n\n```bash\n# not a heading\n```\n'
    expect(shiftHeadings(body, 3)).toBe('#### Heading\n\n```bash\n# not a heading\n```\n')
  })
})
