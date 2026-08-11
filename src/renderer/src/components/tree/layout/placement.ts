import type { View } from '@shared/types'
import { parentsOf, spousesOf, type FamilyGraph } from '@shared/graph'
import type { Point } from './routing'
import type { TreeLayout } from './types'

/**
 * Placing one person on an *arranged* tree (Requirements/Feature29.md §6).
 *
 * On an arranged view the layout engine no longer decides where anyone goes —
 * every member has a stored position, which is the whole point: adding a person
 * must not move the people already placed. So a newcomer needs a position
 * computed once, at import, and then persisted like everyone else's.
 *
 * The trick is to compute it in the *automatic* layout's frame of reference and
 * then translate it into the arranged one, using the people who exist in both.
 * That drops the newcomer next to their relatives rather than at some arbitrary
 * corner, even when the arrangement bears little resemblance to the computed
 * layout.
 */

/**
 * Everyone on an arranged view: exactly the people with a stored position.
 *
 * Superseded by `viewMembers`, which reads the explicit `members` list first;
 * this is only the fallback for a view arranged before membership existed. Kept
 * because that fallback is the thing worth being able to test in isolation.
 */
export function arrangedMembers(view: View): Set<string> {
  return new Set(Object.keys(view.overrides ?? {}))
}

/**
 * Where to drop `id` on an arranged view.
 *
 * `automatic` is the layout of the same selection with no overrides applied —
 * it supplies the shape; the stored positions supply the frame.
 */
export function suggestPosition(
  graph: FamilyGraph,
  view: View,
  automatic: TreeLayout,
  id: string
): Point {
  const placed = view.overrides ?? {}
  const computed = new Map(automatic.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  const mine = computed.get(id)

  // Relatives already on the tree, nearest first — these anchor the translation.
  const relatives = [
    ...parentsOf(graph, id),
    ...spousesOf(graph, id),
    ...(graph.childrenOf.get(id) ?? [])
  ].filter((r) => placed[r] && computed.has(r))

  if (mine && relatives.length) {
    // Mean offset between where those relatives *are* and where the automatic
    // layout would put them; apply it to the newcomer's computed position.
    let dx = 0
    let dy = 0
    for (const r of relatives) {
      dx += placed[r].x - computed.get(r)!.x
      dy += placed[r].y - computed.get(r)!.y
    }
    return { x: mine.x + dx / relatives.length, y: mine.y + dy / relatives.length }
  }

  // No relative on the tree yet: park them clear of everything, to the right.
  const xs = Object.values(placed).map((p) => p.x)
  const ys = Object.values(placed).map((p) => p.y)
  if (!xs.length) return { x: 0, y: 0 }
  return { x: Math.max(...xs) + 260, y: Math.min(...ys) }
}

/**
 * Freeze the current picture: every visible node keeps exactly where it is.
 * This is what makes an arrangement survive a data change — the layout is still
 * recomputed, but nothing it produces is used for anyone already placed.
 */
export function freeze(layout: TreeLayout): Record<string, Point> {
  const out: Record<string, Point> = {}
  for (const node of layout.nodes) {
    // Ghosts are synthesised, not data — pinning them would resurrect a
    // placeholder after the real person is created.
    if (node.character.ghost) continue
    out[node.id] = { x: node.x, y: node.y }
  }
  return out
}
