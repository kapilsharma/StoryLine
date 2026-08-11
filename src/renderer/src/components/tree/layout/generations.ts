import type { FamilyGraph } from '@shared/graph'
import { parentsOf } from '@shared/graph'

/**
 * Passes 1 and 2 — cycle detection and generation assignment (Requirements/Feature29.md §5).
 */

export interface CycleResult {
  /** Parent→child edges to ignore, as `${parentId}>${childId}`. */
  cutEdges: Set<string>
  warnings: string[]
}

/**
 * Find cycles (a person who is their own ancestor) by DFS, cutting the back edge
 * so everything downstream can assume acyclicity. Not optional — generation
 * assignment would otherwise never terminate.
 */
export function detectCycles(graph: FamilyGraph): CycleResult {
  const cutEdges = new Set<string>()
  const warnings: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (id: string, stack: string[]): void => {
    state.set(id, 'visiting')
    stack.push(id)
    for (const child of graph.childrenOf.get(id) ?? []) {
      const edge = `${id}>${child}`
      if (cutEdges.has(edge)) continue
      const s = state.get(child)
      if (s === 'visiting') {
        cutEdges.add(edge)
        const from = stack.indexOf(child)
        const names = stack
          .slice(from === -1 ? 0 : from)
          .map((n) => graph.byId.get(n)?.name ?? n)
          .join(' → ')
        warnings.push(
          `Ancestry loop: ${names} → ${graph.byId.get(child)?.name ?? child}. One link was ignored so the tree can be drawn.`
        )
        continue
      }
      if (s !== 'done') visit(child, stack)
    }
    stack.pop()
    state.set(id, 'done')
  }

  for (const c of graph.characters) {
    if (!state.has(c.id)) visit(c.id, [])
  }
  return { cutEdges, warnings }
}

export interface GenerationResult {
  gen: Map<string, number>
  warnings: string[]
}

/**
 * Layer characters so every parent is strictly above every child, and spouses
 * share a row.
 *
 * Longest-path layering first, then a levelling loop that pulls each couple onto
 * the same row and re-pushes their descendants down. Both steps only ever
 * *increase* values, and values are bounded by the character count, so on an
 * acyclic graph this terminates. The iteration cap is a backstop for graphs
 * where levelling is impossible (a marriage across generations): the offending
 * couple keeps a slanted partner edge rather than hanging the app.
 */
export function assignGenerations(graph: FamilyGraph, cutEdges: Set<string>): GenerationResult {
  const warnings: string[] = []
  const gen = new Map<string, number>()
  for (const c of graph.characters) gen.set(c.id, 0)

  const parents = (id: string): string[] =>
    parentsOf(graph, id).filter((p) => !cutEdges.has(`${p}>${id}`))

  // ── Longest-path layering, in topological order ──
  const indegree = new Map<string, number>()
  for (const c of graph.characters) indegree.set(c.id, parents(c.id).length)

  const queue = graph.characters.filter((c) => indegree.get(c.id) === 0).map((c) => c.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const child of graph.childrenOf.get(id) ?? []) {
      if (cutEdges.has(`${id}>${child}`)) continue
      const d = (indegree.get(child) ?? 0) - 1
      indegree.set(child, d)
      if (d === 0) queue.push(child)
    }
  }

  for (const id of order) {
    const ps = parents(id)
    gen.set(id, ps.length ? Math.max(...ps.map((p) => gen.get(p) ?? 0)) + 1 : 0)
  }

  // ── Spouse levelling, to a fixpoint ──
  const MAX_ROUNDS = 100
  let round = 0
  let changed = true
  while (changed && round < MAX_ROUNDS) {
    changed = false
    round++

    for (const u of graph.unions) {
      if (u.partnerIds.length < 2) continue
      const g = Math.max(...u.partnerIds.map((p) => gen.get(p) ?? 0))
      for (const p of u.partnerIds) {
        if ((gen.get(p) ?? 0) !== g) {
          gen.set(p, g)
          changed = true
        }
      }
    }

    for (const id of order) {
      const ps = parents(id)
      if (!ps.length) continue
      const needed = Math.max(...ps.map((p) => gen.get(p) ?? 0)) + 1
      if ((gen.get(id) ?? 0) < needed) {
        gen.set(id, needed)
        changed = true
      }
    }
  }

  if (round >= MAX_ROUNDS) {
    warnings.push(
      'Some couples could not be placed on the same row (a marriage spans generations). Their link is drawn slanted.'
    )
  }

  // ── Normalise so the top generation is 0 ──
  const min = Math.min(...[...gen.values()], 0)
  if (min !== 0) for (const [id, g] of gen) gen.set(id, g - min)

  return { gen, warnings }
}
