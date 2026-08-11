import { describe, expect, it } from 'vitest'
import type { Board, Character, View } from '@shared/types'
import { buildGraph } from '@shared/graph'
import { filterSelection, nonMembers, viewMembers } from '@shared/selection'
import {
  addBoardMember,
  boardMembers,
  nonMembers as boardNonMembers,
  removeBoardMember,
  visibleRows,
  withMaterializedMembers
} from '@renderer/components/board/grid-utils'
import { layoutTree } from '@renderer/components/tree/layout'
import { nuclear, person, view } from '../family-fixtures'

/**
 * Opt-in membership (Issue 29, second half).
 *
 * A character file existing used to mean "on the board and on every tree", which
 * made it impossible to enter a relative purely for family-tree context. Now both
 * the board and each tree carry an explicit list.
 *
 * The property these tests are really protecting is the `null` case: absent
 * membership must keep meaning "everyone", or upgrading empties every board and
 * every tree in every existing project.
 */

const board = (patch: Partial<Board> = {}): Board => ({
  id: 'main',
  name: 'Main Board',
  cards: [],
  hiddenRows: [],
  hiddenCols: [],
  presets: [],
  members: [],
  rowOrder: [],
  rowGroupOrder: [],
  colOrder: [],
  collapsedRowGroups: [],
  collapsedColGroups: [],
  zoom: 1,
  views: [],
  ...patch
})

const ids = (cs: Character[]): string[] => cs.map((c) => c.id)

describe('board membership', () => {
  it('draws only its members', () => {
    const b = board({ members: ['dad', 'mum'] })
    expect(ids(boardMembers(b, nuclear))).toEqual(['dad', 'mum'])
  })

  it('treats absent membership as everyone, so no existing board empties', () => {
    const b = board({ members: null })
    expect(ids(boardMembers(b, nuclear)).sort()).toEqual(ids(nuclear).sort())
    // And nothing is offered to add, because everyone is already on.
    expect(boardNonMembers(b, nuclear)).toEqual([])
  })

  it('keeps `[]` distinct from absent — an emptied board stays empty', () => {
    expect(boardMembers(board({ members: [] }), nuclear)).toEqual([])
    expect(ids(boardNonMembers(board({ members: [] }), nuclear)).sort()).toEqual(ids(nuclear).sort())
  })

  it('honours rowOrder for members and appends the rest by name', () => {
    const b = board({ members: ['kid-c', 'dad', 'kid-a'], rowOrder: ['kid-c'] })
    // rowOrder first, then the remaining members alphabetically by name.
    expect(ids(boardMembers(b, nuclear))).toEqual(['kid-c', 'dad', 'kid-a'])
  })

  it('ignores a member whose character has been deleted', () => {
    const b = board({ members: ['dad', 'ghost-id'] })
    expect(ids(boardMembers(b, nuclear))).toEqual(['dad'])
  })

  it('counts a hidden row as a member — hiding is temporary, membership is not', () => {
    const b = board({ members: ['dad', 'mum'], hiddenRows: ['mum'] })
    expect(ids(boardMembers(b, nuclear))).toEqual(['dad', 'mum'])
    expect(ids(visibleRows(b, nuclear))).toEqual(['dad'])
  })

  it('materializes a legacy board on the first curating action, preserving its rows', () => {
    const legacy = board({ members: null, rowOrder: ['mum'] })
    const next = withMaterializedMembers(legacy, nuclear)
    // Exactly today's rows, in today's order — the conversion is invisible.
    expect(next.members).toEqual(ids(boardMembers(legacy, nuclear)))
    expect(ids(boardMembers(next, nuclear))).toEqual(ids(boardMembers(legacy, nuclear)))
  })

  it('adds a character without disturbing the others', () => {
    const b = board({ members: ['dad'] })
    expect(addBoardMember(b, nuclear, 'mum').members).toEqual(['dad', 'mum'])
    // Idempotent: adding someone already on is a no-op.
    expect(addBoardMember(b, nuclear, 'dad').members).toEqual(['dad'])
  })

  it('adding to a legacy board converts it rather than doing nothing', () => {
    // Everyone is already a row, so the only visible change is that the board
    // now has an explicit list — which is what stops the *next* character
    // appearing uninvited.
    const next = addBoardMember(board({ members: null }), nuclear, 'dad')
    expect(next.members).toEqual(ids(boardMembers(board({ members: null }), nuclear)))
  })

  it('removing a character takes their cards and order entries with them', () => {
    const b = board({
      members: ['dad', 'mum'],
      rowOrder: ['dad', 'mum'],
      rowGroupOrder: ['dad', 'mum'],
      hiddenRows: ['dad'],
      cards: [
        { id: 'c1', noteUid: 'n_1', rowId: 'dad', colStart: 'ch1', colEnd: 'ch1' },
        { id: 'c2', noteUid: 'n_2', rowId: 'mum', colStart: 'ch1', colEnd: 'ch1' }
      ]
    })
    const next = removeBoardMember(b, nuclear, 'dad')
    expect(next.members).toEqual(['mum'])
    expect(next.cards.map((c) => c.id)).toEqual(['c2'])
    expect(next.rowOrder).toEqual(['mum'])
    expect(next.rowGroupOrder).toEqual(['mum'])
    expect(next.hiddenRows).toEqual([])
  })
})

describe('tree membership', () => {
  const graph = buildGraph(nuclear)

  it('draws exactly its members', () => {
    const v = view({ members: ['dad', 'mum'] })
    expect([...viewMembers(graph, v)].sort()).toEqual(['dad', 'mum'])
    expect(layoutTree(graph, v).nodes.map((n) => n.id).sort()).toEqual(['dad', 'mum'])
  })

  it('falls back to the filters when membership is absent', () => {
    const v = view({ members: null })
    expect([...viewMembers(graph, v)].sort()).toEqual(ids(nuclear).sort())
  })

  it('an empty list means an empty tree, not a full one', () => {
    const v = view({ members: [] })
    expect(viewMembers(graph, v).size).toBe(0)
    expect(layoutTree(graph, v).nodes).toEqual([])
  })

  it('members win over the filters — a curated tree does not re-filter itself', () => {
    // The filters would select only the root's line; membership says otherwise.
    const v = view({ members: ['kid-a'], root: 'dad', childDepth: 0 })
    expect([...viewMembers(graph, v)]).toEqual(['kid-a'])
  })

  it('still honours `hidden` on top of membership', () => {
    const v = view({ members: ['dad', 'mum'], hidden: ['mum'] })
    expect([...viewMembers(graph, v)]).toEqual(['dad'])
  })

  it('ignores a member who no longer exists', () => {
    const v = view({ members: ['dad', 'deleted-person'] })
    expect([...viewMembers(graph, v)]).toEqual(['dad'])
  })

  it('falls back to the arrangement for a view arranged before membership existed', () => {
    const v = view({
      members: null,
      arranged: true,
      overrides: { dad: { x: 0, y: 0 }, mum: { x: 10, y: 0 } }
    })
    expect([...viewMembers(graph, v)].sort()).toEqual(['dad', 'mum'])
  })

  it('offers the people who are off the tree, excluding ghosts', () => {
    const withGhost = buildGraph([...nuclear, person('orphan', 'female', { father: 'missing-dad' })])
    const v = view({ members: ['dad'] })
    const offered = nonMembers(withGhost, v)
    expect(offered).toContain('mum')
    expect(offered).toContain('orphan')
    // `missing-dad` is a synthesised placeholder, not a character you can add.
    expect(offered).not.toContain('missing-dad')
    expect(offered).not.toContain('dad')
  })

  it('filterSelection describes the filters, whatever the current members are', () => {
    const v = view({ members: ['kid-a'], root: 'dad', childDepth: 0 })
    // Root plus their spouse — not the stored single member.
    expect(filterSelection(graph, v)).toEqual(['dad', 'mum'])
  })

  it('filterSelection drops ghosts, so "Select these" cannot pin a placeholder', () => {
    const withGhost = buildGraph([...nuclear, person('orphan', 'female', { father: 'missing-dad' })])
    expect(filterSelection(withGhost, view({ members: null }))).not.toContain('missing-dad')
  })
})

describe('membership and the rest of a view', () => {
  const graph = buildGraph(nuclear)

  it('a member with no stored position is still laid out automatically', () => {
    // Arranged tree, one member never dragged: the engine has to place them
    // rather than dropping them, or "+ Add person" on an arranged tree is broken.
    const v: View = view({
      members: ['dad', 'mum'],
      arranged: true,
      overrides: { dad: { x: 100, y: 200 } }
    })
    const nodes = layoutTree(graph, v).nodes
    expect(nodes.map((n) => n.id).sort()).toEqual(['dad', 'mum'])
    const dad = nodes.find((n) => n.id === 'dad')!
    expect({ x: dad.x, y: dad.y, pinned: dad.pinned }).toEqual({ x: 100, y: 200, pinned: true })
  })

  it('drops a member the collapse rules exclude, without dropping the collapser', () => {
    const v = view({ members: ids(nuclear), collapsed: ['dad'] })
    const shown = layoutTree(graph, v).nodes.map((n) => n.id)
    expect(shown).toContain('dad')
    expect(shown).not.toContain('kid-a')
  })
})
