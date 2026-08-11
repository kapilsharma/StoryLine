import type { View } from '@shared/types'
import type { FamilyGraph } from '@shared/graph'
import { assignCoordinates } from './coordinates'
import { buildUnionsAndEdges } from './edges'
import { assignGenerations, detectCycles } from './generations'
import { orderGenerations } from './ordering'
import { subgraph, viewMembers } from '@shared/selection'
import { DEFAULT_LAYOUT_OPTIONS, EMPTY_LAYOUT, type LayoutNode, type LayoutOptions, type TreeLayout } from './types'

export * from './types'
// Membership and subgraph selection live in `@shared/selection`: the main process
// seeds a new view's members from the filters, and that has to agree exactly with
// what the canvas draws. Re-exported here so the tree has one import surface.
export {
  filterSelection,
  nonMembers,
  selectCharacters,
  subgraph,
  viewMembers
} from '@shared/selection'
export { detectCycles, assignGenerations } from './generations'
export { orderGenerations } from './ordering'
export { assignCoordinates } from './coordinates'
export { elbowPath, buildUnionsAndEdges } from './edges'
export { routeThrough, virtualBends, elbowPolyline, type Point } from './routing'
export { assignLanes, laneY } from './lanes'
export { arrangedMembers, freeze, suggestPosition } from './placement'

/**
 * The whole pipeline: a graph and a view in, coordinates out.
 *
 *   0. selection   — which characters this view shows
 *   1. validate    — cut cycles so the rest can assume a DAG
 *   2. generations — layer, with spouses levelled onto the same row
 *   3. ordering    — left-to-right order within each generation
 *   4. coordinates — x/y positions
 *   5. edges       — connector paths
 *
 * Pure: no React, no DOM, no filesystem. That is what makes the hard part of
 * this app cheap to test (Requirements/Feature29.md §5).
 */
export function layoutTree(
  graph: FamilyGraph,
  view: View,
  options: Partial<LayoutOptions> = {}
): TreeLayout {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options }

  const selected = viewMembers(graph, view)

  if (!selected.size) return EMPTY_LAYOUT

  let sub = subgraph(graph, selected)

  // Ghosts are synthesised placeholders; when the view hides them they are
  // dropped before layout so they take up no space either.
  if (!view.showGhosts) {
    const withoutGhosts = new Set([...selected].filter((id) => !graph.byId.get(id)?.ghost))
    if (!withoutGhosts.size) return EMPTY_LAYOUT
    sub = subgraph(graph, withoutGhosts)
  }

  // Collapsed branches: drop every descendant of a collapsed character.
  if (view.collapsed.length) {
    const drop = new Set<string>()
    const walk = (id: string): void => {
      for (const child of sub.childrenOf.get(id) ?? []) {
        if (drop.has(child)) continue
        drop.add(child)
        walk(child)
      }
    }
    for (const id of view.collapsed) if (sub.byId.has(id)) walk(id)
    if (drop.size) {
      const kept = new Set(sub.characters.map((c) => c.id).filter((id) => !drop.has(id)))
      sub = subgraph(sub, kept)
    }
  }

  const { cutEdges, warnings: cycleWarnings } = detectCycles(sub)
  const { gen, warnings: genWarnings } = assignGenerations(sub, cutEdges)
  const order = orderGenerations(sub, gen, cutEdges)
  const { x, y } = assignCoordinates(sub, gen, order, cutEdges, opts)

  /**
   * Manual positions win over the computed ones. Applied *before* edges
   * are built, so every connector is drawn from where the node actually is —
   * dragging a person re-routes their lines rather than leaving them behind.
   */
  let hasOverrides = false
  for (const [id, position] of Object.entries(view.overrides ?? {})) {
    if (!x.has(id) || !position) continue
    if (typeof position.x !== 'number' || typeof position.y !== 'number') continue
    x.set(id, position.x)
    y.set(id, position.y)
    hasOverrides = true
  }

  const { unions, edges } = buildUnionsAndEdges({
    graph: sub,
    x,
    y,
    gen,
    opts,
    routes: view.edgeRoutes
  })

  const pinned = new Set(hasOverrides ? Object.keys(view.overrides ?? {}) : [])
  const nodes: LayoutNode[] = sub.characters
    .filter((c) => x.has(c.id))
    .map((c) => ({
      id: c.id,
      character: c,
      x: x.get(c.id)!,
      y: y.get(c.id)!,
      gen: gen.get(c.id) ?? 0,
      ...(pinned.has(c.id) ? { pinned: true } : {})
    }))

  const byGeneration = new Map<number, LayoutNode[]>()
  for (const n of nodes) {
    const list = byGeneration.get(n.gen) ?? []
    list.push(n)
    byGeneration.set(n.gen, list)
  }
  for (const list of byGeneration.values()) list.sort((a, b) => a.x - b.x)

  const halfW = opts.nodeWidth / 2
  const halfH = opts.nodeHeight / 2
  const bounds = {
    minX: Math.min(...nodes.map((n) => n.x - halfW)),
    minY: Math.min(...nodes.map((n) => n.y - halfH)),
    maxX: Math.max(...nodes.map((n) => n.x + halfW)),
    maxY: Math.max(...nodes.map((n) => n.y + halfH))
  }

  return {
    nodes,
    unions,
    edges,
    bounds,
    byGeneration,
    hasOverrides,
    warnings: [...cycleWarnings, ...genWarnings]
  }
}

/**
 * Nodes intersecting a viewport rectangle, in world coordinates.
 * Binary-searches each visible generation rather than scanning every node.
 */
export function visibleNodes(
  layout: TreeLayout,
  rect: { x: number; y: number; width: number; height: number },
  opts: LayoutOptions = DEFAULT_LAYOUT_OPTIONS
): LayoutNode[] {
  const halfW = opts.nodeWidth / 2
  const halfH = opts.nodeHeight / 2
  const out: LayoutNode[] = []

  // The fast path below assumes every node in a generation shares one y and is
  // sorted by x. A hand-positioned node breaks both, so fall back to a scan —
  // still trivial at the sizes where anyone is dragging things by hand.
  if (layout.hasOverrides) {
    return layout.nodes.filter(
      (n) =>
        n.x + halfW >= rect.x &&
        n.x - halfW <= rect.x + rect.width &&
        n.y + halfH >= rect.y &&
        n.y - halfH <= rect.y + rect.height
    )
  }

  for (const [, list] of layout.byGeneration) {
    if (!list.length) continue
    const rowY = list[0].y
    if (rowY + halfH < rect.y || rowY - halfH > rect.y + rect.height) continue

    // list is sorted by x — find the first node whose right edge is in view.
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].x + halfW < rect.x) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < list.length && list[i].x - halfW <= rect.x + rect.width; i++) {
      out.push(list[i])
    }
  }
  return out
}
