import { describe, it, expect } from 'vitest'
import { pluralize } from '@renderer/lib/text'

describe('pluralize', () => {
  it('adds a plain -s', () => {
    expect(pluralize('Chapter')).toBe('Chapters')
    expect(pluralize('Act')).toBe('Acts')
    expect(pluralize('Beat')).toBe('Beats')
  })

  it('uses -es after sibilant endings', () => {
    expect(pluralize('Class')).toBe('Classes')
    expect(pluralize('Arc')).toBe('Arcs')
    expect(pluralize('Sketch')).toBe('Sketches')
  })

  it('turns consonant + y into -ies', () => {
    expect(pluralize('Story')).toBe('Stories')
    expect(pluralize('Entry')).toBe('Entries')
  })

  it('keeps vowel + y as -ys', () => {
    expect(pluralize('Day')).toBe('Days')
  })

  it('preserves the given casing and handles empties', () => {
    expect(pluralize('chapter')).toBe('chapters')
    expect(pluralize('')).toBe('')
  })
})
