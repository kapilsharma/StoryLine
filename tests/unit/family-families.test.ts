import { describe, expect, it } from 'vitest'
import {
  FAMILY_PALETTE,
  assignFamilyColours,
  colourFor,
  displayName,
  familiesIn,
  familyFromName,
  familyOf
} from '@shared/families'
import { person } from '../family-fixtures'

/**
 * Family colouring (solution.md §3.1). The point is that a person's colour
 * carries information — which branch they belong to — rather than being one of
 * fifteen arbitrary hues.
 */

describe('familyOf', () => {
  it('uses the explicit family when set', () => {
    expect(familyOf(person('x', 'female', { name: 'Ines Calder', family: 'Ashvale' }))).toBe('Ashvale')
  })

  it('falls back to the surname, so existing files group with no edit', () => {
    expect(familyOf(person('x', 'male', { name: 'Rowan Ashvale' }))).toBe('Ashvale')
  })

  it('has no family for a single-word name', () => {
    expect(familyOf(person('x', 'male', { name: 'Rowan' }))).toBe('')
  })

  it('ignores a blank family field', () => {
    expect(familyOf(person('x', 'male', { name: 'Rowan Ashvale', family: '   ' }))).toBe('Ashvale')
  })
})

describe('displayName', () => {
  it('appends the family when the name is just a given name', () => {
    expect(displayName(person('x', 'male', { name: 'Rowan', family: 'Ashvale' }))).toBe('Rowan Ashvale')
  })

  it('does not duplicate a surname already in the name', () => {
    expect(displayName(person('x', 'male', { name: 'Rowan Ashvale', family: 'Ashvale' }))).toBe(
      'Rowan Ashvale'
    )
  })

  it('leaves a kept maiden surname alone — the whole reason the fields are separate', () => {
    // Married into the Ashvales, still called Calder.
    expect(displayName(person('x', 'female', { name: 'Ines Calder', family: 'Ashvale' }))).toBe(
      'Ines Calder'
    )
  })

  it('leaves a multi-word name untouched whatever the family says', () => {
    expect(displayName(person('x', 'male', { name: 'Rowan kumar', family: 'Ashvale' }))).toBe(
      'Rowan kumar'
    )
  })

  it('falls back to the name when no family is set', () => {
    expect(displayName(person('x', 'male', { name: 'Rowan Ashvale' }))).toBe('Rowan Ashvale')
  })
})

describe('familiesIn', () => {
  it('lists each family once, sorted, ignoring ghosts', () => {
    const all = [
      person('a', 'male', { name: 'Rowan Ashvale' }),
      person('b', 'female', { name: 'Ines Calder', family: 'Ashvale' }),
      person('c', 'male', { name: 'Mohan Calder' }),
      { ...person('d', 'unknown', { name: 'Ghost Person' }), ghost: true }
    ]
    expect(familiesIn(all)).toEqual(['Ashvale', 'Calder'])
  })
})

describe('assignFamilyColours', () => {
  it('gives each family a distinct palette colour', () => {
    const colours = assignFamilyColours(['Ashvale', 'Calder', 'Gupta'])
    expect(new Set(Object.values(colours)).size).toBe(3)
    for (const c of Object.values(colours)) expect(FAMILY_PALETTE).toContain(c)
  })

  it('keeps an existing assignment, so a colour never moves', () => {
    const first = assignFamilyColours(['Ashvale', 'Calder'])
    const second = assignFamilyColours(['Gupta', 'Ashvale', 'Calder'], first)
    expect(second.Ashvale).toBe(first.Ashvale)
    expect(second.Calder).toBe(first.Calder)
    expect(second.Gupta).toBeTruthy()
  })

  it('respects a hand-picked colour outside the palette', () => {
    const out = assignFamilyColours(['Ashvale', 'Calder'], { Ashvale: '#123456' })
    expect(out.Ashvale).toBe('#123456')
  })

  it('wraps rather than running out when there are more families than colours', () => {
    const many = Array.from({ length: FAMILY_PALETTE.length + 3 }, (_, i) => `F${i}`)
    const out = assignFamilyColours(many)
    expect(Object.keys(out)).toHaveLength(many.length)
    for (const c of Object.values(out)) expect(c).toBeTruthy()
  })
})

describe('colourFor', () => {
  const colours = { Ashvale: '#111111', Calder: '#222222' }

  it('colours by family, not by person', () => {
    const a = person('a', 'male', { name: 'Rowan Ashvale' })
    const b = person('b', 'female', { name: 'Meera Ashvale' })
    expect(colourFor(a, colours)).toBe(colourFor(b, colours))
  })

  it('follows an explicit family over the surname', () => {
    const married = person('x', 'female', { name: 'Ines Calder', family: 'Ashvale' })
    expect(colourFor(married, colours)).toBe('#111111')
  })

  it('greys out a ghost, which belongs to no family yet', () => {
    const ghost = { ...person('g', 'unknown', { name: 'Missing Dad' }), ghost: true }
    expect(colourFor(ghost, colours)).toBe('#8A8A90')
  })
})

describe('familyFromName', () => {
  it('takes the last word', () => {
    expect(familyFromName('Rowan Kumar Ashvale')).toBe('Ashvale')
    expect(familyFromName('  Rowan   Ashvale  ')).toBe('Ashvale')
    expect(familyFromName('Rowan')).toBe('')
  })
})
