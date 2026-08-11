import type { Character, Gender, Note, RelatedNote, TimelineUnit, View } from '@shared/types'
import { GENDERS, SCHEMA_VERSION, defaultView } from '@shared/types'
import { toPartialDate } from '@shared/dates'

/**
 * Conversion between parsed frontmatter (`Record<string, unknown>`) and typed
 * domain entities. Reads are lenient (never throw on odd external edits);
 * writes emit the canonical shape from Requirements/index.md §3.
 */

/**
 * Keys handled explicitly on a character; everything else becomes `custom`.
 * The family block was added in v0.6.0 — before then those keys round-tripped
 * through `custom`, which is exactly why the addition needs no migration.
 */
const CHARACTER_KNOWN_KEYS = [
  'id',
  'type',
  'name',
  'colour',
  'role',
  'age',
  'species',
  'tags',
  'group',
  // family
  'family',
  'gender',
  'birthday',
  'died',
  'maidenName',
  'father',
  'mother',
  'spouse',
  // read as a hint, never written back — children are derived from father/mother
  'children'
]
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

/**
 * Like {@link asStringArray} but trims and drops blanks, and accepts a bare
 * string as a one-element list — relation fields are hand-edited often enough
 * that `spouse: mira-renmoor` has to work.
 */
function asIdArray(v: unknown): string[] | undefined {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : undefined
  if (!Array.isArray(v)) return undefined
  const out = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
  return out.length ? out : undefined
}

function asGender(v: unknown): Gender {
  const s = asString(v).toLowerCase().trim()
  return (GENDERS as string[]).includes(s) ? (s as Gender) : 'unknown'
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

  // ── Family fields (v0.6.0) ──
  if (typeof data.family === 'string' && data.family.trim()) char.family = data.family.trim()
  // Absent stays absent, so a character that never met the Family tab is written
  // back byte-identical rather than gaining `gender: unknown`.
  if (data.gender !== undefined) char.gender = asGender(data.gender)
  // Dates go through the coercion in dates.ts, which un-mangles a YAML Date (from
  // an unquoted full date) or a Number (from a bare year) back into a string.
  const birthday = toPartialDate(data.birthday)
  if (birthday) char.birthday = birthday
  const died = toPartialDate(data.died)
  if (died) char.died = died
  if (typeof data.maidenName === 'string' && data.maidenName.trim()) {
    char.maidenName = data.maidenName.trim()
  }
  if (typeof data.father === 'string' && data.father.trim()) char.father = data.father.trim()
  if (typeof data.mother === 'string' && data.mother.trim()) char.mother = data.mother.trim()
  const spouse = asIdArray(data.spouse)
  if (spouse) char.spouse = spouse

  const custom = collectCustom(data, CHARACTER_KNOWN_KEYS)
  if (custom) char.custom = custom
  return char
}

/**
 * The canonical on-disk shape. Note what is *not* here: `children`, which is
 * derived from father/mother at load time and never written.
 *
 * Dates stay JS strings all the way to `matter.stringify`, which quotes any
 * string that would otherwise parse as a date or number — so `1984-06-12` is
 * written as `'1984-06-12'` and cannot be re-typed on the next read. See dates.ts.
 */
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
    ...(c.family ? { family: c.family } : {}),
    ...(c.gender ? { gender: c.gender } : {}),
    ...(c.birthday ? { birthday: c.birthday } : {}),
    ...(c.died ? { died: c.died } : {}),
    ...(c.maidenName ? { maidenName: c.maidenName } : {}),
    ...(c.father ? { father: c.father } : {}),
    ...(c.mother ? { mother: c.mother } : {}),
    ...(c.spouse?.length ? { spouse: c.spouse } : {}),
    ...(c.custom ?? {})
  }
}

/**
 * Any `children:` key found in a hand-edited file, as a reconcile hint. Never
 * trusted as data and never written back — the child→parent edge is canonical.
 */
export function childrenHint(data: Record<string, unknown>): string[] | undefined {
  return asIdArray(data.children)
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

// ── Family-tree view (JSON, not frontmatter) ─────────────────────────────────

function asDepth(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  return null
}

/**
 * Drop anything that is not a list of finite points, so a hand-edited view file
 * cannot produce NaN geometry on the canvas.
 */
function normalizeRoutes(raw: unknown): Record<string, Array<{ x: number; y: number }>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, Array<{ x: number; y: number }>> = {}
  for (const [id, points] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(points)) continue
    const clean = points.filter(
      (p): p is { x: number; y: number } =>
        Boolean(p) &&
        typeof (p as { x?: unknown }).x === 'number' &&
        typeof (p as { y?: unknown }).y === 'number' &&
        Number.isFinite((p as { x: number }).x) &&
        Number.isFinite((p as { y: number }).y)
    )
    if (clean.length) out[id] = clean
  }
  return out
}

/** Same for node positions — a junk override would place a node at NaN. */
function normalizeOverrides(raw: unknown): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, { x: number; y: number }> = {}
  for (const [id, p] of Object.entries(raw as Record<string, unknown>)) {
    const point = p as { x?: unknown; y?: unknown } | null
    if (!point) continue
    if (typeof point.x !== 'number' || typeof point.y !== 'number') continue
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    out[id] = { x: point.x, y: point.y }
  }
  return out
}

/** Backfill defaults so older or partial view files load cleanly. */
export function normalizeView(raw: Partial<View>, id: string): View {
  const base = defaultView(id, raw.name ?? id)
  return {
    ...base,
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : SCHEMA_VERSION,
    id,
    // Pre-Issue-30 views (no mode) are free-flow; only an explicit 'timeline' opts in.
    mode: raw.mode === 'timeline' ? 'timeline' : 'freeflow',
    // Kept only when set to a positive number; the layout falls back to the default otherwise.
    yearsPerRow:
      typeof raw.yearsPerRow === 'number' && raw.yearsPerRow > 0 ? raw.yearsPerRow : undefined,
    // Absent must stay null — the filters then decide, which is how a view
    // written before membership existed behaves. `[]` means a deliberately
    // empty tree, so the two cannot be collapsed.
    members: Array.isArray(raw.members)
      ? raw.members.filter((m): m is string => typeof m === 'string')
      : null,
    root: typeof raw.root === 'string' && raw.root.trim() ? raw.root.trim() : null,
    parentDepth: asDepth(raw.parentDepth),
    childDepth: asDepth(raw.childDepth),
    includeSpouseFamilies:
      typeof raw.includeSpouseFamilies === 'boolean' ? raw.includeSpouseFamilies : true,
    hidden: asIdArray(raw.hidden) ?? [],
    arranged: typeof raw.arranged === 'boolean' ? raw.arranged : false,
    showGhosts: typeof raw.showGhosts === 'boolean' ? raw.showGhosts : true,
    collapsed: asIdArray(raw.collapsed) ?? [],
    zoom: typeof raw.zoom === 'number' && raw.zoom > 0 ? raw.zoom : 1,
    panX: typeof raw.panX === 'number' ? raw.panX : 0,
    panY: typeof raw.panY === 'number' ? raw.panY : 0,
    overrides: normalizeOverrides(raw.overrides),
    edgeRoutes: normalizeRoutes(raw.edgeRoutes)
  }
}
