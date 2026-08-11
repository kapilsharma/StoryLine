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
    expect(uniqueSlug('Wolf', ['rowan'])).toBe('wolf')
  })
  it('appends an incrementing suffix on collision', () => {
    expect(uniqueSlug('Rowan', ['rowan', 'rowan-2'])).toBe('rowan-3')
  })
  it('matches case-insensitively', () => {
    expect(uniqueSlug('Rowan', ['ROWAN'])).toBe('rowan-2')
  })
})
