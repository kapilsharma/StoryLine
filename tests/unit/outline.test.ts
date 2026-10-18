import { describe, it, expect } from 'vitest'
import { parseOutline, type OutlineItem } from '@shared/outline'

/**
 * "Add multiple chapters" (Issue #172): pasted lines → a tree to create.
 * Indentation is the only structure, read the way Python reads it.
 */

/** Labels only, nested — easier to read than the full items. */
const shape = (items: OutlineItem[]): unknown =>
  items.map((i) => (i.children.length ? [i.label, shape(i.children)] : i.label))

describe('parseOutline — one level', () => {
  it('makes one column per non-blank line, trimmed, in order', () => {
    const r = parseOutline('Chapter 1\n\n  \n Chapter 2 \r\n1. The Arrival\n', 1)
    expect(r.errors).toEqual([])
    expect(r.items.map((i) => [i.label, i.kind])).toEqual([
      ['Chapter 1', 'unit'],
      ['Chapter 2', 'unit'],
      ['1. The Arrival', 'unit']
    ])
    expect(r.counts).toEqual([3])
  })

  it('ignores indentation, because there is nowhere deeper to go', () => {
    const r = parseOutline('One\n    Two\n  Three', 1)
    expect(r.errors).toEqual([])
    expect(r.items.map((i) => i.label)).toEqual(['One', 'Two', 'Three'])
  })

  it('is empty for empty text', () => {
    expect(parseOutline('  \n\n', 1)).toEqual({ items: [], errors: [], counts: [0] })
  })
})

describe('parseOutline — levels', () => {
  it('turns unindented lines into groups and indented ones into columns inside them', () => {
    const r = parseOutline('Ch 1\n    Sc 1\n    Sc 2\nCh 2\n\tSc 3', 2)
    expect(r.errors).toEqual([])
    expect(shape(r.items)).toEqual([
      ['Ch 1', ['Sc 1', 'Sc 2']],
      ['Ch 2', ['Sc 3']]
    ])
    expect(r.items[0].kind).toBe('node')
    expect(r.items[0].children[0].kind).toBe('unit')
    expect(r.counts).toEqual([2, 3])
  })

  it('keeps a group with nothing in it', () => {
    const r = parseOutline('Ch 1\nCh 2\n    Sc 1', 2)
    expect(shape(r.items)).toEqual(['Ch 1', ['Ch 2', ['Sc 1']]])
    expect(r.items[0].kind).toBe('node')
  })

  it('handles three levels and stepping back out several at once', () => {
    const r = parseOutline('Novel\n    Ch 1\n        Sc 1\n    Ch 2\nNovel 2\n    Ch 3', 3)
    expect(r.errors).toEqual([])
    expect(shape(r.items)).toEqual([
      ['Novel', [['Ch 1', ['Sc 1']], 'Ch 2']],
      ['Novel 2', ['Ch 3']]
    ])
    expect(r.counts).toEqual([2, 3, 1])
  })

  it('ignores an indent shared by every line, as pasted text often has', () => {
    const r = parseOutline('    Ch 1\n        Sc 1', 2)
    expect(r.errors).toEqual([])
    expect(shape(r.items)).toEqual([['Ch 1', ['Sc 1']]])
  })

  it('accepts any deeper indent as one level in, like Python', () => {
    expect(shape(parseOutline('Ch 1\n  Sc 1\n  Sc 2', 2).items)).toEqual([['Ch 1', ['Sc 1', 'Sc 2']]])
  })

  it('flags a line that steps back out to between two levels', () => {
    const r = parseOutline('Novel\n    Ch 1\n        Sc 1\n      Sc 2', 3)
    expect(r.errors).toEqual([{ line: 4, message: expect.stringMatching(/does not line up/) }])
  })

  it('flags a line indented deeper than the project has levels', () => {
    const r = parseOutline('Ch 1\n    Sc 1\n        Beat', 2)
    expect(r.errors).toEqual([{ line: 3, message: expect.stringMatching(/only 2 column levels/) }])
  })
})
