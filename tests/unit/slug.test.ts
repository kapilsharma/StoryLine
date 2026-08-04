import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlug } from '@main/data/slug'

describe('slugify', () => {
  it('lowercases and kebab-cases', () => {
    expect(slugify('Chapter One!')).toBe('chapter-one')
  })
  it('strips accents', () => {
    expect(slugify('Élena Café')).toBe('elena-cafe')
  })
  it('falls back to "untitled" for empty input', () => {
    expect(slugify('   ')).toBe('untitled')
  })
  it('collapses and trims separators', () => {
    expect(slugify('  a -- b  ')).toBe('a-b')
  })
})

describe('uniqueSlug', () => {
  it('returns the base slug when free', () => {
    expect(uniqueSlug('Wolf', ['kapil'])).toBe('wolf')
  })
  it('appends an incrementing suffix on collision', () => {
    expect(uniqueSlug('Kapil', ['kapil', 'kapil-2'])).toBe('kapil-3')
  })
  it('matches case-insensitively', () => {
    expect(uniqueSlug('Kapil', ['KAPIL'])).toBe('kapil-2')
  })
})
