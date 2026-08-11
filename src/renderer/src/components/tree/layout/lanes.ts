/**
 * Sibling-bus lane assignment (Requirements/Feature29.md §5).
 *
 * Every union drops its children from a horizontal "sibling bus". If two unions
 * in the same generation draw their bus at the same height and their x-spans
 * overlap, the two lines merge into one and the tree becomes unreadable — a
 * child appears to descend from four parents.
 *
 * So each bus gets its own **lane** within the gap below its generation. Lanes
 * are assigned by interval packing: sort by span start, then give each union the
 * lowest lane whose occupied intervals it does not overlap. Two buses share a
 * lane only when they are horizontally disjoint, which is exactly when sharing
 * one is unambiguous.
 */

export interface LaneSpan {
  /** Union id. */
  id: string
  /** Generation whose gap this bus lives in. */
  gen: number
  minX: number
  maxX: number
}

/** Horizontal clearance required between two buses sharing a lane. */
const LANE_PADDING = 12

export interface LaneAssignment {
  /** Union id → lane index within its generation, 0 = closest to the parents. */
  lane: Map<string, number>
  /** Generation → how many lanes that gap needs. */
  laneCount: Map<number, number>
}

export function assignLanes(spans: LaneSpan[]): LaneAssignment {
  const lane = new Map<string, number>()
  const laneCount = new Map<number, number>()

  // Independently per generation — buses in different gaps never collide.
  const byGen = new Map<number, LaneSpan[]>()
  for (const s of spans) {
    const list = byGen.get(s.gen) ?? []
    list.push(s)
    byGen.set(s.gen, list)
  }

  for (const [gen, list] of byGen) {
    // Widest first, then leftmost: a wide bus that crosses the whole generation
    // is the one that most needs its own lane, and placing it first keeps the
    // narrow local ones packed together near the parents.
    const ordered = [...list].sort((a, b) => {
      const wa = a.maxX - a.minX
      const wb = b.maxX - b.minX
      if (wa !== wb) return wb - wa
      return a.minX - b.minX
    })

    /** Occupied x-intervals per lane. */
    const lanes: Array<Array<[number, number]>> = []

    for (const span of ordered) {
      let index = lanes.findIndex((occupied) =>
        occupied.every(
          ([lo, hi]) => span.maxX + LANE_PADDING < lo || span.minX - LANE_PADDING > hi
        )
      )
      if (index === -1) {
        lanes.push([])
        index = lanes.length - 1
      }
      lanes[index].push([span.minX, span.maxX])
      lane.set(span.id, index)
    }

    laneCount.set(gen, Math.max(lanes.length, 1))
  }

  return { lane, laneCount }
}

/**
 * The y for a bus, spreading lanes evenly through the gap between the parent row
 * and the child row. Lane 0 sits closest to the parents.
 */
export function laneY(
  partnerBottomY: number,
  generationGap: number,
  laneIndex: number,
  lanes: number
): number {
  return partnerBottomY + (generationGap * (laneIndex + 1)) / (lanes + 1)
}
