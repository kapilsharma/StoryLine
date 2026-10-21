import { FENCE, splitBlocks, type MdBlock } from './mdBlocks'
import { extractFootnotes, renderMarkdown, type Footnote, type RenderOptions } from './markdown'

/**
 * The fullscreen editor's preview, rendered block by block (Issue #201).
 *
 * Rendering per block is what lets the preview highlight the paragraph under the
 * caret — each block is its own element with known source offsets — and it is
 * also much cheaper while typing: an unchanged block's HTML is reused, so a
 * keystroke re-renders one paragraph instead of the whole draft. The blocks are
 * the same {@link splitBlocks} cuts the side panel's live editor (#83) uses.
 *
 * Two markdown features reach across blocks, and are handled here so the
 * preview still matches a whole-note render:
 *
 *  - **Footnotes** (#64): definitions are lifted out of the whole note and
 *    listed once at the end, rather than under whichever block held them.
 *  - **Reference links** (`[label]: url`): the definitions are collected once
 *    and appended to every block, so `[text][label]` resolves wherever it is.
 */

export interface PreviewParts {
  blocks: MdBlock[]
  /** Every reference-link definition in the note, one per line. */
  linkDefs: string
  /** Every footnote definition in the note, in order. */
  footnotes: Footnote[]
}

/**
 * A single-line reference-link definition. Footnote definitions (`[^1]: …`) look
 * similar and are excluded — they have their own pre-pass.
 */
const LINK_DEF = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S.*$/

const isFenceBlock = (block: MdBlock): boolean => FENCE.test(block.text)

export function previewParts(src: string): PreviewParts {
  const blocks = splitBlocks(src)
  const defs: string[] = []
  for (const block of blocks) {
    // Inside a code fence, `[x]: y` is code, not a definition.
    if (isFenceBlock(block)) continue
    for (const line of block.text.split('\n')) if (LINK_DEF.test(line)) defs.push(line.trim())
  }
  return { blocks, linkDefs: defs.join('\n'), footnotes: extractFootnotes(src).notes }
}

/**
 * Render one block for the preview: its footnote definitions dropped (they are
 * listed at the end instead) and the note's link definitions appended.
 *
 * The definitions are not added to a code block, where an unclosed fence would
 * swallow them as text.
 */
export function renderBlock(text: string, linkDefs: string, options: RenderOptions = {}): string {
  const { body } = extractFootnotes(text)
  const src = linkDefs && !FENCE.test(text) ? `${body}\n\n${linkDefs}` : body
  return renderMarkdown(src, options)
}
