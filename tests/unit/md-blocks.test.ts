import { describe, it, expect } from 'vitest'
import {
  blockIndexAt,
  sourceOffsetForVisible,
  splitBlocks,
  withTrailingGap
} from '@renderer/lib/mdBlocks'

/**
 * Block splitting for the live-preview editor (Issue #83). The offsets are what
 * matter: the editor replaces `src.slice(start, end)` with what you type, so a
 * boundary that is one character out either eats a newline or duplicates one.
 */

/** Every block's text must be exactly the slice its offsets claim. */
const assertOffsets = (src: string): void => {
  for (const b of splitBlocks(src)) expect(src.slice(b.start, b.end)).toBe(b.text)
}

describe('splitBlocks', () => {
  it('splits on blank lines and keeps the gaps out of the blocks', () => {
    const src = 'First para.\n\nSecond para.\n'
    expect(splitBlocks(src).map((b) => b.text)).toEqual(['First para.', 'Second para.'])
    assertOffsets(src)
  })

  it('keeps a run of non-blank lines together', () => {
    // A list is one block, so its items keep numbering and its markers render.
    const src = '- one\n- two\n- three'
    const blocks = splitBlocks(src)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ text: src, start: 0, end: src.length })
  })

  it('keeps a setext heading with its underline', () => {
    const src = 'A title\n=======\n\nbody'
    expect(splitBlocks(src).map((b) => b.text)).toEqual(['A title\n=======', 'body'])
  })

  it('treats a fenced code block as one block, blank lines and all', () => {
    const src = 'before\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter'
    expect(splitBlocks(src).map((b) => b.text)).toEqual([
      'before',
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      'after'
    ])
    assertOffsets(src)
  })

  it('runs an unclosed fence to the end, like the renderer does', () => {
    const src = 'text\n\n```\nnever closed\n\nstill inside'
    expect(splitBlocks(src).map((b) => b.text)).toEqual([
      'text',
      '```\nnever closed\n\nstill inside'
    ])
    assertOffsets(src)
  })

  it('starts a new block at a fence even without a blank line before it', () => {
    const src = 'para\n```\ncode\n```\ntail'
    expect(splitBlocks(src).map((b) => b.text)).toEqual(['para', '```\ncode\n```', 'tail'])
    assertOffsets(src)
  })

  it('closes a fence only on a marker at least as long as the opener', () => {
    const src = '````\n```\nstill code\n````'
    expect(splitBlocks(src)).toHaveLength(1)
  })

  it('finds no blocks in an empty or whitespace-only note', () => {
    expect(splitBlocks('')).toEqual([])
    expect(splitBlocks('\n\n   \n')).toEqual([])
  })

  it('survives leading blank lines and trailing whitespace', () => {
    const src = '\n\n  \nonly para\n   \n'
    expect(splitBlocks(src).map((b) => b.text)).toEqual(['only para'])
    assertOffsets(src)
  })

  it('leaves the blank lines between blocks untouched by a replacement', () => {
    // The property the editor depends on: swapping one block's text cannot
    // disturb the separators, so the blocks around it keep their identity.
    const src = 'one\n\ntwo\n\nthree'
    const [, second] = splitBlocks(src)
    const next = src.slice(0, second.start) + 'a much longer second block' + src.slice(second.end)
    expect(splitBlocks(next).map((b) => b.text)).toEqual([
      'one',
      'a much longer second block',
      'three'
    ])
  })
})

describe('blockIndexAt', () => {
  const blocks = splitBlocks('one\n\ntwo\n\nthree')

  it('finds the block an offset falls inside', () => {
    expect(blockIndexAt(blocks, 0)).toBe(0)
    expect(blockIndexAt(blocks, 6)).toBe(1)
    expect(blockIndexAt(blocks, 12)).toBe(2)
  })

  it('falls back to the block before an offset in the gap', () => {
    expect(blockIndexAt(blocks, 4)).toBe(0)
  })

  it('reports nothing when there are no blocks', () => {
    expect(blockIndexAt([], 3)).toBe(-1)
  })
})

describe('withTrailingGap', () => {
  it('guarantees a blank line to start a new block after', () => {
    expect(withTrailingGap('text')).toBe('text\n\n')
    expect(withTrailingGap('text\n')).toBe('text\n\n')
    expect(withTrailingGap('text\n\n\n')).toBe('text\n\n')
  })

  it('leaves an empty note empty rather than padding it', () => {
    expect(withTrailingGap('')).toBe('')
    expect(withTrailingGap('  \n ')).toBe('')
  })
})

describe('sourceOffsetForVisible', () => {
  it('maps a rendered offset past inline markup', () => {
    // "**Bold** then" renders as "Bold then"; visible 5 is the "t" of "then",
    // which is source offset 9.
    expect(sourceOffsetForVisible('**Bold** then', 5)).toBe(9)
  })

  it('skips a line’s block marker', () => {
    expect(sourceOffsetForVisible('## Title', 0)).toBe(3)
    expect(sourceOffsetForVisible('- item', 0)).toBe(2)
    expect(sourceOffsetForVisible('> quoted', 0)).toBe(2)
    expect(sourceOffsetForVisible('1. first', 0)).toBe(3)
  })

  it('skips the target of a link but not its label', () => {
    const src = '[label](https://example.com) tail'
    // Visible text is "label tail"; offset 6 is the "t" of "tail".
    expect(sourceOffsetForVisible(src, 6)).toBe(29)
  })

  it('clamps to the end of the source', () => {
    expect(sourceOffsetForVisible('short', 99)).toBe(5)
  })

  it('maps the very start to the very start', () => {
    expect(sourceOffsetForVisible('plain text', 0)).toBe(0)
  })
})
