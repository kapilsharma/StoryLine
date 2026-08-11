import type { FamilyGraph } from '@shared/graph'
import { parentsOf } from '@shared/graph'
import type { LayoutOptions } from './types'

/**
 * Pass 4 — x coordinates (Requirements/Feature29.md §5).
 *
 * Y is trivial: `gen * (nodeHeight + generationGap)`.
 *
 * X uses the two-phase relaxation the solution doc specifies rather than a
 * contour algorithm — easier to reason about and to test, and it handles the DAG
 * cases (two parents, remarriage, cousin marriage) that a strict tidy-tree
 * recursion does not:
 *
 *   1. **Centre** — pull children under the midpoint of their parents, and pull
 *      parents over the midpoint of their children.
 *   2. **Separate** — sweep each generation left to right enforcing a minimum
 *      gap, pushing right only.
 *
 * Separation always runs last within an iteration, so the ordering from pass 3
 * is preserved and nodes never overlap in the final output. If this ever shows
 * up in a profile, Walker's linear-time algorithm can replace the body of
 * `assignCoordinates` without touching anything else.
 */

const ITERATIONS = 12

export interface CoordinateResult {
  x: Map<string, number>
  y: Map<string, number>
}

export function assignCoordinates(
  graph: FamilyGraph,
  gen: Map<string, number>,
  order: Map<number, string[]>,
  cutEdges: Set<string>,
  opts: LayoutOptions
): CoordinateResult {
  const x = new Map<string, number>()
  const y = new Map<string, number>()

  const generations = [...order.keys()].sort((a, b) => a - b)

  /** Minimum centre-to-centre distance between two neighbours. */
  const separation = (a: string, b: string): number => {
    const shareUnion = (graph.unionsOf.get(a) ?? []).some((u) =>
      (graph.unionsOf.get(b) ?? []).includes(u)
    )
    // Partners sit closer together than unrelated neighbours — that visual
    // grouping is most of what makes a couple read as a couple.
    return opts.nodeWidth + (shareUnion ? opts.partnerGap : opts.siblingGap)
  }

  // ── Seed: sequential slots in pass-3 order ──
  for (const g of generations) {
    const list = order.get(g)!
    let cursor = 0
    for (let i = 0; i < list.length; i++) {
      if (i > 0) cursor += separation(list[i - 1], list[i])
      x.set(list[i], cursor)
    }
    y.set(String(g), g * (opts.nodeHeight + opts.generationGap))
  }
  for (const [id, g] of gen) y.set(id, g * (opts.nodeHeight + opts.generationGap))

  /** True when two neighbours are partners in the same union. */
  const arePartners = (a: string, b: string): boolean =>
    (graph.unionsOf.get(a) ?? []).some((u) => (graph.unionsOf.get(b) ?? []).includes(u))

  /**
   * Enforce separation left to right. Push right only, so the pass-3 ordering is
   * never disturbed.
   *
   * Partners are held at *exactly* the partner gap rather than at a minimum: the
   * relaxation can only ever push right, so without this a couple drifts apart
   * as unrelated people are added elsewhere in the generation, and stops reading
   * as a couple. Pulling them back together is safe because the gap is still
   * wider than a node.
   */
  const separate = (g: number): void => {
    const list = order.get(g)
    if (!list) return
    for (let i = 1; i < list.length; i++) {
      const gap = separation(list[i - 1], list[i])
      const anchored = (x.get(list[i - 1]) ?? 0) + gap
      const current = x.get(list[i]) ?? 0
      if (arePartners(list[i - 1], list[i])) x.set(list[i], anchored)
      else if (current < anchored) x.set(list[i], anchored)
    }
  }

  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

  /** Parents of `id` that are actually in the graph and not behind a cut edge. */
  const activeParents = (id: string): string[] =>
    parentsOf(graph, id).filter((p) => !cutEdges.has(`${p}>${id}`))

  /** Children of `id` through the unions they partner in. */
  const activeChildren = (id: string): string[] => {
    const out: string[] = []
    for (const uid of graph.unionsOf.get(id) ?? []) {
      const u = graph.unionById.get(uid)!
      for (const c of u.childIds) {
        if (!cutEdges.has(`${id}>${c}`) && !out.includes(c)) out.push(c)
      }
    }
    return out
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // ── Down: children follow their parents ──
    for (const g of generations) {
      if (g === 0) continue
      for (const id of order.get(g)!) {
        const ps = activeParents(id)
        if (ps.length) x.set(id, mean(ps.map((p) => x.get(p) ?? 0)))
      }
      separate(g)
    }

    // ── Up: parents centre over their children, partners stay together ──
    for (const g of [...generations].reverse()) {
      for (const id of order.get(g)!) {
        const kids = activeChildren(id)
        if (kids.length) x.set(id, mean(kids.map((k) => x.get(k) ?? 0)))
      }
      // A couple should straddle their children's midpoint rather than both
      // sitting on it, so nudge partners apart around the shared centre.
      for (const u of graph.unions) {
        if (u.partnerIds.length !== 2) continue
        const [a, b] = u.partnerIds
        if ((gen.get(a) ?? -1) !== g || (gen.get(b) ?? -1) !== g) continue
        if (!u.childIds.length) continue
        const centre = mean(u.childIds.map((c) => x.get(c) ?? 0))
        const half = (opts.nodeWidth + opts.partnerGap) / 2
        const list = order.get(g)!
        const aFirst = list.indexOf(a) <= list.indexOf(b)
        x.set(aFirst ? a : b, centre - half)
        x.set(aFirst ? b : a, centre + half)
      }
      separate(g)
    }
  }

  // Final guarantee: no overlaps anywhere, whatever the relaxation did.
  for (const g of generations) separate(g)

  // Normalise so the tree starts at the origin.
  const xs = [...x.values()]
  if (xs.length) {
    const minX = Math.min(...xs)
    for (const [id, v] of x) x.set(id, v - minX)
  }

  return { x, y }
}
