import type { Character, Problem, Union } from './types'

/**
 * Pure graph construction: a flat list of characters becomes the people-and-unions
 * structure the layout engine positions (Requirements/Feature29.md §5).
 *
 * A family tree is not a tree — it is a DAG with two-parent edges, remarriage and
 * the occasional cousin marriage. Laying out *unions* rather than people is what
 * keeps spouses adjacent and siblings contiguous.
 *
 * No filesystem, no React: `buildGraph` is used by the main process, the renderer
 * and the tests alike.
 */

export interface FamilyGraph {
  /** Every character by id, including synthesised ghosts for dangling refs. */
  byId: Map<string, Character>
  /** Display order is not implied — use the layout for that. */
  characters: Character[]
  unions: Union[]
  /** Union ids a character belongs to as a *partner*. */
  unionsOf: Map<string, string[]>
  /** Union id a character belongs to as a *child* (at most one). */
  childUnionOf: Map<string, string>
  unionById: Map<string, Union>
  /** Derived children per character id — never stored on disk. */
  childrenOf: Map<string, string[]>
  problems: Problem[]
}

/** Union key for a (father, mother) pair — either side may be missing. */
export function unionKey(fatherId?: string, motherId?: string): string {
  return `${fatherId ?? '_'}+${motherId ?? '_'}`
}

/**
 * Sort key for siblings and root ordering: birthday first (ISO strings sort
 * correctly as long as they are zero-padded), then name. Characters with no
 * birthday sort last, so a known sequence is never broken up by unknowns.
 */
export function birthOrder(a: Character, b: Character): number {
  const ab = a.birthday ?? ''
  const bb = b.birthday ?? ''
  if (ab && bb && ab !== bb) return ab < bb ? -1 : 1
  if (ab && !bb) return -1
  if (!ab && bb) return 1
  return a.name.localeCompare(b.name)
}

/** A placeholder for a referenced-but-missing character. */
function ghostFor(id: string): Character {
  return {
    id,
    type: 'character',
    // Best-effort label from the slug: "edmund-ashvale" → "Edmund Ashvale".
    name: id
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    colour: '#B0B0B0',
    gender: 'unknown',
    ghost: true
  }
}

/**
 * Build the graph. Lenient by design: bad references become problems and ghosts
 * rather than exceptions, because a genealogy project is always partially entered.
 */
export function buildGraph(input: Character[]): FamilyGraph {
  const problems: Problem[] = []
  const byId = new Map<string, Character>()
  for (const c of input) byId.set(c.id, c)

  // ── Normalise relations: drop self-references, synthesise ghosts ──
  const ghosts = new Map<string, Character>()
  const parentRef = (c: Character, field: 'father' | 'mother'): string | undefined => {
    const ref = c[field]
    if (!ref) return undefined
    if (ref === c.id) {
      problems.push({
        kind: 'self-reference',
        id: c.id,
        message: `${c.name} is listed as their own ${field} — ignored.`
      })
      return undefined
    }
    if (!byId.has(ref) && !ghosts.has(ref)) {
      ghosts.set(ref, ghostFor(ref))
      problems.push({
        kind: 'dangling',
        id: ref,
        message: `${c.name}'s ${field} "${ref}" has no character file.`
      })
    }
    return ref
  }

  for (const c of input) {
    parentRef(c, 'father')
    parentRef(c, 'mother')
    for (const s of c.spouse ?? []) {
      if (s === c.id) {
        problems.push({
          kind: 'self-reference',
          id: c.id,
          message: `${c.name} is listed as their own spouse — ignored.`
        })
        continue
      }
      if (!byId.has(s) && !ghosts.has(s)) {
        ghosts.set(s, ghostFor(s))
        problems.push({
          kind: 'dangling',
          id: s,
          message: `${c.name}'s spouse "${s}" has no character file.`
        })
      }
    }
  }
  for (const [id, g] of ghosts) byId.set(id, g)

  const characters = [...byId.values()]

  // ── Spouse symmetry: union of both directions, so a half-written pair heals ──
  const spouseSets = new Map<string, Set<string>>()
  for (const c of characters) spouseSets.set(c.id, new Set())
  for (const c of characters) {
    for (const s of c.spouse ?? []) {
      if (s === c.id || !spouseSets.has(s)) continue
      spouseSets.get(c.id)!.add(s)
      spouseSets.get(s)!.add(c.id)
    }
  }
  for (const c of characters) {
    const declared = new Set(c.spouse ?? [])
    for (const s of spouseSets.get(c.id)!) {
      if (!declared.has(s) && !c.ghost) {
        problems.push({
          kind: 'asymmetric-spouse',
          id: c.id,
          message: `${byId.get(s)?.name ?? s} lists ${c.name} as spouse, but not the other way round — treated as a couple.`
        })
      }
    }
  }

  // ── Unions ──
  const unionById = new Map<string, Union>()
  const ensureUnion = (partnerIds: string[]): Union => {
    const [a, b] = partnerIds
    const id = unionKey(a, b)
    let u = unionById.get(id)
    if (!u) {
      u = { id, partnerIds: partnerIds.filter(Boolean), childIds: [] }
      unionById.set(id, u)
    }
    return u
  }

  // 1. Parent pairs, from each child's father/mother.
  const childUnionOf = new Map<string, string>()
  for (const c of characters) {
    const father = c.father === c.id ? undefined : c.father
    const mother = c.mother === c.id ? undefined : c.mother
    if (!father && !mother) continue
    const u = ensureUnion([father as string, mother as string])
    u.childIds.push(c.id)
    childUnionOf.set(c.id, u.id)
  }

  // 2. Marriages, which may have no children yet.
  const seenPair = new Set<string>()
  for (const c of characters) {
    for (const s of spouseSets.get(c.id)!) {
      // A couple's union key is (father, mother) — orient it by gender where we
      // can, so a marriage and its children resolve to the same key.
      const other = byId.get(s)!
      let a = c.id
      let b = s
      if (c.gender === 'female' || other.gender === 'male') {
        a = s
        b = c.id
      }
      const key = unionKey(a, b)
      if (seenPair.has(key)) continue
      seenPair.add(key)
      ensureUnion([a, b])
    }
  }

  // Sort children within each union.
  for (const u of unionById.values()) {
    u.childIds.sort((x, y) => birthOrder(byId.get(x)!, byId.get(y)!))
  }

  const unionsOf = new Map<string, string[]>()
  for (const u of unionById.values()) {
    for (const p of u.partnerIds) {
      const list = unionsOf.get(p) ?? []
      list.push(u.id)
      unionsOf.set(p, list)
    }
  }

  const childrenOf = new Map<string, string[]>()
  for (const u of unionById.values()) {
    for (const p of u.partnerIds) {
      const list = childrenOf.get(p) ?? []
      for (const c of u.childIds) if (!list.includes(c)) list.push(c)
      childrenOf.set(p, list)
    }
  }

  return {
    byId,
    characters,
    unions: [...unionById.values()],
    unionsOf,
    childUnionOf,
    unionById,
    childrenOf,
    problems
  }
}

/** Parent ids of a character that exist in the graph. */
export function parentsOf(graph: FamilyGraph, id: string): string[] {
  const c = graph.byId.get(id)
  if (!c) return []
  const out: string[] = []
  if (c.father && c.father !== id && graph.byId.has(c.father)) out.push(c.father)
  if (c.mother && c.mother !== id && graph.byId.has(c.mother)) out.push(c.mother)
  return out
}

/** Spouse ids of a character, symmetric across both directions. */
export function spousesOf(graph: FamilyGraph, id: string): string[] {
  const out = new Set<string>()
  for (const uid of graph.unionsOf.get(id) ?? []) {
    const u = graph.unionById.get(uid)!
    for (const p of u.partnerIds) if (p !== id) out.add(p)
  }
  return [...out]
}
