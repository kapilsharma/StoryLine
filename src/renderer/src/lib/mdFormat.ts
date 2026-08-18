/**
 * Markdown formatting actions for the editor toolbar (Issue #72).
 *
 * Everything here is a pure function over `{ text, start, end }` — the textarea's
 * value and its selection — returning the same shape. The component reads the
 * selection off the DOM, applies one of these, then writes the result back; the
 * interesting logic (what counts as already-bold, which lines a heading covers)
 * stays testable without a DOM.
 *
 * **No underline.** Markdown has no underline syntax, and emitting `<u>` would
 * put raw HTML in files that are meant to stay readable in any editor. The
 * toolbar offers `==highlight==` instead, which the preview already renders as
 * `<mark>` — see `markdown.ts`.
 */

/** A textarea's value plus its selection. `start === end` means a bare caret. */
export interface MdSelection {
  text: string
  start: number
  end: number
}

/** The inline markers the toolbar can toggle. */
export const INLINE_MARKERS = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  highlight: '=='
} as const

export type InlineFormat = keyof typeof INLINE_MARKERS

/** A heading level, or 0 for body text. */
export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * The inline buttons, in toolbar order (Issue #72) — shared by the fullscreen
 * editor and the board's side panel (Issue #83) so the two toolbars cannot drift
 * apart.
 */
export const INLINE_TOOLS: { format: InlineFormat; label: string; title: string }[] = [
  { format: 'bold', label: 'B', title: 'Bold  **text**' },
  { format: 'italic', label: 'I', title: 'Italic  *text*' },
  { format: 'strikethrough', label: 'S', title: 'Strikethrough  ~~text~~' },
  { format: 'highlight', label: '==', title: 'Highlight  ==text==' }
]

/** Every level the heading dropdown offers, body text first. */
export const HEADING_LEVELS: HeadingLevel[] = [0, 1, 2, 3, 4, 5, 6]

const HEADING_RE = /^(#{1,6})[ \t]+/

/** Start of the line containing `at`. */
function lineStartAt(text: string, at: number): number {
  return text.lastIndexOf('\n', at - 1) + 1
}

/** End of the line containing `at`, exclusive of the newline. */
function lineEndAt(text: string, at: number): number {
  const i = text.indexOf('\n', at)
  return i === -1 ? text.length : i
}

/**
 * Replace the selection with `snippet`, leaving the caret after it.
 *
 * Also what an empty selection does: with `start === end` the slices meet and it
 * is a plain insertion at the caret.
 */
export function insertAt(sel: MdSelection, snippet: string): MdSelection {
  const text = sel.text.slice(0, sel.start) + snippet + sel.text.slice(sel.end)
  const caret = sel.start + snippet.length
  return { text, start: caret, end: caret }
}

/**
 * The heading level of the line the selection starts on — what the toolbar's
 * dropdown shows.
 */
export function headingLevelAt(text: string, at: number): HeadingLevel {
  const line = text.slice(lineStartAt(text, at), lineEndAt(text, at))
  const m = HEADING_RE.exec(line)
  return m ? (m[1].length as HeadingLevel) : 0
}

/**
 * Set every line the selection touches to `level` (0 strips the heading).
 *
 * Blank lines inside a multi-line selection are left alone — prefixing them
 * would leave a trail of bare `##` markers. A single blank line is still
 * headed, since that is someone starting a heading on an empty line.
 */
export function setHeading(sel: MdSelection, level: HeadingLevel): MdSelection {
  const { text } = sel
  const from = lineStartAt(text, sel.start)
  const to = lineEndAt(text, sel.end)
  const lines = text.slice(from, to).split('\n')
  const prefix = level > 0 ? `${'#'.repeat(level)} ` : ''

  let firstDelta = 0
  let totalDelta = 0
  const next = lines.map((line, i) => {
    const bare = line.replace(HEADING_RE, '')
    const skip = lines.length > 1 && bare.trim() === ''
    const replaced = skip ? line : prefix + bare
    if (i === 0) firstDelta = replaced.length - line.length
    totalDelta += replaced.length - line.length
    return replaced
  })

  const start = Math.max(from, sel.start + firstDelta)
  return {
    text: text.slice(0, from) + next.join('\n') + text.slice(to),
    start,
    end: Math.max(start, sel.end + totalDelta)
  }
}

/** Trim the selection inwards past whitespace — `** bold **` renders literally. */
function trimmed(text: string, start: number, end: number): [number, number] {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  return [s, e]
}

/**
 * Is the range `[s, e)` already wrapped in `marker` — either inside the
 * selection (`**bold**` selected whole) or just outside it (`bold` selected
 * between the asterisks)?
 */
function wrapped(text: string, s: number, e: number, marker: string): 'inner' | 'outer' | null {
  const n = marker.length
  const inner = text.slice(s, e)
  // `*` must not match the halves of a `**bold**`, or toggling italic on a bold
  // run would quietly demote it.
  const ambiguous = marker === '*' && inner.startsWith('**') && inner.endsWith('**')
  if (!ambiguous && inner.length > 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
    return 'inner'
  }
  if (text.slice(s - n, s) === marker && text.slice(e, e + n) === marker) {
    const outerAmbiguous = marker === '*' && text.slice(s - 2, s) === '**' && text.slice(e, e + 2) === '**'
    if (!outerAmbiguous) return 'outer'
  }
  return null
}

/**
 * Toggle an inline format around the selection.
 *
 * With no selection it drops in an empty pair and puts the caret between them,
 * so typing continues inside the formatting.
 */
export function toggleInline(sel: MdSelection, format: InlineFormat): MdSelection {
  const marker = INLINE_MARKERS[format]
  const n = marker.length
  const { text } = sel

  if (sel.start === sel.end) {
    const caret = sel.start
    // Clicking the same button again on an empty pair removes it.
    if (text.slice(caret - n, caret) === marker && text.slice(caret, caret + n) === marker) {
      return {
        text: text.slice(0, caret - n) + text.slice(caret + n),
        start: caret - n,
        end: caret - n
      }
    }
    const at = insertAt(sel, marker + marker)
    return { text: at.text, start: caret + n, end: caret + n }
  }

  const [s, e] = trimmed(text, sel.start, sel.end)
  if (s === e) return sel // whitespace only — nothing to format

  const already = wrapped(text, s, e, marker)
  if (already === 'inner') {
    const bare = text.slice(s + n, e - n)
    return { text: text.slice(0, s) + bare + text.slice(e), start: s, end: s + bare.length }
  }
  if (already === 'outer') {
    const bare = text.slice(s, e)
    return {
      text: text.slice(0, s - n) + bare + text.slice(e + n),
      start: s - n,
      end: s - n + bare.length
    }
  }

  const bare = text.slice(s, e)
  return {
    text: text.slice(0, s) + marker + bare + marker + text.slice(e),
    start: s + n,
    end: s + n + bare.length
  }
}
