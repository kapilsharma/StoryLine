import { describe, it, expect } from 'vitest'
import { PROGRESS_STEPS, normalizeProgress } from '@shared/cardProgress'
import { frontmatterToNote, noteToFrontmatter } from '@main/data/mappers'

/**
 * Card % complete (Issue #165): a note's `progress:` value, 0–100, absent when
 * not tracked. The bar and the dropdown are in tests/components/card-progress.
 */

describe('normalizeProgress', () => {
  it('takes numbers, rounded and clamped to 0–100', () => {
    expect(normalizeProgress(40)).toBe(40)
    expect(normalizeProgress(0)).toBe(0)
    expect(normalizeProgress(34.6)).toBe(35)
    expect(normalizeProgress(140)).toBe(100)
    expect(normalizeProgress(-5)).toBe(0)
  })

  it('takes hand-written strings, with or without a %', () => {
    expect(normalizeProgress('60')).toBe(60)
    expect(normalizeProgress(' 70% ')).toBe(70)
  })

  it('treats anything else as not tracked', () => {
    for (const raw of [undefined, null, '', '  ', 'half', NaN, Infinity, true, [50], {}]) {
      expect(normalizeProgress(raw)).toBeUndefined()
    }
  })

  it('offers 0% to 100% in tens', () => {
    expect(PROGRESS_STEPS).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  })
})

describe('note progress in frontmatter', () => {
  it('reads and writes `progress:`', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', progress: '40%' }, 't', '')
    expect(note.progress).toBe(40)
    expect(noteToFrontmatter(note)).toMatchObject({ progress: 40 })
  })

  it('keeps 0% — it is a value, not an absence', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', progress: 0 }, 't', '')
    expect(note.progress).toBe(0)
    expect(noteToFrontmatter(note)).toMatchObject({ progress: 0 })
  })

  it('writes nothing when not tracked', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', progress: 'soon' }, 't', '')
    expect(note.progress).toBeUndefined()
    expect('progress' in noteToFrontmatter(note)).toBe(false)
  })
})
