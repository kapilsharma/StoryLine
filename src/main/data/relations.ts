import type { Character } from '@shared/types'

/**
 * Relation bookkeeping that spans more than one file.
 *
 * `father` / `mother` are canonical and live on the child, so they need no
 * cross-file work. `spouse` is symmetric with no natural owner, so saving one
 * side has to write the other (Requirements/Feature29.md §3) — and deleting or renaming a
 * character has to fix every file that points at them.
 *
 * All functions here are pure: they take the current character list and return
 * the set of characters that need writing. The repository does the I/O.
 */

/** Characters that must be written to make `next`'s spouse list symmetric. */
export function syncSpouses(all: Character[], next: Character): Character[] {
  const byId = new Map(all.map((c) => [c.id, c]))
  // The saved character itself is written by the caller; this returns the others.
  const out = new Map<string, Character>()

  const previous = byId.get(next.id)
  const before = new Set(previous?.spouse ?? [])
  const after = new Set((next.spouse ?? []).filter((s) => s !== next.id))

  // Newly added partners gain `next` in their own spouse list.
  for (const id of after) {
    if (before.has(id)) continue
    const partner = byId.get(id)
    if (!partner) continue
    const list = new Set(partner.spouse ?? [])
    if (list.has(next.id)) continue
    list.add(next.id)
    out.set(id, { ...partner, spouse: [...list] })
  }

  // Removed partners lose it again.
  for (const id of before) {
    if (after.has(id)) continue
    const partner = byId.get(id)
    if (!partner?.spouse?.includes(next.id)) continue
    out.set(id, { ...partner, spouse: partner.spouse.filter((s) => s !== next.id) })
  }

  return [...out.values()]
}

/**
 * Characters that need writing after `deletedId` is removed: anyone naming them
 * as a parent or spouse. Their relation is cleared rather than left dangling —
 * an intentional delete should not leave a ghost node behind.
 */
export function clearReferencesTo(all: Character[], deletedId: string): Character[] {
  const out: Character[] = []
  for (const c of all) {
    if (c.id === deletedId) continue
    let changed = false
    const next: Character = { ...c }
    if (c.father === deletedId) {
      delete next.father
      changed = true
    }
    if (c.mother === deletedId) {
      delete next.mother
      changed = true
    }
    if (c.spouse?.includes(deletedId)) {
      const rest = c.spouse.filter((s) => s !== deletedId)
      if (rest.length) next.spouse = rest
      else delete next.spouse
      changed = true
    }
    if (changed) out.push(next)
  }
  return out
}

/** Characters that need writing after `oldId` becomes `newId`. */
export function retargetReferences(all: Character[], oldId: string, newId: string): Character[] {
  const out: Character[] = []
  for (const c of all) {
    if (c.id === oldId) continue
    let changed = false
    const next: Character = { ...c }
    if (c.father === oldId) {
      next.father = newId
      changed = true
    }
    if (c.mother === oldId) {
      next.mother = newId
      changed = true
    }
    if (c.spouse?.includes(oldId)) {
      next.spouse = c.spouse.map((s) => (s === oldId ? newId : s))
      changed = true
    }
    if (changed) out.push(next)
  }
  return out
}

/**
 * Apply a Children edit by rewriting the *children's* parent fields — the UI
 * offers a Children list, but the child→parent edge is what gets stored.
 *
 * `parent` is the character whose Children list changed; `childIds` is the new
 * list. Returns the children that need writing.
 */
export function applyChildren(all: Character[], parent: Character, childIds: string[]): Character[] {
  const byId = new Map(all.map((c) => [c.id, c]))
  const field: 'father' | 'mother' = parent.gender === 'female' ? 'mother' : 'father'
  const wanted = new Set(childIds.filter((id) => id !== parent.id))
  const out = new Map<string, Character>()

  for (const id of wanted) {
    const child = byId.get(id)
    if (!child || child[field] === parent.id) continue
    out.set(id, { ...child, [field]: parent.id })
  }

  // Anyone who used to be a child of this parent but is no longer listed.
  for (const c of all) {
    if (wanted.has(c.id) || c[field] !== parent.id) continue
    const next: Character = { ...c }
    delete next[field]
    out.set(c.id, next)
  }

  return [...out.values()]
}
