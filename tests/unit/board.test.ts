import { describe, it, expect } from 'vitest'
import type { Board, Character, Note, TimelineUnit } from '@shared/types'
import {
  visibleColumns,
  visibleRows,
  timelinePositions,
  resolveSpan,
  buildColumnLayout,
  buildRowLayout,
  buildBoardLayout,
  markerKey,
  reorderRowMember,
  reorderRowBlocks,
  orderedRowBlockKeys
} from '@renderer/components/board/grid-utils'

const timeline: TimelineUnit[] = [
  { id: 'ch1', label: 'S1', order: 1, group: 'Chapter 1' },
  { id: 'ch2', label: 'S2', order: 2, group: 'Chapter 1' },
  { id: 'ch3', label: 'S3', order: 3 },
  { id: 'ch4', label: 'S4', order: 4, group: 'Chapter 2' }
]
const chars: Character[] = [
  { id: 'a', type: 'character', name: 'Aria', colour: '#111', group: 'Fae' },
  { id: 'b', type: 'character', name: 'Bob', colour: '#222', group: 'Human' },
  { id: 'c', type: 'character', name: 'Cyra', colour: '#333', group: 'Fae' }
]
const board = (over: Partial<Board>): Board => ({
  id: 'b',
  name: 'B',
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
  ...over
})

describe('visibility + span (§8.2)', () => {
  const positions = timelinePositions(timeline)

  it('drops hidden columns but keeps order', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch3'] }), timeline)
    expect(vis.map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch4'])
  })

  it('stretches a span across a hidden middle column', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch3'] }), timeline)
    const span = resolveSpan('ch2', 'ch4', vis, positions)
    expect(span).toEqual({ startIdx: 1, endIdx: 2 })
  })

  it('anchors to the next visible column when the start is hidden', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch2'] }), timeline)
    const span = resolveSpan('ch2', 'ch4', vis, positions)
    expect(span && vis[span.startIdx].id).toBe('ch3')
  })

  it('returns null when the whole span is hidden', () => {
    const vis = visibleColumns(board({ hiddenCols: ['ch2'] }), timeline)
    expect(resolveSpan('ch2', 'ch2', vis, positions)).toBeNull()
  })

  it('orders rows by rowOrder then name, minus hidden', () => {
    const rows = visibleRows(board({ rowOrder: ['c', 'a'], hiddenRows: ['a'] }), chars)
    expect(rows.map((r) => r.id)).toEqual(['c', 'b'])
  })
})

describe('column grouping', () => {
  it('builds spanning group headers when expanded', () => {
    const layout = buildColumnLayout(board({}), timeline)
    expect(layout.slots).toHaveLength(4)
    expect(layout.headers[0]).toMatchObject({ group: 'Chapter 1', startIndex: 0, span: 2 })
    expect(layout.headers[1]).toMatchObject({ group: 'Chapter 2', startIndex: 3 })
  })

  it('collapses a group into one slot', () => {
    const layout = buildColumnLayout(board({ collapsedColGroups: ['Chapter 1'] }), timeline)
    expect(layout.slots).toHaveLength(3)
    expect(layout.slots[0].kind).toBe('colGroup')
    expect(layout.slotOfUnit.get('ch1')).toBe(0)
    expect(layout.slotOfUnit.get('ch2')).toBe(0)
    expect(layout.slotOfUnit.get('ch3')).toBe(1)
  })
})

describe('row grouping', () => {
  it('gathers all members of a group together', () => {
    const layout = buildRowLayout(board({}), chars)
    // groupHeader Fae, row a, row c, groupHeader Human, row b
    expect(layout.lines[0].kind).toBe('groupHeader')
    expect(layout.lineOfChar.get('a')).toBe(1)
    expect(layout.lineOfChar.get('c')).toBe(2)
    expect(layout.lineOfChar.get('b')).toBe(4)
  })

  it('collapses a group into a single groupRow', () => {
    const layout = buildRowLayout(board({ collapsedRowGroups: ['Fae'] }), chars)
    expect(layout.lines[0].kind).toBe('groupRow')
    expect(layout.lineOfChar.get('a')).toBe(0)
    expect(layout.lineOfChar.get('c')).toBe(0)
  })
})

describe('custom row + group sorting (issue #2)', () => {
  it('orders members within a group by rowOrder', () => {
    // default (name): Aria(a) before Cyra(c)
    const def = buildRowLayout(board({}), chars)
    expect(def.lineOfChar.get('a')! < def.lineOfChar.get('c')!).toBe(true)
    // rowOrder flips them
    const custom = buildRowLayout(board({ rowOrder: ['c', 'a'] }), chars)
    expect(custom.lineOfChar.get('c')! < custom.lineOfChar.get('a')!).toBe(true)
  })

  it('orders top-level blocks by rowGroupOrder', () => {
    const def = buildRowLayout(board({}), chars)
    expect(def.lines[0]).toMatchObject({ kind: 'groupHeader', group: 'Fae' })
    const custom = buildRowLayout(board({ rowGroupOrder: ['Human', 'Fae'] }), chars)
    expect(custom.lines[0]).toMatchObject({ kind: 'groupHeader', group: 'Human' })
  })

  it('lists ordered block keys', () => {
    expect(orderedRowBlockKeys(board({}), chars)).toEqual(['Fae', 'Human'])
  })

  it('reorderRowMember moves a member before its target within the group', () => {
    const next = reorderRowMember(board({}), chars, 'c', 'a')
    expect(next.indexOf('c')).toBeLessThan(next.indexOf('a'))
  })

  it('reorderRowMember is a no-op across groups', () => {
    const b = board({ rowOrder: ['x'] })
    expect(reorderRowMember(b, chars, 'a', 'b')).toEqual(['x'])
  })

  it('reorderRowBlocks reorders the block sequence', () => {
    expect(reorderRowBlocks(board({}), chars, 'Human', 'Fae')).toEqual(['Human', 'Fae'])
  })
})

describe('card placement + markers', () => {
  const notes: Note[] = [{ id: 'n1', uid: 'n_1111', title: 'Hunt', body: '' }]
  const card = { id: 'card1', noteUid: 'n_1111', rowId: 'a', colStart: 'ch3', colEnd: 'ch3' }

  it('renders a full card when nothing is collapsed', () => {
    const layout = buildBoardLayout(board({ cards: [card] }), chars, timeline, notes)
    expect(layout.fullCards).toHaveLength(1)
    expect(layout.markers.size).toBe(0)
  })

  it('shows a marker (no full card) when the row group is collapsed', () => {
    const layout = buildBoardLayout(
      board({ cards: [card], collapsedRowGroups: ['Fae'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.fullCards).toHaveLength(0)
    const line = layout.rows.lineOfChar.get('a')!
    const slot = layout.cols.slotOfUnit.get('ch3')!
    expect(layout.markers.get(markerKey(line, slot))).toBe(1)
  })

  it('shows a marker when the column group is collapsed', () => {
    const card2 = { id: 'card2', noteUid: 'n_1111', rowId: 'b', colStart: 'ch1', colEnd: 'ch1' }
    const layout = buildBoardLayout(
      board({ cards: [card2], collapsedColGroups: ['Chapter 1'] }),
      chars,
      timeline,
      notes
    )
    expect(layout.fullCards).toHaveLength(0)
    const line = layout.rows.lineOfChar.get('b')!
    expect(layout.markers.get(markerKey(line, 0))).toBe(1)
  })
})
