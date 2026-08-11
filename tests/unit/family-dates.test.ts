import { describe, expect, it } from 'vitest'
import matter from 'gray-matter'
import { formatPartialDate, isPartialDate, lifespan, toPartialDate } from '@shared/dates'
import { parseFrontmatter, serializeFrontmatter } from '../../src/main/data/frontmatter'

/**
 * The YAML date trap (solution.md §1.2). One case per row of the table there,
 * plus the timezone day-shift that makes it more than a cosmetic issue.
 */

describe('toPartialDate', () => {
  it('passes through well-formed partial dates', () => {
    expect(toPartialDate('1984')).toBe('1984')
    expect(toPartialDate('1984-06')).toBe('1984-06')
    expect(toPartialDate('1984-06-12')).toBe('1984-06-12')
  })

  it('un-mangles a YAML Date back to a date-only string, using UTC parts', () => {
    // This is what an unquoted `birthday: 1984-06-12` parses to.
    expect(toPartialDate(new Date('1984-06-12T00:00:00.000Z'))).toBe('1984-06-12')
  })

  it('un-mangles a bare year that YAML typed as a number', () => {
    expect(toPartialDate(1984)).toBe('1984')
  })

  it('recovers a date from a previously mangled ISO timestamp', () => {
    expect(toPartialDate('1984-06-12T00:00:00.000Z')).toBe('1984-06-12')
  })

  it('drops junk rather than propagating it', () => {
    expect(toPartialDate('not a date')).toBeUndefined()
    expect(toPartialDate('')).toBeUndefined()
    expect(toPartialDate(null)).toBeUndefined()
    expect(toPartialDate(undefined)).toBeUndefined()
    expect(toPartialDate({})).toBeUndefined()
    expect(toPartialDate(new Date('nonsense'))).toBeUndefined()
  })
})

describe('the day-shift this protects against', () => {
  it('never uses local getters, which would move the day in a negative offset', () => {
    const d = new Date('1984-06-12T00:00:00.000Z')
    // Proof the hazard is real: in UTC-7 the local day is the 11th.
    const localDay = new Date(d.getTime() - 7 * 3600 * 1000).getUTCDate()
    expect(localDay).toBe(11)
    // The coercion is unaffected because it reads UTC parts.
    expect(toPartialDate(d)).toBe('1984-06-12')
  })
})

describe('round-trip through frontmatter', () => {
  it('writes dates quoted so they survive as strings', () => {
    const out = serializeFrontmatter({ birthday: '1984-06-12', died: '2001' }, '\nbody\n')
    // js-yaml quotes any string that would otherwise re-parse as a date/number.
    expect(out).toContain("birthday: '1984-06-12'")
    expect(out).toContain("died: '2001'")

    const again = parseFrontmatter(out).data
    expect(typeof again.birthday).toBe('string')
    expect(again.birthday).toBe('1984-06-12')
    expect(again.died).toBe('2001')
  })

  it('recovers a hand-edited unquoted date on the next read', () => {
    const raw = '---\nbirthday: 1984-06-12\n---\n\nbody\n'
    const parsed = matter(raw).data
    // YAML really does hand back a Date here — that is the whole problem.
    expect(parsed.birthday).toBeInstanceOf(Date)
    expect(toPartialDate(parsed.birthday)).toBe('1984-06-12')
  })
})

describe('display helpers', () => {
  it('formats partial dates without constructing a Date', () => {
    expect(formatPartialDate('1984-06-12')).toBe('12 Jun 1984')
    expect(formatPartialDate('1984-06')).toBe('Jun 1984')
    expect(formatPartialDate('1984')).toBe('1984')
    expect(formatPartialDate(undefined)).toBe('')
  })

  it('builds the lifespan line', () => {
    expect(lifespan('1932', '2001')).toBe('1932 – 2001')
    expect(lifespan('1932')).toBe('b. 1932')
    expect(lifespan(undefined, '2001')).toBe('d. 2001')
    expect(lifespan()).toBe('')
  })

  it('validates the accepted shapes', () => {
    expect(isPartialDate('1984-06-12')).toBe(true)
    expect(isPartialDate('12/06/1984')).toBe(false)
  })
})
