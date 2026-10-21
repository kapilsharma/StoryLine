import { describe, it, expect } from 'vitest'
import { countWords, formatWordCount } from '@shared/wordCount'

/** Word count for the editors (#194). */
describe('countWords', () => {
  it('counts plain prose', () => {
    expect(countWords('She walked the long corridor again.')).toBe(6)
  })

  it('is zero for nothing, whitespace or bare punctuation', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  \n\n\t ')).toBe(0)
    expect(countWords('— * --- > #')).toBe(0)
  })

  it('ignores Markdown syntax around the words', () => {
    expect(countWords('# The Gathering\n\n**She ran.** _Fast_, and `away`.')).toBe(7)
    expect(countWords('- one\n- two\n> three\n1. four')).toBe(4)
  })

  it('counts contractions, hyphenations and dashed pairs as one word each', () => {
    expect(countWords("don't well-known word—word")).toBe(3)
  })

  it('counts a link by its text and a wiki-link by its label (or id)', () => {
    expect(countWords('See [the old map](https://example.com/map.png) now')).toBe(5)
    expect(countWords('Ask [[mira-renmoor|Mira]] or [[otto-calder]]')).toBe(4)
  })

  it('does not count images, footnote markers, comments or HTML tags', () => {
    expect(countWords('Before ![a diagram of the fault](assets/f.png) after')).toBe(2)
    expect(countWords('A claim.[^1]\n\n[^1]: The source.')).toBe(4)
    expect(countWords('Kept <!-- a note to self --> words <br/> here')).toBe(3)
  })

  it('counts a bare URL as one word', () => {
    expect(countWords('Read https://example.com/a/b?c=d first')).toBe(3)
  })

  it('counts letters and digits beyond English', () => {
    expect(countWords('Café naïve 2026 São')).toBe(4)
  })
})

describe('formatWordCount', () => {
  it('says word or words', () => {
    expect(formatWordCount(0)).toBe('0 words')
    expect(formatWordCount(1)).toBe('1 word')
    expect(formatWordCount(2)).toBe('2 words')
  })

  it('groups thousands', () => {
    expect(formatWordCount(12345)).toMatch(/^12.345 words$/)
  })
})
