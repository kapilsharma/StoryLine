import { describe, it, expect } from 'vitest'
import type { BoardData } from '@shared/ipc'
import type { Board, Card, ColumnGroup, Note, TimelineUnit } from '@shared/types'
import {
  MANUSCRIPT_ROW_ID,
  cellKey,
  isManuscriptCard,
  manuscriptCells,
  manuscriptLevel,
  withoutManuscript
} from '@shared/manuscript'

/**
 * The Manuscript row's model (Issue #204): which columns are its cells at a
 * level, and what a published site keeps when the draft is left out.
 */

// Novel › Part One › Chapter 1 (s1, s2), Chapter 2 (no scenes: a unit at depth 2),
//         Part Two  › Chapter 3 (s3)
// plus an Epilogue unit straight under the Novel, and an empty group.
const colGroups: ColumnGroup[] = [
  { id: 'novel', type: 'colgroup', label: 'Novel', order: 1 },
  { id: 'part-1', type: 'colgroup', label: 'Part One', parent: 'novel', order: 1 },
  { id: 'part-2', type: 'colgroup', label: 'Part Two', parent: 'novel', order: 2 },
  { id: 'ch-1', type: 'colgroup', label: 'Chapter 1', parent: 'part-1', order: 1 },
  { id: 'ch-3', type: 'colgroup', label: 'Chapter 3', parent: 'part-2', order: 1 },
  { id: 'empty', type: 'colgroup', label: 'Empty', parent: 'part-2', order: 2 }
]
const timeline: TimelineUnit[] = [
  { id: 's1', label: 'Scene 1', order: 1, parent: 'ch-1' },
  { id: 's2', label: 'Scene 2', order: 2, parent: 'ch-1' },
  { id: 'ch-2', label: 'Chapter 2', order: 2, parent: 'part-1' },
  { id: 's3', label: 'Scene 3', order: 1, parent: 'ch-3' },
  { id: 'epilogue', label: 'Epilogue', order: 3, parent: 'novel' }
]

const cells = (level: number): Array<[string, string[]]> =>
  manuscriptCells(colGroups, timeline, level).map((c) => [cellKey(c.ref), c.unitIds])

describe('manuscriptLevel', () => {
  it('reads a whole number at or above zero', () => {
    expect(manuscriptLevel({ manuscriptLevel: 0 })).toBe(0)
    expect(manuscriptLevel({ manuscriptLevel: 2 })).toBe(2)
  })

  it('treats absent or nonsense as no Manuscript row', () => {
    expect(manuscriptLevel({})).toBeNull()
    expect(manuscriptLevel({ manuscriptLevel: -1 })).toBeNull()
    expect(manuscriptLevel({ manuscriptLevel: 1.5 })).toBeNull()
    expect(manuscriptLevel({ manuscriptLevel: '1' as unknown as number })).toBeNull()
  })
})

describe('cellKey / isManuscriptCard', () => {
  it('keys a cell by kind as well as id, since ids are unique only within a kind', () => {
    expect(cellKey({ kind: 'node', id: 'ch-2' })).not.toBe(cellKey({ kind: 'unit', id: 'ch-2' }))
  })

  it('knows a Manuscript-row card by its row', () => {
    expect(isManuscriptCard({ rowId: MANUSCRIPT_ROW_ID })).toBe(true)
    expect(isManuscriptCard({ rowId: 'aeri' })).toBe(false)
  })
})

describe('manuscriptCells', () => {
  it('makes the top level one cell per Novel, spanning everything under it', () => {
    expect(cells(0)).toEqual([['node:novel', ['s1', 's2', 'ch-2', 's3', 'epilogue']]])
  })

  it('cuts at the chosen depth, keeping a shallower column with nothing under it', () => {
    // Depth 1: the Parts — and the Epilogue, a unit that never goes deeper.
    expect(cells(1)).toEqual([
      ['node:part-1', ['s1', 's2', 'ch-2']],
      ['node:part-2', ['s3']],
      ['unit:epilogue', ['epilogue']]
    ])
  })

  it('treats a chapter with no scenes as a cell of its own', () => {
    // Depth 2: Chapter 1 (a group) beside Chapter 2 (a unit); the empty group is no cell.
    expect(cells(2)).toEqual([
      ['node:ch-1', ['s1', 's2']],
      ['unit:ch-2', ['ch-2']],
      ['node:ch-3', ['s3']],
      ['unit:epilogue', ['epilogue']]
    ])
  })

  it('makes every unit a cell when the level is deeper than the tree', () => {
    expect(cells(9).map(([key]) => key)).toEqual([
      'unit:s1',
      'unit:s2',
      'unit:ch-2',
      'unit:s3',
      'unit:epilogue'
    ])
  })

  it('names each cell after its column', () => {
    expect(manuscriptCells(colGroups, timeline, 2).map((c) => c.label)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
      'Epilogue'
    ])
  })

  it('covers every unit exactly once at any level', () => {
    for (let level = 0; level < 5; level++) {
      const units = manuscriptCells(colGroups, timeline, level).flatMap((c) => c.unitIds)
      expect(units.sort()).toEqual(timeline.map((u) => u.id).sort())
    }
  })

  it('works on a flat board', () => {
    const flat: TimelineUnit[] = [
      { id: 'a', label: 'A', order: 1 },
      { id: 'b', label: 'B', order: 2 }
    ]
    expect(manuscriptCells([], flat, 0).map((c) => cellKey(c.ref))).toEqual(['unit:a', 'unit:b'])
  })
})

describe('withoutManuscript', () => {
  const card = (id: string, rowId: string, noteUid: string): Card => ({
    id,
    noteUid,
    rowId,
    colStart: 's1',
    colEnd: 's1'
  })
  const note = (uid: string | undefined, id: string): Note => ({ id, uid, title: id, body: '' })
  const data = (cards: Card[], notes: Note[]): BoardData => ({
    board: { id: 'main', name: 'Main', cards } as Board,
    characters: [],
    timeline,
    colGroups,
    notes,
    views: [],
    problems: []
  })

  it('returns the board untouched when it has no manuscript', () => {
    const d = data([card('c1', 'aeri', 'n_1')], [note('n_1', 'plan')])
    expect(withoutManuscript(d)).toBe(d)
  })

  it('drops the Manuscript-row cards and the notes only they point at', () => {
    const d = data(
      [card('c1', 'aeri', 'n_1'), card('m1', MANUSCRIPT_ROW_ID, 'n_2')],
      [note('n_1', 'plan'), note('n_2', 'manuscript-chapter-1'), note(undefined, 'legacy')]
    )
    const out = withoutManuscript(d)
    expect(out.board.cards.map((c) => c.id)).toEqual(['c1'])
    expect(out.notes.map((n) => n.id)).toEqual(['plan', 'legacy'])
  })

  it('keeps a note another card still uses', () => {
    const d = data(
      [card('c1', 'aeri', 'n_1'), card('m1', MANUSCRIPT_ROW_ID, 'n_1')],
      [note('n_1', 'shared')]
    )
    const out = withoutManuscript(d)
    expect(out.board.cards.map((c) => c.id)).toEqual(['c1'])
    expect(out.notes.map((n) => n.id)).toEqual(['shared'])
  })
})
