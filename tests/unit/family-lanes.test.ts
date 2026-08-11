import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import { assignLanes, laneY } from '../../src/renderer/src/components/tree/layout/lanes'
import { layoutTree } from '../../src/renderer/src/components/tree/layout'
import { nuclear, twoFamiliesJoined, view } from '../family-fixtures'

/**
 * Bus lanes (solution.md §5.7).
 *
 * The bug this prevents: two unions in one generation drawing their sibling bus
 * at the same height with overlapping spans. The lines merge, and a child
 * appears to descend from four parents — which is exactly what the example
 * project looked like before lanes existed.
 */

describe('assignLanes', () => {
  it('keeps two overlapping spans off the same lane', () => {
    const { lane } = assignLanes([
      { id: 'a', gen: 0, minX: 0, maxX: 500 },
      { id: 'b', gen: 0, minX: 300, maxX: 800 }
    ])
    expect(lane.get('a')).not.toBe(lane.get('b'))
  })

  it('reuses a lane for spans that are comfortably apart', () => {
    const { lane, laneCount } = assignLanes([
      { id: 'a', gen: 0, minX: 0, maxX: 100 },
      { id: 'b', gen: 0, minX: 400, maxX: 500 }
    ])
    expect(lane.get('a')).toBe(lane.get('b'))
    expect(laneCount.get(0)).toBe(1)
  })

  it('does not let touching spans share a lane — they would read as one line', () => {
    const { lane } = assignLanes([
      { id: 'a', gen: 0, minX: 0, maxX: 200 },
      { id: 'b', gen: 0, minX: 205, maxX: 400 }
    ])
    expect(lane.get('a')).not.toBe(lane.get('b'))
  })

  it('treats each generation independently', () => {
    const { laneCount } = assignLanes([
      { id: 'a', gen: 0, minX: 0, maxX: 500 },
      { id: 'b', gen: 1, minX: 0, maxX: 500 }
    ])
    expect(laneCount.get(0)).toBe(1)
    expect(laneCount.get(1)).toBe(1)
  })

  it('packs three mutually overlapping spans into three lanes', () => {
    const { lane, laneCount } = assignLanes([
      { id: 'a', gen: 0, minX: 0, maxX: 900 },
      { id: 'b', gen: 0, minX: 100, maxX: 800 },
      { id: 'c', gen: 0, minX: 200, maxX: 700 }
    ])
    expect(new Set([lane.get('a'), lane.get('b'), lane.get('c')]).size).toBe(3)
    expect(laneCount.get(0)).toBe(3)
  })
})

describe('laneY', () => {
  it('spreads lanes through the gap without touching either row', () => {
    const bottom = 100
    const gap = 90
    const a = laneY(bottom, gap, 0, 2)
    const b = laneY(bottom, gap, 1, 2)
    expect(a).toBeGreaterThan(bottom)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(bottom + gap)
  })

  it('centres a single lane in the gap', () => {
    expect(laneY(100, 90, 0, 1)).toBe(145)
  })
})

describe('the example the bug came from', () => {
  it('gives the two grandparent couples different bus heights', () => {
    // Both couples' buses span most of the generation, so at one shared height
    // they merged into a single line.
    const layout = layoutTree(buildGraph(twoFamiliesJoined), view())
    const hisUnion = layout.unions.find((u) => u.partnerIds.includes('h-gp1'))!
    const herUnion = layout.unions.find((u) => u.partnerIds.includes('w-gp1'))!
    expect(hisUnion.busY).not.toBe(herUnion.busY)
  })

  it('still uses one lane when there is nothing to disambiguate', () => {
    const layout = layoutTree(buildGraph(nuclear), view())
    expect(layout.unions).toHaveLength(1)
    const [only] = layout.unions
    // Centred in the gap: one union needs no offset.
    expect(only.busY).toBeGreaterThan(only.junctionY)
  })
})

describe('edges carry the identity needed to highlight a family', () => {
  it('names its union and the people it touches', () => {
    const layout = layoutTree(buildGraph(nuclear), view())
    for (const edge of layout.edges) {
      expect(edge.unionId).toBeTruthy()
      expect(edge.members.length).toBeGreaterThan(1)
    }
    const kidEdge = layout.edges.find((e) => e.id.endsWith(':kid-a'))!
    expect(kidEdge.members).toContain('kid-a')
    expect(kidEdge.members).toContain('dad')
    expect(kidEdge.members).toContain('mum')
  })
})
