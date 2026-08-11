import type { Character } from './types'

/**
 * Families — the grouping that colours the tree.
 *
 * Colouring every person differently carries no information: fifteen colours on
 * fifteen boxes is just noise. Colouring by *family* makes the thing you
 * actually want to see visible at a glance — which branch someone belongs to,
 * and where two families join.
 *
 * The model deliberately keeps `name` free-form:
 *
 *   name: "Rowan"          family: "Ashvale"   → shown as "Rowan Ashvale"
 *   name: "Ines Calder"    family: "Ashvale"   → shown as "Ines Calder"
 *
 * The second case is the point: someone who keeps their surname after marriage
 * writes the whole thing in `name`, while `family` still says which group they
 * belong to for colour. Nothing forces the two to agree.
 */

/**
 * A palette chosen for hue separation at small sizes, and to stay legible on
 * both themes. Assignment is by sorted family name, so a family's colour never
 * shifts as people are added.
 */
export const FAMILY_PALETTE = [
  '#3B6FD4', // blue
  '#C2413B', // red
  '#2E8B67', // green
  '#9A5BC7', // purple
  '#C9761E', // amber
  '#1F8B9E', // teal
  '#B23F86', // magenta
  '#6B7A2E', // olive
  '#4B5C8C', // slate blue
  '#A65B3A' // brick
]

export const UNKNOWN_FAMILY_COLOUR = '#8A8A90'

/** The last word of a name — the default family for a file that has none. */
export function familyFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * The family a character belongs to. Explicit `family` wins; otherwise it is
 * inferred from the surname, so existing files group correctly with no edit.
 */
export function familyOf(character: Character): string {
  const explicit = character.family?.trim()
  if (explicit) return explicit
  return familyFromName(character.name)
}

/**
 * What the node shows.
 *
 * The family is appended only when `name` is a single word — that is, when no
 * surname was typed. If the name already carries a surname it is shown exactly
 * as written, whether or not it matches the family.
 *
 * That last part is the whole reason the fields are separate:
 *
 *   name: "Rowan"        family: "Ashvale"  → "Rowan Ashvale"   (surname supplied)
 *   name: "Rowan Ashvale" family: "Ashvale"  → "Rowan Ashvale"   (not duplicated)
 *   name: "Ines Calder"  family: "Ashvale"  → "Ines Calder"    (kept her surname)
 *
 * Someone who married in and kept their own surname keeps it on the tree, while
 * still being coloured with the family they joined.
 */
export function displayName(character: Character): string {
  const name = character.name.trim()
  const family = character.family?.trim()
  if (!family) return name
  if (!name) return family
  // More than one word means a surname is already present — leave it alone.
  if (name.split(/\s+/).length > 1) return name
  return `${name} ${family}`
}

/** Every family present, sorted — the order colours are assigned in. */
export function familiesIn(characters: Character[]): string[] {
  const seen = new Set<string>()
  for (const c of characters) {
    if (c.ghost) continue
    const family = familyOf(c)
    if (family) seen.add(family)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Family → colour. Existing assignments are preserved so a colour never moves
 * when someone is added; new families take the next unused palette entry.
 */
export function assignFamilyColours(
  families: string[],
  existing: Record<string, string> = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()

  for (const family of families) {
    const kept = existing[family]
    if (kept) {
      out[family] = kept
      used.add(kept.toLowerCase())
    }
  }

  for (const family of families) {
    if (out[family]) continue
    const free = FAMILY_PALETTE.find((c) => !used.has(c.toLowerCase()))
    // More families than palette entries: wrap round rather than run out.
    const colour = free ?? FAMILY_PALETTE[families.indexOf(family) % FAMILY_PALETTE.length]
    out[family] = colour
    used.add(colour.toLowerCase())
  }

  return out
}

/** The colour to draw a character in. */
export function colourFor(character: Character, families: Record<string, string>): string {
  if (character.ghost) return UNKNOWN_FAMILY_COLOUR
  const family = familyOf(character)
  return families[family] ?? UNKNOWN_FAMILY_COLOUR
}
