import type { View } from './types'
import type { FamilyGraph } from './graph'
import { parentsOf, spousesOf } from './graph'

/**
 * Who a family tree draws (Requirements/Feature29.md §4–5).
 *
 * Shared rather than renderer-only because the main process needs it too: a new
 * view has its membership seeded from the filters at creation, and that has to
 * agree exactly with what the canvas would then draw.
 *
 * Layout runs on the resulting subgraph only, so a 40-person view costs a
 * 40-person layout however large the project is.
 */

/**
 * The characters the view's *filters* select.
 *
 * This is where "different family trees" comes from: the same cast renders as
 * his side, her side or the joined tree purely by changing root and the two
 * depths. Since v0.6.0 the result is a **seed** for `view.members` rather than
 * live membership — see {@link viewMembers}.
 */
export function selectCharacters(graph: FamilyGraph, view: View): Set<string> {
  const hidden = new Set(view.hidden)

  // No root = everyone (the default view).
  if (!view.root || !graph.byId.has(view.root)) {
    const all = new Set<string>()
    for (const c of graph.characters) if (!hidden.has(c.id)) all.add(c.id)
    return all
  }

  const selected = new Set<string>()

  /** Walk parents (up) or children (down) from a seed, to a depth cap. */
  const walk = (seed: string, direction: 'up' | 'down', depth: number | null): string[] => {
    const reached: string[] = []
    // null = unlimited; 0 = don't walk at all, which is how "descendants only"
    // and "ancestors only" are expressed without a direction enum.
    if (depth === 0) return reached
    let frontier = [seed]
    let level = 0
    const seen = new Set<string>([seed])
    while (frontier.length && (depth === null || level < depth)) {
      const next: string[] = []
      for (const id of frontier) {
        const step = direction === 'up' ? parentsOf(graph, id) : (graph.childrenOf.get(id) ?? [])
        for (const n of step) {
          if (seen.has(n) || hidden.has(n)) continue
          seen.add(n)
          next.push(n)
          reached.push(n)
        }
      }
      frontier = next
      level++
    }
    return reached
  }

  /** One full walk from a seed, in both directions, plus spouses. */
  const expand = (seed: string): string[] => {
    const added: string[] = []
    const consider = (id: string): void => {
      if (hidden.has(id) || selected.has(id)) return
      selected.add(id)
      added.push(id)
    }

    consider(seed)
    for (const id of walk(seed, 'up', view.parentDepth)) consider(id)

    // Descend from the seed *and* from every ancestor reached, so siblings,
    // cousins and the rest of the branch come along rather than a bare lineage.
    for (const id of [...selected]) {
      for (const d of walk(id, 'down', view.childDepth)) consider(d)
    }

    // Never split a couple: a selected person's spouse always comes too.
    for (const id of [...selected]) {
      for (const s of spousesOf(graph, id)) consider(s)
    }
    return added
  }

  expand(view.root)

  if (view.includeSpouseFamilies) {
    // Re-seed from spouses married into the tree and walk again. Bounded by the
    // same depth caps and by `selected` growing monotonically, so it terminates.
    let frontier = [...selected]
    let guard = 0
    while (frontier.length && guard++ < 100) {
      const nextSeeds: string[] = []
      for (const id of frontier) {
        for (const s of spousesOf(graph, id)) {
          if (hidden.has(s)) continue
          for (const added of expand(s)) nextSeeds.push(added)
        }
      }
      frontier = nextSeeds
    }
  }

  for (const id of hidden) selected.delete(id)
  return selected
}

/**
 * Who this tree actually draws.
 *
 * Membership is `view.members` — an explicit, opt-in list, so a character
 * entered only for context does not appear on every tree, and a tree shaped by
 * hand does not change because someone new was entered elsewhere. The filters
 * seed that list through "Select these" and are otherwise inert.
 *
 * Two fallbacks, in order, for views written before membership existed:
 *
 *  - **Arranged**: the people with a stored position. Never that set intersected
 *    with the filters — importing someone the filter excludes would write them
 *    into `overrides` (so they leave the "not on this tree" list) while the
 *    intersection kept them off the canvas: added, and invisible.
 *  - Otherwise the filters, live.
 *
 * `hidden` applies on top of all three: it is an explicit exclusion, not a
 * filter. Ids of characters that no longer exist are dropped throughout, so a
 * stale member or override is ignored rather than drawn as a ghost.
 */
export function viewMembers(graph: FamilyGraph, view: View): Set<string> {
  const hidden = new Set(view.hidden)
  const keep = (ids: Iterable<string>): Set<string> =>
    new Set([...ids].filter((id) => graph.byId.has(id) && !hidden.has(id)))

  if (view.members) return keep(view.members)
  if (view.arranged) return keep(Object.keys(view.overrides ?? {}))
  return keep(selectCharacters(graph, view))
}

/**
 * What "Select these" writes into `view.members` — the filters' selection,
 * spelled out. Ghosts are dropped: they are synthesised placeholders, not
 * characters, so pinning one into a membership list would outlive the real
 * person being created.
 */
export function filterSelection(graph: FamilyGraph, view: View): string[] {
  const hidden = new Set(view.hidden)
  return [...selectCharacters(graph, view)]
    .filter((id) => !hidden.has(id) && !graph.byId.get(id)?.ghost)
    .sort()
}

/**
 * Characters on the board but not on this tree — the pool "+ Add person" offers.
 * Ghosts are excluded for the same reason as above.
 */
export function nonMembers(graph: FamilyGraph, view: View): string[] {
  const on = viewMembers(graph, view)
  return graph.characters
    .filter((c) => !c.ghost && !on.has(c.id))
    .map((c) => c.id)
    .sort()
}

/** Restrict a graph to a set of ids, dropping unions that lost every member. */
export function subgraph(graph: FamilyGraph, ids: Set<string>): FamilyGraph {
  const characters = graph.characters.filter((c) => ids.has(c.id))
  const byId = new Map(characters.map((c) => [c.id, c]))

  const unions = graph.unions
    .map((u) => ({
      ...u,
      partnerIds: u.partnerIds.filter((p) => ids.has(p)),
      childIds: u.childIds.filter((c) => ids.has(c))
    }))
    .filter((u) => u.partnerIds.length > 0 && (u.partnerIds.length > 1 || u.childIds.length > 0))

  const unionById = new Map(unions.map((u) => [u.id, u]))
  const unionsOf = new Map<string, string[]>()
  const childUnionOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()

  for (const u of unions) {
    for (const p of u.partnerIds) {
      const list = unionsOf.get(p) ?? []
      list.push(u.id)
      unionsOf.set(p, list)

      const kids = childrenOf.get(p) ?? []
      for (const c of u.childIds) if (!kids.includes(c)) kids.push(c)
      childrenOf.set(p, kids)
    }
    for (const c of u.childIds) childUnionOf.set(c, u.id)
  }

  return {
    byId,
    characters,
    unions,
    unionsOf,
    childUnionOf,
    unionById,
    childrenOf,
    problems: graph.problems
  }
}
