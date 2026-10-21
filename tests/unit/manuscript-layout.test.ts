import { describe, it, expect } from 'vitest'
import type { Board, Card, Character, ColumnGroup, Note, TimelineUnit } from '@shared/types'
import { MANUSCRIPT_ROW_ID } from '@shared/types'
import { buildBoardLayout, markerKey } from '@renderer/components/board/grid-utils'

/**
 * The Manuscript row on the board (Issue #204): line 0 above every other row,
 * one cell per column at the chosen level, each card spanning its cell as the
 * columns stand now — never as they stood when the card was made.
 */

// Chapter 1 holds s1–s2; Chapter 2 holds s3; a loose Epilogue sits at the top level.
const colGroups: ColumnGroup[] = [
  { id: 'ch-1', type: 'colgroup', label: 'Chapter 1', order: 1 },
  { id: 'ch-2', type: 'colgroup', label: 'Chapter 2', order: 2 }
]
const timeline: TimelineUnit[] = [
  { id: 's1', label: 'Scene 1', order: 1, parent: 'ch-1' },
  { id: 's2', label: 'Scene 2', order: 2, parent: 'ch-1' },
  { id: 's3', label: 'Scene 3', order: 1, parent: 'ch-2' },
  { id: 'epilogue', label: 'Epilogue', order: 3 }
]
const chars: Character[] = [
  { id: 'aeri', type: 'character', name: 'Aeri', colour: '#111' },
  { id: 'plot', type: 'character', name: 'The mystery', colour: '#222', rowKind: 'plot' }
]
const notes: Note[] = [
  { id: 'manuscript-chapter-1', uid: 'n_ms1', title: 'Chapter 1', body: '' },
  { id: 'a-scene', uid: 'n_a', title: 'A scene', body: '' }
]
const board = (over: Partial<Board> = {}): Board => ({
  id: 'main',
  name: 'Main',
  cards: [],
  hiddenRows: [],
  hiddenCols: [],
  presets: [],
  rowOrder: [],
  rowGroupOrder: [],
  colOrder: [],
  collapsedRowGroups: [],
  collapsedColGroups: [],
  zoom: 1,
  members: null,
  views: [],
  ...over
})

/** A Chapter 1 manuscript card, stored where Chapter 1 used to end. */
const msCard: Card = {
  id: 'm1',
  noteUid: 'n_ms1',
  rowId: MANUSCRIPT_ROW_ID,
  colStart: 's1',
  colEnd: 's1',
  cell: { kind: 'node', id: 'ch-1' }
}
const sceneCard: Card = { id: 'k1', noteUid: 'n_a', rowId: 'aeri', colStart: 's3', colEnd: 's3' }

// The chapters are the top level here, so level 0 is one cell per chapter.
const layout = (b: Board, level: number | null = 0, groups = colGroups, units = timeline) =>
  buildBoardLayout(b, chars, units, notes, groups, level)

describe('the Manuscript row (#204)', () => {
  it('is left out when the project has no level', () => {
    const l = layout(board({ cards: [msCard] }), null)
    expect(l.manuscript).toBeNull()
    expect(l.rows.lines.some((line) => line.kind === 'manuscript')).toBe(false)
    expect(l.fullCards).toHaveLength(0)
  })

  it('sits on line 0, above plot rows, pushing every other row down one', () => {
    const l = layout(board({ cards: [sceneCard] }))
    expect(l.rows.lines.map((line) => (line.kind === 'row' ? line.char.id : line.kind))).toEqual([
      'manuscript',
      'plot',
      'aeri'
    ])
    expect(l.rows.lines.map((line) => line.index)).toEqual([0, 1, 2])
    expect(l.rows.lineOfChar.get('aeri')).toBe(2)
    // A character's card follows its row down.
    expect(l.fullCards[0].lineIndex).toBe(2)
  })

  it('is hidden per board by its toolbar toggle', () => {
    const l = layout(board({ cards: [msCard], hideManuscriptRow: true }))
    expect(l.manuscript).toBeNull()
    expect(l.rows.lines[0].kind).toBe('row')
    expect(l.fullCards).toHaveLength(0)
  })

  it('lays out one cell per column at the level, each over its scenes', () => {
    const cells = layout(board()).manuscript!.cells
    expect(cells.map((c) => [c.key, c.startSlot, c.endSlot, c.label])).toEqual([
      ['node:ch-1', 0, 1, 'Chapter 1'],
      ['node:ch-2', 2, 2, 'Chapter 2'],
      ['unit:epilogue', 3, 3, 'Epilogue']
    ])
    expect(cells.every((c) => !c.folded && !c.filled)).toBe(true)
  })

  it('spans a card across its whole cell, not where it was stored', () => {
    const l = layout(board({ cards: [msCard] }))
    const pc = l.fullCards.find((p) => p.card.id === 'm1')!
    expect([pc.lineIndex, pc.startSlot, pc.endSlot]).toEqual([0, 0, 1])
    expect(pc.note?.id).toBe('manuscript-chapter-1')
    expect(pc.colour).toBe('var(--manuscript-colour)')
    expect(l.manuscript!.cells[0].filled).toBe(true)
    expect(l.manuscript!.cells[1].filled).toBe(false)
  })

  it('follows the chapter when a scene moves into it', () => {
    // Scene 3 moves from Chapter 2 into Chapter 1; Chapter 2 is left empty.
    const moved = timeline.map((u) => (u.id === 's3' ? { ...u, parent: 'ch-1', order: 3 } : u))
    const l = layout(board({ cards: [msCard] }), 0, colGroups, moved)
    const pc = l.fullCards.find((p) => p.card.id === 'm1')!
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 2])
    expect(l.manuscript!.cells.map((c) => c.key)).toEqual(['node:ch-1', 'unit:epilogue'])
  })

  it('does not draw a card whose cell is not at the current level, but keeps it', () => {
    // At scene level Chapter 1 is no longer a cell; its card stays on the board, undrawn.
    const b = board({ cards: [msCard] })
    const l = layout(b, 1)
    expect(l.fullCards).toHaveLength(0)
    expect(l.manuscript!.cells.map((c) => c.key)).toEqual([
      'unit:s1',
      'unit:s2',
      'unit:s3',
      'unit:epilogue'
    ])
    expect(b.cards).toContain(msCard)
  })

  it('ignores a manuscript card with no cell', () => {
    const stray: Card = { ...msCard, id: 'm2', cell: undefined }
    expect(layout(board({ cards: [stray] })).fullCards).toHaveLength(0)
  })

  it('narrows a cell to its visible columns and drops one that is all hidden', () => {
    const l = layout(board({ cards: [msCard], hiddenCols: ['s1', 's3'] }))
    expect(l.manuscript!.cells.map((c) => [c.key, c.startSlot, c.endSlot])).toEqual([
      ['node:ch-1', 0, 0],
      ['unit:epilogue', 1, 1]
    ])
    const pc = l.fullCards.find((p) => p.card.id === 'm1')!
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 0])
  })

  it('folds a cell into its collapsed group, shown as a lone card', () => {
    const l = layout(board({ cards: [msCard], collapsedColGroups: ['ch-1'] }))
    const cell = l.manuscript!.cells[0]
    expect([cell.startSlot, cell.endSlot, cell.folded]).toEqual([0, 0, true])
    expect(l.fullCards).toHaveLength(0)
    expect(l.loneCards.map((p) => [p.card.id, p.lineIndex, p.startSlot])).toEqual([['m1', 0, 0]])
    expect(l.markers.get(markerKey(0, 0))).toBe(1)
    expect(l.manuscript!.coveredSlots.size).toBe(0)
  })

  it('draws a wider cell across a collapsed group inside it', () => {
    // A Novel-level cell over a collapsed Chapter: the cell stays whole.
    const groups: ColumnGroup[] = [
      { id: 'novel', type: 'colgroup', label: 'Novel', order: 1 },
      ...colGroups.map((g) => ({ ...g, parent: 'novel' }))
    ]
    const units = timeline.map((u) => (u.id === 'epilogue' ? { ...u, parent: 'novel' } : u))
    const novelCard: Card = { ...msCard, cell: { kind: 'node', id: 'novel' } }
    const l = layout(board({ cards: [novelCard], collapsedColGroups: ['ch-1'] }), 0, groups, units)
    const cell = l.manuscript!.cells[0]
    // Slots: [collapsed Chapter 1] [s3] [epilogue]
    expect([cell.key, cell.startSlot, cell.endSlot, cell.folded]).toEqual(['node:novel', 0, 2, false])
    expect([...l.manuscript!.coveredSlots]).toEqual([0])
    const pc = l.fullCards.find((p) => p.card.id === 'm1')!
    expect([pc.startSlot, pc.endSlot]).toEqual([0, 2])
    expect(l.loneCards).toHaveLength(0)
  })
})
