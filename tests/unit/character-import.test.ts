import { describe, it, expect } from 'vitest'
import type { Character } from '@shared/types'
import { newRef, parseCharacterCsv } from '@shared/characterImport'

/**
 * "Add multiple characters" (Issue #175): pasted CSV → validated characters.
 * Nothing is returned to add while any row has a problem.
 */

const existing: Character[] = [
  { id: 'aria', type: 'character', name: 'Aria', colour: '#111111', family: 'Vale' },
  { id: 'bram', type: 'character', name: 'Bram Stone', colour: '#222222' }
]
const parse = (text: string, ex: Character[] = existing) => parseCharacterCsv(text, ex)

describe('parseCharacterCsv — the example from the issue', () => {
  const text = [
    'name, sepcies, Group, Family',
    'Griffith (Army) Devoras, Mage, Council, Devoras',
    'Thaddeus (RGuard) Stantorn, Mage, Council, Stantorn'
  ].join('\n')

  it('adds one character per row, known columns to fields and the rest as custom', () => {
    const r = parse(text)
    expect(r.errors).toEqual([])
    expect(r.characters).toHaveLength(2)
    expect(r.characters[0]).toMatchObject({
      id: '',
      type: 'character',
      name: 'Griffith (Army) Devoras',
      group: 'Council',
      family: 'Devoras',
      custom: { sepcies: 'Mage' }
    })
    expect(r.columns.map((c) => c.field)).toEqual(['name', null, 'group', 'family'])
  })

  it('gives each a colour, different from row to row', () => {
    const [a, b] = parse(text).characters
    expect(a.colour).toMatch(/^#[0-9A-F]{6}$/i)
    expect(a.colour).not.toBe(b.colour)
  })
})

describe('parseCharacterCsv — format', () => {
  it('reads tab-separated text, as copied from a spreadsheet', () => {
    const r = parse('Name\tSpecies\tAge\nCleo\tHuman\t31')
    expect(r.errors).toEqual([])
    expect(r.characters[0]).toMatchObject({ name: 'Cleo', species: 'Human', age: 31 })
  })

  it('handles quoted values with commas, quotes and line breaks', () => {
    const r = parse('Name,Role,Tags\n"Doe, Jane","The ""quiet"" one","brave, loyal"\n"Line\nbreak",x,')
    expect(r.errors).toEqual([])
    expect(r.characters[0]).toMatchObject({
      name: 'Doe, Jane',
      role: 'The "quiet" one',
      tags: ['brave', 'loyal']
    })
    expect(r.characters[1].name).toBe('Line\nbreak')
  })

  it('matches headers ignoring case and spacing, with common aliases', () => {
    const r = parse('NAME,Colour,maiden name,Sex,Born\nCleo,#AABBCC,Ray,Female,1984-06')
    expect(r.errors).toEqual([])
    expect(r.characters[0]).toMatchObject({
      colour: '#AABBCC',
      maidenName: 'Ray',
      gender: 'female',
      birthday: '1984-06'
    })
  })

  it('skips blank lines and leaves empty cells unset', () => {
    const r = parse('Name,Species\n\nCleo,\n\n')
    expect(r.errors).toEqual([])
    expect(r.characters).toHaveLength(1)
    expect('species' in r.characters[0]).toBe(false)
  })

  it('is empty, without errors, for empty text', () => {
    expect(parse('  \n')).toEqual({ characters: [], columns: [], errors: [] })
  })
})

describe('parseCharacterCsv — any problem blocks everything', () => {
  it('needs a Name column', () => {
    const r = parse('Species,Group\nMage,Council')
    expect(r.errors).toEqual([{ line: 1, message: expect.stringMatching(/no Name column/) }])
    expect(r.characters).toEqual([])
  })

  it('needs at least one row under the header', () => {
    expect(parse('Name,Species').errors).toEqual([
      { line: 1, message: expect.stringMatching(/no characters below/) }
    ])
  })

  it('refuses a name that already exists, including by its displayed full name', () => {
    const r = parse('Name\nNew Person\nbram stone\nAria Vale')
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [3, expect.stringMatching(/already exists — remove this row/)],
      [4, expect.stringMatching(/already exists/)]
    ])
    // The good row is not added on its own either.
    expect(r.characters).toEqual([])
  })

  it('refuses the same name twice in the paste, and a row with no name', () => {
    const r = parse('Name,Role\nCleo,a\ncleo,b\n,c')
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [3, expect.stringMatching(/listed twice/)],
      [4, 'Has no name.']
    ])
  })

  it('checks values: age, gender, dates, colour, kind', () => {
    const r = parse('Name,Age,Gender,Died,Colour,Kind\nA,old,robot,June,red,villain')
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/Kind "villain"/),
      expect.stringMatching(/Colour "red"/),
      expect.stringMatching(/Age "old"/),
      expect.stringMatching(/Gender "robot"/),
      expect.stringMatching(/Died "June"/)
    ])
  })

  it('flags more values than columns — usually an unquoted comma', () => {
    const r = parse('Name,Role\nCleo,Hero, of sorts')
    expect(r.errors).toEqual([
      { line: 2, message: expect.stringMatching(/3 values but there are only 2 columns/) }
    ])
  })

  it('flags header problems: empty, reserved and repeated columns', () => {
    const r = parse('Name,,id,Colour,Color\nCleo,x,y,#000000,#000000')
    expect(r.errors.map((e) => e.message)).toEqual([
      'Column 2 has no name.',
      expect.stringMatching(/"id" is set by the app/),
      expect.stringMatching(/"Color" and "Colour" are the same column/)
    ])
  })

  it('reports an unclosed quote', () => {
    expect(parse('Name\n"Cleo').errors).toEqual([
      { line: 2, message: expect.stringMatching(/never closed/) }
    ])
  })

  it('keeps people fields off a plot row', () => {
    const ok = parse('Name,Kind,Group\nThe Mystery,plot,Threads')
    expect(ok.characters[0]).toMatchObject({ rowKind: 'plot', group: 'Threads' })
    const bad = parse('Name,Kind,Species\nThe Mystery,Plot,Mage')
    expect(bad.errors).toEqual([
      { line: 2, message: expect.stringMatching(/plot row cannot have Species/) }
    ])
  })
})

describe('parseCharacterCsv — family links by name', () => {
  it('points at existing characters by id, and at pasted rows by placeholder', () => {
    const r = parse('Name,Father,Mother\nKid,Bram Stone,Mum\nMum,,')
    expect(r.errors).toEqual([])
    expect(r.characters[0]).toMatchObject({ father: 'bram', mother: newRef(1) })
  })

  it('makes a marriage within the paste symmetric', () => {
    const r = parse('Name,Spouse\nX,Y\nY,\nZ,Aria; X')
    expect(r.errors).toEqual([])
    expect(r.characters[0].spouse).toEqual([newRef(1), newRef(2)])
    expect(r.characters[1].spouse).toEqual([newRef(0)])
    expect(r.characters[2].spouse).toEqual(['aria', newRef(0)])
  })

  it('refuses a name it cannot find, an ambiguous one, and oneself', () => {
    const twins: Character[] = [
      { id: 'sam-1', type: 'character', name: 'Sam', colour: '#000000' },
      { id: 'sam-2', type: 'character', name: 'Sam', colour: '#000000' }
    ]
    const r = parse('Name,Father,Spouse\nKid,Nobody,\nOther,Sam,\nSolo,,Solo', twins)
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [2, expect.stringMatching(/Father "Nobody" is not a character/)],
      [3, expect.stringMatching(/matches 2 characters/)],
      [4, expect.stringMatching(/same character/)]
    ])
  })
})
