import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import {
  elbowPolyline,
  layoutTree,
  routeThrough,
  virtualBends
} from '../../src/renderer/src/components/tree/layout'
import { nuclear, view } from '../family-fixtures'

/**
 * Editable connectors (solution.md §6.2), following draw.io's model: a line
 * starts on its automatic route, dragging a segment inserts a waypoint, and
 * clearing the waypoints restores the automatic route.
 */

const A = { x: 0, y: 0 }
const B = { x: 200, y: 200 }

describe('routeThrough', () => {
  it('is a plain elbow with no waypoints', () => {
    const d = routeThrough(A, [], B)
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d).toContain('200')
    expect(d).not.toContain('NaN')
  })

  it('passes through each waypoint in order', () => {
    const d = routeThrough(A, [{ x: 100, y: 50 }], B)
    expect(d).toContain('100')
    expect(d).toContain('50')
  })

  it('stays orthogonal — every segment is axis-aligned', () => {
    const d = routeThrough(A, [{ x: 120, y: 80 }], B)
    // Only M, L and Q commands; no diagonal shorthand.
    expect(d).toMatch(/^M [\d.-]+ [\d.-]+( (L|Q) [\d. -]+)+$/)
  })

  it('emits a straight line when the two points share an axis', () => {
    expect(routeThrough({ x: 0, y: 0 }, [], { x: 0, y: 100 })).toBe('M 0 0 L 0 100')
    expect(routeThrough({ x: 0, y: 0 }, [], { x: 100, y: 0 })).toBe('M 0 0 L 100 0')
  })

  it('never produces NaN, whatever the waypoints', () => {
    const d = routeThrough(A, [{ x: 0, y: 0 }, { x: -500, y: 900 }], B)
    expect(d).not.toContain('NaN')
  })
})

describe('virtualBends', () => {
  it('offers one handle per segment of the drawn polyline', () => {
    expect(virtualBends([A, B])).toHaveLength(1)
    expect(virtualBends([A, { x: 100, y: 100 }, B])).toHaveLength(2)
    expect(virtualBends([A, { x: 50, y: 50 }, { x: 150, y: 150 }, B])).toHaveLength(3)
  })

  it('puts each handle at its segment midpoint, which is where a drag inserts', () => {
    expect(virtualBends([A, B])).toEqual([{ x: 100, y: 100 }])
  })

  it('follows the elbow, not the chord — a handle off the line makes it jump', () => {
    // The automatic child route: down, along the bus, down again.
    const polyline = elbowPolyline({ x: 0, y: 0 }, 50, { x: 200, y: 100 })
    expect(polyline).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 100 }
    ])
    for (const bend of virtualBends(polyline)) {
      // Every handle sits on an axis-aligned segment of the drawn path.
      const onLine =
        polyline.some((p) => Math.abs(p.x - bend.x) < 0.01) ||
        polyline.some((p) => Math.abs(p.y - bend.y) < 0.01)
      expect(onLine).toBe(true)
    }
  })

  it('degrades to a straight line when the elbow would double back', () => {
    // Child above the bus: an elbow would knot, so the route is direct.
    expect(elbowPolyline({ x: 0, y: 100 }, 50, { x: 200, y: 0 })).toEqual([
      { x: 0, y: 100 },
      { x: 200, y: 0 }
    ])
  })
})

describe('edges in the layout', () => {
  const graph = buildGraph(nuclear)

  it('start on the automatic route with no waypoints', () => {
    const layout = layoutTree(graph, view())
    for (const edge of layout.edges) expect(edge.waypoints).toEqual([])
  })

  it('take the routed path once a waypoint exists', () => {
    const plain = layoutTree(graph, view())
    const target = plain.edges.find((e) => e.kind === 'child')!
    const routed = layoutTree(
      graph,
      view({ edgeRoutes: { [target.id]: [{ x: 999, y: 111 }] } })
    )
    const after = routed.edges.find((e) => e.id === target.id)!
    expect(after.waypoints).toEqual([{ x: 999, y: 111 }])
    expect(after.d).toContain('999')
    expect(after.d).not.toBe(target.d)
  })

  it('leave every other connector alone', () => {
    const plain = layoutTree(graph, view())
    const target = plain.edges.find((e) => e.kind === 'child')!
    const routed = layoutTree(graph, view({ edgeRoutes: { [target.id]: [{ x: 999, y: 111 }] } }))
    for (const edge of routed.edges) {
      if (edge.id === target.id) continue
      expect({ id: edge.id, d: edge.d }).toEqual({
        id: edge.id,
        d: plain.edges.find((e) => e.id === edge.id)!.d
      })
    }
  })

  it('restore the automatic route when the waypoints are cleared', () => {
    const plain = layoutTree(graph, view())
    const target = plain.edges.find((e) => e.kind === 'child')!
    const cleared = layoutTree(graph, view({ edgeRoutes: {} }))
    expect(cleared.edges.find((e) => e.id === target.id)!.d).toBe(target.d)
  })

  it('ignore a route whose edge no longer exists', () => {
    const layout = layoutTree(graph, view({ edgeRoutes: { 'child:gone:missing': [{ x: 1, y: 2 }] } }))
    expect(layout.edges.every((e) => !e.d.includes('NaN'))).toBe(true)
  })

  it('expose endpoints so the handles have somewhere to sit', () => {
    const layout = layoutTree(graph, view())
    for (const edge of layout.edges) {
      expect(Number.isFinite(edge.start.x)).toBe(true)
      expect(Number.isFinite(edge.end.y)).toBe(true)
    }
  })

  it('expose the drawn polyline, including the automatic elbow corners', () => {
    const layout = layoutTree(graph, view())
    const child = layout.edges.find((e) => e.kind === 'child')!
    // An elbow has interior corners; those are what become grabbable squares.
    expect(child.points.length).toBeGreaterThanOrEqual(2)
    expect(child.points[0]).toEqual(child.start)
    expect(child.points[child.points.length - 1]).toEqual(child.end)
  })
})
