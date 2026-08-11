import type { FamilyGraph } from '@shared/graph'
import { birthOrder, parentsOf } from '@shared/graph'

/**
 * Pass 3 — left-to-right order within each generation (Requirements/Feature29.md §5).
 *
 * Depth-first over the union forest, which is the trick that keeps the result
 * tidy: partners are emitted adjacently and a sibling group is emitted
 * contiguously, so the coordinate pass never has to pull a family back together.
 *
 * The order produced here is an invariant for the rest of the pipeline —
 * `coordinates.ts` may push nodes apart but never reorders them.
 */
export function orderGenerations(
  graph: FamilyGraph,
  gen: Map<string, number>,
  cutEdges: Set<string>
): Map<number, string[]> {
  const result = new Map<number, string[]>()
  const visited = new Set<string>()

  const emitPerson = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)
    const g = gen.get(id) ?? 0
    const list = result.get(g) ?? []
    list.push(id)
    result.set(g, list)
  }

  const emitUnion = (unionId: string): void => {
    const u = graph.unionById.get(unionId)
    if (!u) return
    // Partners first and adjacent — this is what keeps couples together.
    for (const p of u.partnerIds) emitPerson(p)

    for (const childId of u.childIds) {
      if (cutEdges.has(`${u.partnerIds[0]}>${childId}`)) continue
      const childUnions = graph.unionsOf.get(childId) ?? []
      if (childUnions.length) {
        // Emitting the child's own union places the child *and* their spouse.
        for (const cu of childUnions) emitUnion(cu)
      } else {
        emitPerson(childId)
      }
    }
  }

  /** A union is a root when no partner has parents inside the graph. */
  const isRootUnion = (unionId: string): boolean => {
    const u = graph.unionById.get(unionId)!
    return u.partnerIds.every((p) => parentsOf(graph, p).length === 0)
  }

  const earliest = (unionId: string): string => {
    const u = graph.unionById.get(unionId)!
    const dates = u.partnerIds
      .map((p) => graph.byId.get(p)?.birthday)
      .filter((d): d is string => Boolean(d))
      .sort()
    return dates[0] ?? '9999'
  }

  const roots = graph.unions
    .map((u) => u.id)
    .filter(isRootUnion)
    .sort((a, b) => {
      const d = earliest(a).localeCompare(earliest(b))
      return d !== 0 ? d : a.localeCompare(b)
    })

  for (const r of roots) emitUnion(r)

  // Anything still unvisited: unions reachable only through a cut edge, and
  // characters with no relations at all. Never drop a character silently.
  for (const u of graph.unions) emitUnion(u.id)
  for (const c of [...graph.characters].sort(birthOrder)) emitPerson(c.id)

  return result
}
