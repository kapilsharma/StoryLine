import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import {
  arrangedMembers,
  freeze,
  layoutTree,
  suggestPosition
} from '../../src/renderer/src/components/tree/layout'
import { nuclear, person, view } from '../family-fixtures'

/**
 * Arranged views (solution.md §6.2).
 *
 * The bug this exists to prevent: arrange a tree by hand, add one person, and
 * the layout re-runs and moves everybody. An arranged view freezes — its members
 * are exactly the people with a stored position, and a newcomer has to be
 * imported deliberately.
 */

const graph = buildGraph(nuclear)

describe('freeze', () => {
  it('captures every real node where it currently sits', () => {
    const layout = layoutTree(graph, view())
    const frozen = freeze(layout)
    expect(Object.keys(frozen).sort()).toEqual(nuclear.map((c) => c.id).sort())
    for (const node of layout.nodes) {
      expect(frozen[node.id]).toEqual({ x: node.x, y: node.y })
    }
  })

  it('never pins a ghost, which would resurrect it after the real person exists', () => {
    const withGhost = buildGraph([person('kid', 'male', { father: 'missing-dad' })])
    const frozen = freeze(layoutTree(withGhost, view()))
    expect(frozen['missing-dad']).toBeUndefined()
    expect(frozen['kid']).toBeDefined()
  })
})

describe('an arranged view', () => {
  const arrangedView = () => {
    const layout = layoutTree(graph, view())
    return view({ arranged: true, overrides: freeze(layout) })
  }

  it('shows exactly its members', () => {
    const v = arrangedView()
    expect(arrangedMembers(v).size).toBe(nuclear.length)
    expect(layoutTree(graph, v).nodes).toHaveLength(nuclear.length)
  })

  it('does not move anyone when a character is added to the project', () => {
    const v = arrangedView()
    const before = layoutTree(graph, v)

    // Someone new turns up in the data — a whole extra generation, in fact.
    const grown = buildGraph([
      ...nuclear,
      person('dashrath', 'male', { birthday: '1920' }),
      person('extra-kid', 'male', { father: 'dad', mother: 'mum', birthday: '1970' })
    ])
    const after = layoutTree(grown, v)

    // Nobody moved, and nobody appeared.
    expect(after.nodes).toHaveLength(before.nodes.length)
    for (const node of after.nodes) {
      const was = before.nodes.find((n) => n.id === node.id)!
      expect({ id: node.id, x: node.x, y: node.y }).toEqual({ id: node.id, x: was.x, y: was.y })
    }
    expect(after.nodes.map((n) => n.id)).not.toContain('dashrath')
  })

  it('by contrast, an auto view does move people — which is the problem', () => {
    const before = layoutTree(graph, view())
    const grown = buildGraph([
      ...nuclear,
      person('extra-kid', 'male', { father: 'dad', mother: 'mum', birthday: '1970' })
    ])
    const after = layoutTree(grown, view())
    const moved = after.nodes.filter((n) => {
      const was = before.nodes.find((b) => b.id === n.id)
      return was && (was.x !== n.x || was.y !== n.y)
    })
    expect(moved.length).toBeGreaterThan(0)
  })
})

describe('membership on an arranged view', () => {
  /**
   * Regression: an arranged view intersected its `overrides` with the view's
   * *filters*. Importing someone the filter excludes then wrote them into
   * `overrides` — so they vanished from the "not on this tree" list — while the
   * intersection kept them off the canvas. Added, and invisible.
   *
   * Arranged means membership is explicit. The filters chose the initial cast;
   * after freezing they no longer decide who is on the tree.
   */
  const outsider = person('outsider', 'male', { name: 'Outside Person' })
  const wider = buildGraph([...nuclear, outsider])

  it('shows someone the filters would have excluded', () => {
    // A filter that selects only kid-a and their immediate couple.
    const filtered = view({ root: 'kid-a', parentDepth: 0, childDepth: 0 })
    const base = layoutTree(wider, filtered)
    expect(base.nodes.map((n) => n.id)).not.toContain('outsider')

    // Freeze that, then import the outsider the way the dropdown does.
    const arranged = view({
      ...filtered,
      arranged: true,
      overrides: { ...freeze(base), outsider: { x: 900, y: 0 } }
    })

    const after = layoutTree(wider, arranged)
    expect(after.nodes.map((n) => n.id)).toContain('outsider')
    expect(after.nodes.find((n) => n.id === 'outsider')!.x).toBe(900)
  })

  it('still honours the hidden list', () => {
    const base = layoutTree(wider, view())
    const arranged = view({
      arranged: true,
      overrides: freeze(base),
      hidden: ['kid-a']
    })
    expect(layoutTree(wider, arranged).nodes.map((n) => n.id)).not.toContain('kid-a')
  })

  it('ignores an override for someone who no longer exists', () => {
    const base = layoutTree(graph, view())
    const arranged = view({
      arranged: true,
      overrides: { ...freeze(base), 'deleted-person': { x: 10, y: 10 } }
    })
    const after = layoutTree(graph, arranged)
    expect(after.nodes.map((n) => n.id)).not.toContain('deleted-person')
    expect(after.nodes).toHaveLength(nuclear.length)
  })
})

describe('suggestPosition', () => {
  const arrangedWithout = (missing: string) => {
    const layout = layoutTree(graph, view())
    const overrides = freeze(layout)
    delete overrides[missing]
    return view({ arranged: true, overrides })
  }

  it('drops a newcomer beside the relatives already placed', () => {
    const v = arrangedWithout('kid-b')
    const automatic = layoutTree(graph, view())
    const at = suggestPosition(graph, v, automatic, 'kid-b')

    // Its siblings sit on one row; the newcomer should land on that row too.
    const siblingY = v.overrides['kid-a'].y
    expect(at.y).toBeCloseTo(siblingY, 1)
    // ...and between them horizontally, where the automatic layout put it.
    expect(at.x).toBeGreaterThan(v.overrides['kid-a'].x)
    expect(at.x).toBeLessThan(v.overrides['kid-c'].x)
  })

  it('honours a shifted arrangement rather than the computed frame', () => {
    const v = arrangedWithout('kid-b')
    // Move the whole family a long way; the newcomer must follow it.
    for (const id of Object.keys(v.overrides)) {
      v.overrides[id] = { x: v.overrides[id].x + 5000, y: v.overrides[id].y + 3000 }
    }
    const at = suggestPosition(graph, v, layoutTree(graph, view()), 'kid-b')
    expect(at.x).toBeGreaterThan(4000)
    expect(at.y).toBeGreaterThan(2000)
  })

  it('parks someone with no relatives on the tree clear of everyone else', () => {
    const layout = layoutTree(graph, view())
    const v = view({ arranged: true, overrides: freeze(layout) })
    const loner = buildGraph([...nuclear, person('stranger', 'other')])
    const at = suggestPosition(loner, v, layoutTree(loner, view()), 'stranger')
    const maxX = Math.max(...Object.values(v.overrides).map((p) => p.x))
    expect(at.x).toBeGreaterThan(maxX)
  })

  it('returns the origin for the very first person on an empty tree', () => {
    const empty = view({ arranged: true, overrides: {} })
    expect(suggestPosition(graph, empty, layoutTree(graph, view()), 'dad')).toEqual({ x: 0, y: 0 })
  })
})
