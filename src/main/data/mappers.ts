import type { Character, Note, RelatedNote, TimelineUnit } from '@shared/types'

/**
 * Conversion between parsed frontmatter (`Record<string, unknown>`) and typed
 * domain entities. Reads are lenient (never throw on odd external edits);
 * writes emit the canonical shape from Requirements/index.md §3.
 */

/** Keys handled explicitly on a character; everything else becomes `custom`. */
const CHARACTER_KNOWN_KEYS = ['id', 'type', 'name', 'colour', 'role', 'age', 'species', 'tags', 'group']
// `type` retired in v0.6.1 — still listed so a leftover value in an old/external
// file is ignored (dropped on next write), not preserved as a `custom` field.
const TIMELINE_KNOWN_KEYS = ['id', 'type', 'label', 'order', 'summary', 'tags', 'group']

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

function collectCustom(data: Record<string, unknown>, known: string[]): Record<string, unknown> | undefined {
  const custom: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!known.includes(k)) custom[k] = v
  }
  return Object.keys(custom).length ? custom : undefined
}

// ── Character ──────────────────────────────────────────────────────────────

export function frontmatterToCharacter(data: Record<string, unknown>, id: string): Character {
  const char: Character = {
    id: asString(data.id, id),
    type: 'character',
    name: asString(data.name, id),
    colour: asString(data.colour, '#888888')
  }
  if (typeof data.role === 'string') char.role = data.role
  if (typeof data.age === 'number') char.age = data.age
  if (typeof data.species === 'string') char.species = data.species
  if (typeof data.group === 'string' && data.group.trim()) char.group = data.group.trim()
  const tags = asStringArray(data.tags)
  if (tags) char.tags = tags
  const custom = collectCustom(data, CHARACTER_KNOWN_KEYS)
  if (custom) char.custom = custom
  return char
}

export function characterToFrontmatter(c: Character): Record<string, unknown> {
  return {
    id: c.id,
    type: 'character',
    name: c.name,
    colour: c.colour,
    ...(c.role !== undefined ? { role: c.role } : {}),
    ...(c.age !== undefined ? { age: c.age } : {}),
    ...(c.species !== undefined ? { species: c.species } : {}),
    ...(c.group !== undefined ? { group: c.group } : {}),
    ...(c.tags?.length ? { tags: c.tags } : {}),
    ...(c.custom ?? {})
  }
}

// ── Timeline unit ────────────────────────────────────────────────────────────

export function frontmatterToTimelineUnit(data: Record<string, unknown>, id: string): TimelineUnit {
  const unit: TimelineUnit = {
    id: asString(data.id, id),
    label: asString(data.label, id),
    order: typeof data.order === 'number' ? data.order : 0
  }
  if (typeof data.summary === 'string') unit.summary = data.summary
  if (typeof data.group === 'string' && data.group.trim()) unit.group = data.group.trim()
  const tags = asStringArray(data.tags)
  if (tags) unit.tags = tags
  const custom = collectCustom(data, TIMELINE_KNOWN_KEYS)
  if (custom) unit.custom = custom
  return unit
}

export function timelineUnitToFrontmatter(u: TimelineUnit): Record<string, unknown> {
  return {
    id: u.id,
    label: u.label,
    order: u.order,
    ...(u.summary !== undefined ? { summary: u.summary } : {}),
    ...(u.group !== undefined ? { group: u.group } : {}),
    ...(u.tags?.length ? { tags: u.tags } : {}),
    ...(u.custom ?? {})
  }
}

// ── Note ─────────────────────────────────────────────────────────────────────

/**
 * Normalize the `related` field. Canonical form is `[{ file, comment }]`; a
 * bare string is coerced to `{ file, comment: null }` so externally-edited
 * files never crash the reader.
 */
function normalizeRelated(v: unknown): RelatedNote[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: RelatedNote[] = []
  for (const entry of v) {
    if (typeof entry === 'string') {
      out.push({ file: entry, comment: null })
    } else if (entry && typeof entry === 'object' && typeof (entry as { file?: unknown }).file === 'string') {
      const e = entry as { file: string; comment?: unknown }
      out.push({ file: e.file, comment: typeof e.comment === 'string' ? e.comment : null })
    }
  }
  return out.length ? out : undefined
}

export function frontmatterToNote(data: Record<string, unknown>, id: string, body: string): Note {
  const note: Note = {
    id,
    title: asString(data.title, id),
    body
  }
  if (typeof data.uid === 'string' && data.uid.trim()) note.uid = data.uid.trim()
  const tags = asStringArray(data.tags)
  if (tags) note.tags = tags
  const boards = asStringArray(data.boards)
  if (boards) note.boards = boards
  const related = normalizeRelated(data.related)
  if (related) note.related = related
  if (typeof data.created === 'string') note.created = data.created
  return note
}

export function noteToFrontmatter(n: Note): Record<string, unknown> {
  return {
    ...(n.uid ? { uid: n.uid } : {}),
    title: n.title,
    ...(n.tags?.length ? { tags: n.tags } : {}),
    ...(n.boards?.length ? { boards: n.boards } : {}),
    ...(n.related?.length
      ? { related: n.related.map((r) => ({ file: r.file, comment: r.comment })) }
      : {}),
    ...(n.created !== undefined ? { created: n.created } : {})
  }
}
