/**
 * "Add multiple chapters" (Issue #172): turn pasted text — one label per line,
 * indented like Python for deeper levels — into a tree of columns to create.
 *
 * Indentation is the only structure. The first level (no indent) is the
 * outermost column level, each further indent is one level deeper, and the
 * deepest level is a column (`unit`); everything above it is a group (`node`).
 * In a one-level project every line is a column and indentation is ignored —
 * there is nothing deeper, and pasted lists often carry stray leading spaces.
 *
 * Pure, so the modal can preview the result and the main process can trust it.
 */

export interface OutlineItem {
  label: string
  kind: 'node' | 'unit'
  children: OutlineItem[]
}

export interface OutlineError {
  /** 1-based line number in the pasted text. */
  line: number
  message: string
}

export interface ParsedOutline {
  items: OutlineItem[]
  errors: OutlineError[]
  /** How many items will be created at each depth (index = depth). */
  counts: number[]
}

/** One indent step. A tab counts as one step too. */
export const OUTLINE_INDENT = 4

const widthOf = (lead: string): number => lead.replace(/\t/g, ' '.repeat(OUTLINE_INDENT)).length

/**
 * Parse `text` for a project with `levelCount` column levels (≥ 1). Blank lines
 * are skipped; labels are trimmed and otherwise kept exactly as typed.
 */
export function parseOutline(text: string, levelCount: number): ParsedOutline {
  const levels = Math.max(1, levelCount)
  const lines = text
    .split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, lead: /^[ \t]*/.exec(raw)![0], label: raw.trim() }))
    .filter((l) => l.label !== '')

  // Pasted text often arrives indented as a whole; the shallowest line is level 0.
  const base = lines.length ? Math.min(...lines.map((l) => widthOf(l.lead))) : 0

  const items: OutlineItem[] = []
  const errors: OutlineError[] = []
  const counts: number[] = Array.from({ length: levels }, () => 0)
  // Open ancestors, outermost first: the indent each sits at and its item.
  const stack: { indent: number; item: OutlineItem }[] = []

  for (const { line, lead, label } of lines) {
    const indent = levels === 1 ? 0 : widthOf(lead) - base
    let closed: number | null = null
    while (stack.length && stack[stack.length - 1].indent >= indent) closed = stack.pop()!.indent
    const parent = stack[stack.length - 1]
    // Like Python: stepping back out must land exactly on a level already open
    // above (e.g. 8 → 4), not between two (8 → 6), or which parent is meant is a guess.
    if ((closed !== null && closed !== indent) || (!parent && indent !== 0)) {
      errors.push({ line, message: 'Its indent does not line up with any line above it.' })
      continue
    }
    const depth = stack.length
    if (depth >= levels) {
      errors.push({ line, message: `Indented too deep — this project has only ${levels} column levels.` })
      continue
    }
    const item: OutlineItem = { label, kind: depth === levels - 1 ? 'unit' : 'node', children: [] }
    ;(parent ? parent.item.children : items).push(item)
    counts[depth]++
    stack.push({ indent, item })
  }

  return { items, errors, counts }
}
