/**
 * Orthogonal routing through manual waypoints — the draw.io model.
 *
 * A connector starts on its automatic route. Once the user drags a segment, the
 * drag point becomes a **waypoint**, and the line is routed through every
 * waypoint in order. Clearing the waypoints restores the automatic route, which
 * is never lost because it is recomputed from the data each time.
 *
 * Between consecutive points the path takes one right-angle turn, oriented by
 * the dominant axis: a mostly-vertical run goes down-then-across, a
 * mostly-horizontal one across-then-down. That keeps the result predictable —
 * dragging a point moves the corner where you expect it to be.
 */

export interface Point {
  x: number
  y: number
}

const CORNER = 8

const n = (v: number): string => (Math.round(v * 100) / 100).toString()

/** Corner radius that cannot exceed either of the two legs it joins. */
function radiusFor(a: number, b: number): number {
  return Math.max(0, Math.min(CORNER, Math.abs(a) / 2, Math.abs(b) / 2))
}

/**
 * One right-angle leg from `from` to `to`, returned as path commands (no
 * leading move). `vertical` picks which axis moves first.
 */
function leg(from: Point, to: Point, vertical: boolean): string {
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (Math.abs(dx) < 0.5) return `L ${n(to.x)} ${n(to.y)}`
  if (Math.abs(dy) < 0.5) return `L ${n(to.x)} ${n(to.y)}`

  const r = radiusFor(dx, dy)
  if (vertical) {
    // Down to the corner, round it, then across.
    const cornerY = to.y
    const sy = Math.sign(dy)
    const sx = Math.sign(dx)
    return [
      `L ${n(from.x)} ${n(cornerY - r * sy)}`,
      `Q ${n(from.x)} ${n(cornerY)} ${n(from.x + r * sx)} ${n(cornerY)}`,
      `L ${n(to.x)} ${n(to.y)}`
    ].join(' ')
  }
  // Across to the corner, round it, then down.
  const cornerX = to.x
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  return [
    `L ${n(cornerX - r * sx)} ${n(from.y)}`,
    `Q ${n(cornerX)} ${n(from.y)} ${n(cornerX)} ${n(from.y + r * sy)}`,
    `L ${n(to.x)} ${n(to.y)}`
  ].join(' ')
}

/** The full orthogonal path from `start` through `waypoints` to `end`. */
export function routeThrough(start: Point, waypoints: Point[], end: Point): string {
  const points = [start, ...waypoints, end]
  const parts = [`M ${n(start.x)} ${n(start.y)}`]

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x)
    parts.push(leg(from, to, vertical))
  }

  return parts.join(' ')
}

/**
 * Midpoints of each segment of the drawn polyline — where the "virtual bend"
 * handles go. Dragging one inserts a waypoint at that index, as draw.io does.
 *
 * Takes the *drawn* polyline rather than start/end, so a handle always lands on
 * the visible line even when the automatic route is an elbow.
 */
export function virtualBends(points: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 1; i < points.length; i++) {
    out.push({
      x: (points[i - 1].x + points[i].x) / 2,
      y: (points[i - 1].y + points[i].y) / 2
    })
  }
  return out
}

/**
 * The polyline an automatic child elbow follows: down from the junction, along
 * the sibling bus, then down to the child. Mirrors `elbowPath` in edges.ts —
 * the two must agree or the handles drift off the line.
 */
export function elbowPolyline(
  junction: Point,
  busY: number,
  child: Point
): Point[] {
  const straightDown = Math.abs(child.x - junction.x) < 0.5
  const wellFormed = busY > junction.y && child.y >= busY
  if (straightDown || !wellFormed) return [junction, child]
  return [junction, { x: junction.x, y: busY }, { x: child.x, y: busY }, child]
}
