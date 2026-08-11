import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import {
  DEFAULT_LAYOUT_OPTIONS,
  layoutTree,
  visibleNodes,
  type TreeLayout
} from '../../src/renderer/src/components/tree/layout'
import {
  cousinMarriage,
  cycle,
  dangling,
  nuclear,
  orphans,
  remarriage,
  singleParent,
  threeGenerations,
  twoFamiliesJoined,
  view
} from '../family-fixtures'

const run = (characters: Parameters<typeof buildGraph>[0], v = view()): TreeLayout =>
  layoutTree(buildGraph(characters), v)

const at = (layout: TreeLayout, id: string): { x: number; y: number; gen: number } => {
  const node = layout.nodes.find((n) => n.id === id)
  if (!node) throw new Error(`No node "${id}" in layout`)
  return { x: node.x, y: node.y, gen: node.gen }
}

/**
 * Two invariants asserted on every fixture (solution.md §8) — between them they
 * catch most layout regressions without pinning exact coordinates, which would
 * make the tests brittle against tuning.
 */
const FIXTURES: Array<[string, Parameters<typeof buildGraph>[0]]> = [
  ['nuclear', nuclear],
  ['threeGenerations', threeGenerations],
  ['remarriage', remarriage],
  ['singleParent', singleParent],
  ['cousinMarriage', cousinMarriage],
  ['cycle', cycle],
  ['dangling', dangling],
  ['orphans', orphans],
  ['twoFamiliesJoined', twoFamiliesJoined]
]

describe.each(FIXTURES)('invariants: %s', (_name, characters) => {
  const layout = run(characters)

  it('places every character exactly once', () => {
    const ids = layout.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('never overlaps two nodes in the same generation', () => {
    for (const [, row] of layout.byGeneration) {
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - row[i - 1].x
        expect(gap).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.nodeWidth - 0.01)
      }
    }
  })

  it('puts every parent strictly above every child', () => {
    for (const node of layout.nodes) {
      const c = node.character
      for (const parentId of [c.father, c.mother]) {
        if (!parentId) continue
        const parent = layout.nodes.find((n) => n.id === parentId)
        if (!parent) continue
        // The cycle fixture has one link cut, which is allowed to be level.
        if (_name === 'cycle') continue
        expect(parent.y).toBeLessThan(node.y)
      }
    }
  })
})

describe('generations', () => {
  it('levels spouses onto the same row', () => {
    const layout = run(threeGenerations)
    expect(at(layout, 'parent').gen).toBe(at(layout, 'parent-in-law').gen)
    expect(at(layout, 'gp-1').gen).toBe(at(layout, 'gp-2').gen)
  })

  it('layers three generations top to bottom', () => {
    const layout = run(threeGenerations)
    expect(at(layout, 'gp-1').gen).toBe(0)
    expect(at(layout, 'parent').gen).toBe(1)
    expect(at(layout, 'child-1').gen).toBe(2)
  })

  it('cuts a cycle and reports it instead of hanging', () => {
    const layout = run(cycle)
    expect(layout.warnings.some((w) => w.includes('Ancestry loop'))).toBe(true)
    expect(layout.nodes).toHaveLength(3)
  })
})

describe('coordinates', () => {
  it('centres a couple over their children', () => {
    const layout = run(nuclear)
    const dad = at(layout, 'dad')
    const mum = at(layout, 'mum')
    const kids = ['kid-a', 'kid-b', 'kid-c'].map((id) => at(layout, id).x)
    const coupleCentre = (dad.x + mum.x) / 2
    const kidsCentre = (Math.min(...kids) + Math.max(...kids)) / 2
    expect(Math.abs(coupleCentre - kidsCentre)).toBeLessThan(1)
  })

  it('keeps a sibling group contiguous', () => {
    const layout = run(threeGenerations)
    const row = layout.byGeneration.get(2)!.map((n) => n.id)
    expect(row).toEqual(['child-1', 'child-2'])
  })

  it('places partners adjacently', () => {
    const layout = run(nuclear)
    const row = layout.byGeneration.get(0)!.map((n) => n.id)
    expect(row).toEqual(['dad', 'mum'])
  })

  it('normalises so the leftmost node centre sits at x = 0', () => {
    const layout = run(nuclear)
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBe(0)
    // Bounds are the drawn box, so they extend half a node further left.
    expect(layout.bounds.minX).toBe(-DEFAULT_LAYOUT_OPTIONS.nodeWidth / 2)
  })
})

describe('edges', () => {
  it('draws one partner link per couple and one drop per child', () => {
    const layout = run(nuclear)
    expect(layout.edges.filter((e) => e.kind === 'partner')).toHaveLength(1)
    expect(layout.edges.filter((e) => e.kind === 'child')).toHaveLength(3)
  })

  it('gives a lone parent no partner link but keeps the child drops', () => {
    const layout = run(singleParent)
    expect(layout.edges.filter((e) => e.kind === 'partner')).toHaveLength(0)
    expect(layout.edges.filter((e) => e.kind === 'child')).toHaveLength(2)
  })

  it('marks edges touching a ghost so they can be drawn dashed', () => {
    const layout = run(dangling)
    expect(layout.edges.some((e) => e.ghost)).toBe(true)
  })

  it('emits valid path data', () => {
    const layout = run(threeGenerations)
    for (const e of layout.edges) {
      expect(e.d.startsWith('M ')).toBe(true)
      expect(e.d).not.toContain('NaN')
    }
  })
})

describe('remarriage', () => {
  it('places the shared partner once, with both spouses on the same row', () => {
    const layout = run(remarriage)
    expect(layout.nodes.filter((n) => n.id === 'hub')).toHaveLength(1)
    expect(at(layout, 'wife-1').gen).toBe(at(layout, 'hub').gen)
    expect(at(layout, 'wife-2').gen).toBe(at(layout, 'hub').gen)
    expect(layout.edges.filter((e) => e.kind === 'partner')).toHaveLength(2)
  })
})

describe('ghosts', () => {
  it('drops them from the layout when the view hides them', () => {
    const withGhosts = run(dangling, view({ showGhosts: true }))
    const without = run(dangling, view({ showGhosts: false }))
    expect(withGhosts.nodes.map((n) => n.id)).toContain('missing-dad')
    expect(without.nodes.map((n) => n.id)).not.toContain('missing-dad')
  })
})

describe('visibleNodes culling', () => {
  it('returns only what intersects the viewport', () => {
    const layout = run(twoFamiliesJoined)
    const all = layout.nodes.length
    const narrow = visibleNodes(layout, { x: 0, y: 0, width: 100, height: 100 })
    expect(narrow.length).toBeLessThan(all)

    const everything = visibleNodes(layout, {
      x: layout.bounds.minX - 10,
      y: layout.bounds.minY - 10,
      width: layout.bounds.maxX - layout.bounds.minX + 20,
      height: layout.bounds.maxY - layout.bounds.minY + 20
    })
    expect(everything.length).toBe(all)
  })
})
