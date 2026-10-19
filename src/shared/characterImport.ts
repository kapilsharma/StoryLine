import type { Character, Gender } from './types'
import { GENDERS } from './types'
import { isPartialDate } from './dates'
import { displayName, FAMILY_PALETTE } from './families'

/**
 * "Add multiple characters" (Issue #175): pasted CSV — or tab-separated text,
 * which is what copying from a spreadsheet gives — becomes new characters.
 *
 * The first line names the columns; every other non-blank line is one character.
 * Known columns (Name, Species, Group, Family…) fill the matching field, matched
 * case- and spacing-insensitively; any other column is kept as a custom field.
 *
 * Everything is validated up front and nothing is added while any row has a
 * problem: the author fixes or removes that row and tries again. That includes a
 * name that already exists — a re-paste must not quietly half-apply.
 *
 * Father / Mother / Spouse take names, matched against the existing characters
 * and the other pasted rows. A pasted row is referred to as {@link newRef}(i)
 * until the main process gives it an id.
 */

export interface ImportIssue {
  /** 1-based line in the pasted text; 1 is the header. */
  line: number
  message: string
}

/** What a header became: a known field, or a custom field kept under `key`. */
export interface ImportColumn {
  header: string
  field: KnownField | null
  /** The custom-field key for an unknown column (the header as typed). */
  key: string
}

export interface ParsedCharacters {
  /** New characters with `id: ''`; empty when there are errors. */
  characters: Character[]
  columns: ImportColumn[]
  errors: ImportIssue[]
}

const NEW_REF_PREFIX = 'new:'
/** Placeholder id for the `i`th pasted row, used in father/mother/spouse. */
export const newRef = (i: number): string => `${NEW_REF_PREFIX}${i}`
/** The pasted-row index a placeholder points at, or null for a real id. */
export function newRefIndex(ref: string): number | null {
  return ref.startsWith(NEW_REF_PREFIX) ? Number(ref.slice(NEW_REF_PREFIX.length)) : null
}

type KnownField =
  | 'name'
  | 'colour'
  | 'role'
  | 'age'
  | 'species'
  | 'group'
  | 'tags'
  | 'rowKind'
  | 'family'
  | 'gender'
  | 'birthday'
  | 'died'
  | 'maidenName'
  | 'father'
  | 'mother'
  | 'spouse'

/** Normalised header → field. Normalised = lower case, letters and digits only. */
const ALIASES: Record<string, KnownField> = {
  name: 'name',
  colour: 'colour',
  color: 'colour',
  role: 'role',
  age: 'age',
  species: 'species',
  group: 'group',
  tags: 'tags',
  tag: 'tags',
  rowkind: 'rowKind',
  kind: 'rowKind',
  family: 'family',
  gender: 'gender',
  sex: 'gender',
  birthday: 'birthday',
  born: 'birthday',
  birth: 'birthday',
  died: 'died',
  death: 'died',
  maidenname: 'maidenName',
  father: 'father',
  mother: 'mother',
  spouse: 'spouse',
  spouses: 'spouse'
}

/** Keys the app owns; a column by these names would be ambiguous or overwritten. */
const RESERVED = new Set(['id', 'type', 'children'])

/** Fields a plot row (Issue #119) does not carry — it is a thread, not a person. */
const PEOPLE_FIELDS: KnownField[] = [
  'role',
  'age',
  'species',
  'family',
  'gender',
  'birthday',
  'died',
  'maidenName',
  'father',
  'mother',
  'spouse'
]

const normalise = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Several names or tags in one cell: "a; b" (or "a, b" when the cell is quoted). */
const splitList = (cell: string): string[] =>
  cell
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)

interface CsvRecord {
  line: number
  cells: string[]
}

/**
 * Split CSV/TSV text into records. Quotes work as in spreadsheets: a quoted cell
 * may hold the delimiter, a newline, or `""` for a literal quote.
 */
export function splitRecords(text: string, delimiter: string): { records: CsvRecord[]; error?: ImportIssue } {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else {
        if (ch === '\n') line++
        cell += ch
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      cells.push(cell)
      records.push({ line: start, cells })
      cells = []
      cell = ''
      line++
      start = line
    } else cell += ch
  }
  if (quoted) return { records, error: { line: start, message: 'A quote is opened but never closed.' } }
  cells.push(cell)
  records.push({ line: start, cells })
  return { records: records.filter((r) => r.cells.some((c) => c.trim() !== '')) }
}

/**
 * Parse and validate pasted text against the characters already on the board.
 * `existing` decides both "already exists" and who Father/Mother/Spouse can name.
 */
export function parseCharacterCsv(text: string, existing: Character[]): ParsedCharacters {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const delimiter = firstLine.includes('\t') ? '\t' : ','
  const { records, error } = splitRecords(text, delimiter)
  if (error) return { characters: [], columns: [], errors: [error] }
  if (records.length === 0) return { characters: [], columns: [], errors: [] }

  const [head, ...rows] = records
  const errors: ImportIssue[] = []
  const columns: ImportColumn[] = head.cells.map((raw) => {
    const header = raw.trim()
    return { header, field: ALIASES[normalise(header)] ?? null, key: header }
  })

  // ── The header ──
  const seen = new Map<string, string>()
  columns.forEach((col, i) => {
    if (!col.header) {
      errors.push({ line: head.line, message: `Column ${i + 1} has no name.` })
      return
    }
    if (RESERVED.has(normalise(col.header))) {
      errors.push({ line: head.line, message: `"${col.header}" is set by the app and cannot be imported.` })
      return
    }
    const slot = col.field ?? `custom:${col.header.toLowerCase()}`
    const prev = seen.get(slot)
    if (prev !== undefined) {
      errors.push({ line: head.line, message: `"${col.header}" and "${prev}" are the same column.` })
    }
    seen.set(slot, col.header)
  })
  if (!columns.some((c) => c.field === 'name')) {
    errors.push({ line: head.line, message: 'There is no Name column — the first line must name the columns.' })
  }
  if (errors.length) return { characters: [], columns, errors }
  if (rows.length === 0) {
    return { characters: [], columns, errors: [{ line: head.line, message: 'There are no characters below the header line.' }] }
  }

  // ── Names: what exists, and what this paste adds ──
  const key = (s: string): string => s.trim().toLowerCase()
  const existingByName = new Map<string, Character[]>()
  for (const c of existing) {
    for (const n of new Set([key(c.name), key(displayName(c))])) {
      existingByName.set(n, [...(existingByName.get(n) ?? []), c])
    }
  }
  const nameCol = columns.findIndex((c) => c.field === 'name')
  const pastedByName = new Map<string, number>()
  rows.forEach((r, i) => {
    const n = key(r.cells[nameCol] ?? '')
    if (n && !pastedByName.has(n)) pastedByName.set(n, i)
  })

  const resolve = (name: string, self: number, line: number, field: string): string | null => {
    const n = key(name)
    const pasted = pastedByName.get(n)
    if (pasted !== undefined) {
      if (pasted === self) {
        errors.push({ line, message: `${field} "${name}" is this same character.` })
        return null
      }
      return newRef(pasted)
    }
    const found = existingByName.get(n) ?? []
    if (found.length === 1) return found[0].id
    errors.push({
      line,
      message: found.length
        ? `${field} "${name}" matches ${found.length} characters — give them distinct names first.`
        : `${field} "${name}" is not a character here or in this list.`
    })
    return null
  }

  // ── Rows ──
  const characters: Character[] = rows.map((r, i) => {
    const { line, cells } = r
    const fail = (message: string): void => void errors.push({ line, message })
    if (cells.length > columns.length) {
      fail(`Has ${cells.length} values but there are only ${columns.length} columns — quote a value that contains a comma.`)
    }
    const v: Partial<Record<KnownField, string>> = {}
    const custom: Record<string, unknown> = {}
    columns.forEach((col, c) => {
      const value = (cells[c] ?? '').trim()
      if (!value) return
      if (col.field) v[col.field] = value
      else custom[col.key] = value
    })

    const name = v.name ?? ''
    if (!name) fail('Has no name.')
    else if (existingByName.has(key(name))) fail(`"${name}" already exists — remove this row.`)
    else if (pastedByName.get(key(name)) !== i) fail(`"${name}" is listed twice — remove one of them.`)

    const plot = v.rowKind ? key(v.rowKind) : 'character'
    if (plot !== 'character' && plot !== 'plot') fail(`Kind "${v.rowKind}" must be character or plot.`)
    const isPlot = plot === 'plot'

    const ch: Character = {
      id: '',
      type: 'character',
      name,
      colour: FAMILY_PALETTE[(existing.length + i) % FAMILY_PALETTE.length]
    }
    if (v.colour) {
      if (/^#[0-9a-f]{6}$/i.test(v.colour)) ch.colour = v.colour
      else fail(`Colour "${v.colour}" must look like #4A90D9.`)
    }
    if (v.group) ch.group = v.group
    if (v.tags) ch.tags = splitList(v.tags)
    if (Object.keys(custom).length) ch.custom = custom

    if (isPlot) {
      ch.rowKind = 'plot'
      const people = PEOPLE_FIELDS.filter((f) => v[f])
      if (people.length) {
        const headers = people.map((f) => columns.find((c) => c.field === f)!.header)
        fail(`A plot row cannot have ${headers.join(', ')} — clear those values or change its kind.`)
      }
      return ch
    }

    if (v.role) ch.role = v.role
    if (v.age) {
      if (/^\d+$/.test(v.age)) ch.age = Number(v.age)
      else fail(`Age "${v.age}" must be a whole number.`)
    }
    if (v.species) ch.species = v.species
    if (v.family) ch.family = v.family
    if (v.gender) {
      const g = key(v.gender) as Gender
      if (GENDERS.includes(g)) ch.gender = g
      else fail(`Gender "${v.gender}" must be one of ${GENDERS.join(', ')}.`)
    }
    for (const f of ['birthday', 'died'] as const) {
      const d = v[f]
      if (!d) continue
      if (isPartialDate(d)) ch[f] = d
      else fail(`${f === 'birthday' ? 'Birthday' : 'Died'} "${d}" must be a date like 1984, 1984-06 or 1984-06-12.`)
    }
    if (v.maidenName) ch.maidenName = v.maidenName
    for (const f of ['father', 'mother'] as const) {
      const ref = v[f] && resolve(v[f]!, i, line, f === 'father' ? 'Father' : 'Mother')
      if (ref) ch[f] = ref
    }
    if (v.spouse) {
      const refs = splitList(v.spouse)
        .map((s) => resolve(s, i, line, 'Spouse'))
        .filter((s): s is string => s !== null)
      if (refs.length) ch.spouse = [...new Set(refs)]
    }
    return ch
  })

  // Marriage is symmetric: one side naming the other is enough within the paste.
  characters.forEach((c, i) => {
    for (const s of c.spouse ?? []) {
      const j = newRefIndex(s)
      if (j === null) continue
      const other = characters[j]
      if (!other.spouse?.includes(newRef(i))) other.spouse = [...(other.spouse ?? []), newRef(i)]
    }
  })

  errors.sort((a, b) => a.line - b.line)
  return { characters: errors.length ? [] : characters, columns, errors }
}
