import type { FamilyGraph } from '@shared/graph'
import { assignLanes, laneY, type LaneSpan } from './lanes'
import { elbowPolyline, routeThrough } from './routing'
import type { LayoutEdge, LayoutOptions, LayoutUnion } from './types'

/**
 * Pass 5 — connector geometry (Requirements/Feature29.md §5).
 *
 * Orthogonal elbows with rounded corners, which is what makes a diagram read as
 * a family tree rather than a generic node graph:
 *
 *   - a **partner edge** is a horizontal segment between two spouses, with a
 *     junction at its midpoint;
 *   - **child edges** drop from that junction to a shared horizontal *sibling
 *     bus*, then down to each child — so siblings share one trunk instead of
 *     each getting its own diagonal.
 *
 * Buses are packed into lanes (see lanes.ts) so two unions whose spans overlap
 * never draw at the same height. Without that, the lines merge and a child looks
 * like it descends from four parents.
 *
 * Every edge carries its `unionId` so the UI can highlight one family's
 * connectors — which is what makes a dense tree readable at a glance.
 */

const CORNER = 8

/** Round for a small, stable `d` string. */
const p = (n: number): string => (Math.round(n * 100) / 100).toString()

/**
 * A vertical-then-horizontal-then-vertical elbow: down from the junction, along
 * the bus, then down to the child.
 *
 * Falls back to a straight line when the child is not below the bus, which can
 * happen once positions are hand-edited or a cycle was cut. Drawing a
 * direct line is honest; an elbow doubling back on itself is a knot.
 */
export function elbowPath(
  jx: number,
  jy: number,
  busY: number,
  cx: number,
  childTop: number
): string {
  const straightDown = Math.abs(cx - jx) < 0.5
  const wellFormed = busY > jy && childTop >= busY

  if (straightDown || !wellFormed) {
    return `M ${p(jx)} ${p(jy)} L ${p(cx)} ${p(childTop)}`
  }

  const dir = cx > jx ? 1 : -1
  const r = Math.min(CORNER, Math.abs(cx - jx) / 2, Math.abs(busY - jy), Math.abs(childTop - busY))

  return [
    `M ${p(jx)} ${p(jy)}`,
    `L ${p(jx)} ${p(busY - r)}`,
    `Q ${p(jx)} ${p(busY)} ${p(jx + r * dir)} ${p(busY)}`,
    `L ${p(cx - r * dir)} ${p(busY)}`,
    `Q ${p(cx)} ${p(busY)} ${p(cx)} ${p(busY + r)}`,
    `L ${p(cx)} ${p(childTop)}`
  ].join(' ')
}

export interface EdgeInput {
  graph: FamilyGraph
  x: Map<string, number>
  y: Map<string, number>
  gen: Map<string, number>
  opts: LayoutOptions
  /** Manual waypoints per edge id; an edge with any takes the routed path. */
  routes?: Record<string, Array<{ x: number; y: number }>>
}

export function buildUnionsAndEdges({
  graph,
  x,
  y,
  gen,
  opts,
  routes = {}
}: EdgeInput): { unions: LayoutUnion[]; edges: LayoutEdge[] } {
  const unions: LayoutUnion[] = []
  const edges: LayoutEdge[] = []
  const halfH = opts.nodeHeight / 2
  const halfW = opts.nodeWidth / 2
  const isGhost = (id: string): boolean => graph.byId.get(id)?.ghost === true

  // ── Pre-pass: how wide is each union's bus, and which gap does it sit in? ──
  const spans: LaneSpan[] = []
  for (const u of graph.unions) {
    const partners = u.partnerIds.filter((id) => x.has(id))
    const children = u.childIds.filter((id) => x.has(id))
    if (!partners.length || !children.length) continue

    const partnerXs = partners.map((id) => x.get(id) ?? 0)
    const childXs = children.map((id) => x.get(id) ?? 0)
    const junctionX = (Math.min(...partnerXs) + Math.max(...partnerXs)) / 2
    const all = [junctionX, ...childXs]

    spans.push({
      id: u.id,
      gen: Math.max(...partners.map((id) => gen.get(id) ?? 0)),
      minX: Math.min(...all),
      maxX: Math.max(...all)
    })
  }
  const { lane, laneCount } = assignLanes(spans)

  // ── Build ──
  for (const u of graph.unions) {
    const present = u.partnerIds.filter((id) => x.has(id))
    if (!present.length) continue

    const partnerY = Math.max(...present.map((id) => y.get(id) ?? 0))
    let junctionX: number
    let junctionY: number

    if (present.length >= 2) {
      const [a, b] = [...present].sort((l, r) => (x.get(l) ?? 0) - (x.get(r) ?? 0))
      const ax = x.get(a) ?? 0
      const bx = x.get(b) ?? 0
      const ay = y.get(a) ?? 0
      const by = y.get(b) ?? 0
      junctionX = (ax + bx) / 2
      junctionY = (ay + by) / 2

      // The partner link. Drawn slanted when the two are not on one row — after
      // a levelling failure, or once someone has been dragged.
      const id = `partner:${u.id}`
      const start = { x: ax + halfW, y: ay }
      const end = { x: bx - halfW, y: by }
      const waypoints = routes[id] ?? []
      edges.push({
        id,
        unionId: u.id,
        kind: 'partner',
        members: [a, b],
        d: waypoints.length
          ? routeThrough(start, waypoints, end)
          : `M ${p(start.x)} ${p(start.y)} L ${p(end.x)} ${p(end.y)}`,
        ghost: present.some(isGhost),
        start,
        end,
        points: [start, ...waypoints, end],
        waypoints
      })
    } else {
      junctionX = x.get(present[0]) ?? 0
      // A lone parent has no partner line, so children hang off the box itself.
      junctionY = (y.get(present[0]) ?? 0) + halfH
    }

    const children = u.childIds.filter((id) => x.has(id))
    const generation = Math.max(...present.map((id) => gen.get(id) ?? 0))
    const busY = laneY(
      partnerY + halfH,
      opts.generationGap,
      lane.get(u.id) ?? 0,
      laneCount.get(generation) ?? 1
    )

    for (const childId of children) {
      const cx = x.get(childId) ?? 0
      const childTop = (y.get(childId) ?? 0) - halfH
      const id = `child:${u.id}:${childId}`
      const start = { x: junctionX, y: junctionY }
      const end = { x: cx, y: childTop }
      const waypoints = routes[id] ?? []
      edges.push({
        id,
        unionId: u.id,
        kind: 'child',
        members: [...present, childId],
        // Waypoints replace the automatic elbow entirely — the bus lane is the
        // default route, not a constraint on a hand-edited one.
        d: waypoints.length
          ? routeThrough(start, waypoints, end)
          : elbowPath(junctionX, junctionY, busY, cx, childTop),
        ghost: isGhost(childId) || present.some(isGhost),
        start,
        end,
        points: waypoints.length
          ? [start, ...waypoints, end]
          : elbowPolyline(start, busY, end),
        waypoints
      })
    }

    unions.push({
      id: u.id,
      partnerIds: u.partnerIds,
      childIds: u.childIds,
      junctionX,
      junctionY,
      busY
    })
  }

  return { unions, edges }
}
