/**
 * Splitting markdown source into editable blocks (Issue #83).
 *
 * The board's side panel is a *live preview*: the note is rendered, and the one
 * block you click turns into its own source while everything around it stays
 * rendered. That needs the source cut into pieces whose offsets are known, which
 * is what {@link splitBlocks} does.
 *
 * Everything here is pure and offset-based — no DOM, no React — so the fiddly
 * part (where a block starts and stops) is testable on its own.
 *
 * **Why lines rather than a markdown parser.** Rendering happens per block, with
 * the same `renderMarkdown` the read-only preview uses, so a block must render
 * the same in isolation as it does in the whole document. Keeping every run of
 * non-blank lines together guarantees that: a setext heading keeps its `===`
 * underline, a list keeps its items, and a paragraph that runs straight into a
 * `# heading` is one (slightly larger) block rather than two that would
 * re-render differently. The only construct that survives a blank line is a
 * fenced code block, which is handled explicitly.
 */

/** One block of markdown source. `text` is `src.slice(start, end)`. */
export interface MdBlock {
  text: string
  /** Offset of the block's first character in the source. */
  start: number
  /** Offset one past its last character — never includes the trailing newline. */
  end: number
}

/** An opening (or closing) code fence, indented by up to three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

const isBlank = (line: string): boolean => line.trim() === ''

/**
 * Cut markdown into blocks, dropping the blank lines between them.
 *
 * The gaps matter: because a blank-line run belongs to no block, replacing a
 * block's text can never disturb the separators around it, so the blocks either
 * side keep their offsets and their identity while one of them is being edited.
 */
export function splitBlocks(src: string): MdBlock[] {
  const blocks: MdBlock[] = []
  const lines = src.split('\n')
  let offset = 0
  let i = 0

  // `offset` always points at the start of `lines[i]`; advancing consumes the
  // line and the newline that followed it (one past the end on the last line,
  // which the `Math.min` below takes back off).
  const consume = (): void => {
    offset += lines[i].length + 1
    i++
  }

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      consume()
      continue
    }

    const start = offset
    const fence = FENCE.exec(lines[i])
    if (fence) {
      // A fence swallows blank lines; only its closing partner ends it. An
      // unclosed fence runs to the end of the note, which is what a renderer
      // does with it too.
      const closer = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`)
      consume()
      while (i < lines.length) {
        const line = lines[i]
        consume()
        if (closer.test(line)) break
      }
    } else {
      while (i < lines.length && !isBlank(lines[i]) && !FENCE.test(lines[i])) consume()
    }

    const end = Math.min(offset - 1, src.length)
    blocks.push({ text: src.slice(start, end), start, end })
  }

  return blocks
}

/**
 * The block containing `offset`, or the one nearest before it — what "the block
 * I clicked" resolves to. `-1` when there are no blocks at all.
 */
export function blockIndexAt(blocks: MdBlock[], offset: number): number {
  let found = -1
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].start > offset) break
    found = i
  }
  return found
}

/**
 * Append-position for a new block: the source with a blank line guaranteed at
 * the end, so text typed at `text.length` starts a block of its own rather than
 * joining the last paragraph.
 *
 * Returns the source unchanged when it is empty — a first block needs no
 * separator, and padding an empty note would save two newlines into a file the
 * author only clicked on.
 */
export function withTrailingGap(src: string): string {
  if (src.trim() === '') return ''
  return `${src.replace(/\s+$/, '')}\n\n`
}

/**
 * Markdown punctuation that renders as nothing, for {@link sourceOffsetForVisible}.
 * Deliberately not exhaustive — see that function's caveat.
 */
const SYNTAX = new Set(['*', '_', '`', '#', '~', '=', '>', '[', ']', '!'])

/** A line's block marker — heading hashes, a quote caret, a list bullet. */
const LINE_PREFIX = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+[.)][ \t]+)/

/**
 * Map an offset in a block's *rendered* text back to an offset in its source, so
 * clicking a word puts the caret on that word rather than at the end of the
 * paragraph.
 *
 * **A heuristic, on purpose.** It walks the source counting characters that are
 * likely to be visible, skipping each line's block marker, the punctuation in
 * {@link SYNTAX}, and the URL half of a `[label](url)` link. It does not know
 * about entities, tables or reference links, and it counts a source newline that
 * the renderer swallowed, so on heavily marked-up text the caret can land a word
 * or two out. That is a much smaller surprise than the alternative — always
 * jumping to the end of the block — and it costs no second parser.
 */
export function sourceOffsetForVisible(src: string, visible: number): number {
  let seen = 0
  let i = 0
  let lineStart = true

  while (i < src.length) {
    if (lineStart) {
      lineStart = false
      const marker = LINE_PREFIX.exec(src.slice(i))
      if (marker) {
        i += marker[0].length
        continue
      }
    }
    const ch = src[i]
    // `](url)` — the label was visible, the target is not.
    if (ch === ']' && src[i + 1] === '(') {
      const close = src.indexOf(')', i + 2)
      i = close === -1 ? src.length : close + 1
      continue
    }
    if (SYNTAX.has(ch)) {
      i++
      continue
    }
    if (seen >= visible) return i
    seen++
    if (ch === '\n') lineStart = true
    i++
  }

  return src.length
}
