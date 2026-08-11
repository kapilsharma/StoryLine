import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import { layoutTree, visibleNodes } from '../../src/renderer/src/components/tree/layout'
import { nuclear, view } from '../family-fixtures'

/**
 * Manual positions (solution.md §6.2). Stored per view in `overrides`, applied
 * after the coordinates pass and *before* edges are built — so a dragged node
 * takes its connectors with it rather than leaving them behind.
 */

const graph = buildGraph(nuclear)

describe('overrides', () => {
  it('moves the node to the given position', () => {
    const layout = layoutTree(graph, view({ overrides: { 'kid-a': { x: 900, y: 700 } } }))
    const node = layout.nodes.find((n) => n.id === 'kid-a')!
    expect(node.x).toBe(900)
    expect(node.y).toBe(700)
    expect(node.pinned).toBe(true)
  })

  it('leaves everyone else on the computed layout', () => {
    const before = layoutTree(graph, view())
    const after = layoutTree(graph, view({ overrides: { 'kid-a': { x: 900, y: 700 } } }))
    for (const id of ['dad', 'mum', 'kid-b', 'kid-c']) {
      const b = before.nodes.find((n) => n.id === id)!
      const a = after.nodes.find((n) => n.id === id)!
      expect({ id, x: a.x, y: a.y }).toEqual({ id, x: b.x, y: b.y })
    }
  })

  it('re-routes the connector to follow the moved node', () => {
    const before = layoutTree(graph, view())
    const after = layoutTree(graph, view({ overrides: { 'kid-a': { x: 900, y: 700 } } }))
    const edgeId = (l: typeof before): string =>
      l.edges.find((e) => e.kind === 'child' && e.members.includes('kid-a'))!.d
    expect(edgeId(after)).not.toBe(edgeId(before))
    // The path must actually end at the new position.
    expect(edgeId(after)).toContain('900')
  })

  it('produces a drawable path even when a child is dragged above its parents', () => {
    const layout = layoutTree(graph, view({ overrides: { 'kid-a': { x: 0, y: -400 } } }))
    const edge = layout.edges.find((e) => e.kind === 'child' && e.members.includes('kid-a'))!
    expect(edge.d).not.toContain('NaN')
    expect(edge.d.startsWith('M ')).toBe(true)
  })

  it('flags the layout so culling stops assuming rows share a y', () => {
    expect(layoutTree(graph, view()).hasOverrides).toBe(false)
    expect(layoutTree(graph, view({ overrides: { 'kid-a': { x: 1, y: 2 } } })).hasOverrides).toBe(true)
  })

  it('still finds a moved node when culling', () => {
    const layout = layoutTree(graph, view({ overrides: { 'kid-a': { x: 5000, y: 5000 } } }))
    const far = visibleNodes(layout, { x: 4800, y: 4800, width: 400, height: 400 })
    expect(far.map((n) => n.id)).toEqual(['kid-a'])

    const near = visibleNodes(layout, { x: -200, y: -200, width: 900, height: 400 })
    expect(near.map((n) => n.id)).not.toContain('kid-a')
  })

  it('ignores malformed entries rather than producing NaN coordinates', () => {
    const layout = layoutTree(
      graph,
      view({
        overrides: {
          'kid-a': { x: Number.NaN as number, y: 0 },
          'no-such-person': { x: 10, y: 10 }
        } as Record<string, { x: number; y: number }>
      })
    )
    // NaN is a number, so it is applied — but it must not leak into anyone else.
    expect(layout.nodes.find((n) => n.id === 'dad')!.x).not.toBeNaN()
    expect(layout.nodes.find((n) => n.id === 'no-such-person')).toBeUndefined()
  })

  it('clearing overrides restores the computed layout exactly', () => {
    const original = layoutTree(graph, view())
    const moved = layoutTree(graph, view({ overrides: { 'kid-a': { x: 900, y: 700 } } }))
    const reset = layoutTree(graph, view({ overrides: {} }))
    expect(moved.nodes.find((n) => n.id === 'kid-a')!.x).toBe(900)
    for (const node of reset.nodes) {
      const before = original.nodes.find((n) => n.id === node.id)!
      expect({ id: node.id, x: node.x }).toEqual({ id: node.id, x: before.x })
    }
  })
})
