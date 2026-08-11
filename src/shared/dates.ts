/**
 * Partial-date handling for `birthday` / `died` (Requirements/Feature29.md §3).
 *
 * YAML types dates implicitly, and it bites three ways:
 *
 *   birthday: 1984-06-12    → Date   → rewritten as 1984-06-12T00:00:00.000Z
 *   birthday: 1984          → Number → stays 1984
 *   birthday: "1984-06-12"  → String → stays "1984-06-12"   ✅
 *
 * The timestamp form is UTC midnight, so formatting it with *local* getters
 * shifts the day in any negative-offset timezone — `1984-06-12` reads back as
 * June 11 in `America/Los_Angeles`. A birthday that moves when the user travels
 * is unacceptable in a genealogy tool.
 *
 * So: dates are opaque strings everywhere in this app. They are always written
 * quoted, and anything read off disk is coerced back to `YYYY[-MM[-DD]]` using
 * UTC parts. Never construct a Date for display or comparison — zero-padded ISO
 * strings already sort correctly.
 */

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
const PARTIAL_ISO = /^\d{4}(-\d{2}(-\d{2})?)?$/

/**
 * Coerce a frontmatter value into a partial ISO date string.
 *
 * Accepts what YAML may have already mangled it into — a `Date` (from an
 * unquoted full date) or a `number` (from an unquoted bare year) — as well as a
 * plain string. Returns undefined for anything unrecognisable, so a junk value
 * is dropped rather than propagated.
 */
export function toPartialDate(value: unknown): string | undefined {
  if (value == null) return undefined

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined
    // UTC parts, deliberately: the Date came from a YAML date at UTC midnight.
    const y = value.getUTCFullYear().toString().padStart(4, '0')
    const m = (value.getUTCMonth() + 1).toString().padStart(2, '0')
    const d = value.getUTCDate().toString().padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 9999) return undefined
    return value.toString().padStart(4, '0')
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (PARTIAL_ISO.test(trimmed)) return trimmed
    // A full ISO timestamp from a previously-mangled write.
    const match = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed)
    if (match) return match[1]
    return undefined
  }

  return undefined
}

/** True if `value` is already a well-formed partial ISO date. */
export function isPartialDate(value: string): boolean {
  return PARTIAL_ISO.test(value.trim())
}

/**
 * Human-readable form for a node label: "1984-06-12" → "12 Jun 1984",
 * "1984-06" → "Jun 1984", "1984" → "1984". String work only — no Date involved.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatPartialDate(value?: string): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  if (d) return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
  if (m) return `${MONTHS[Number(m) - 1] ?? m} ${y}`
  return y
}

/** The "b. 1932 – d. 2001" line under a name. Empty when both are absent. */
export function lifespan(birthday?: string, died?: string): string {
  const b = formatPartialDate(birthday)
  const d = formatPartialDate(died)
  if (b && d) return `${b} – ${d}`
  if (b) return `b. ${b}`
  if (d) return `d. ${d}`
  return ''
}
