import { describe, expect, it } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../../src/main/data/frontmatter'
import { characterToFrontmatter, frontmatterToCharacter } from '../../src/main/data/mappers'

/**
 * Pins the character file format across the Family-tab merge (Issue 29).
 *
 * The family block was additive, which is what let it land without a schema bump
 * or a migration — but "additive" is only true while two properties hold, and
 * both are easy to break by accident in `mappers.ts`:
 *
 *  1. A character file **with** family fields round-trips unchanged.
 *  2. A character file **without** them round-trips unchanged too — in
 *     particular it does not acquire `gender: unknown` just for being opened.
 *
 * Property 2 is what keeps every existing project's files untouched, and is the
 * one place this repo deliberately differs from the standalone family tree, which
 * always wrote a gender.
 */

const FAMILY_FILE = `---
id: rowan-ashvale
type: character
name: Rowan Ashvale
colour: '#E24B4A'
role: Protagonist
age: 34
species: Human
tags:
  - main-cast
group: Ashvales
family: Ashvale
gender: male
birthday: '1984-06-12'
died: '2050'
maidenName: Ashvale
father: edmund-ashvale
mother: hester-ashvale
spouse:
  - mira-renmoor
somethingCustom: kept
---

## Notes

Body must survive byte-for-byte.

## Research
`

/** A character as written before the Family tab existed. */
const STORY_ONLY_FILE = `---
id: aeri
type: character
name: Aeri
colour: '#4A90D9'
role: Protagonist
group: Humans
---

## Notes

## Research
`

describe('character file round-trip with family fields', () => {
  it('preserves every field and the body', () => {
    const { data, body } = parseFrontmatter(FAMILY_FILE)
    const character = frontmatterToCharacter(data, 'rowan-ashvale')
    const out = serializeFrontmatter(characterToFrontmatter(character), body)
    const after = parseFrontmatter(out)

    expect(after.body).toBe(body)
    for (const key of [
      'id',
      'type',
      'name',
      'colour',
      'role',
      'age',
      'species',
      'group',
      'family',
      'gender',
      'birthday',
      'died',
      'maidenName',
      'father',
      'mother',
      'somethingCustom'
    ]) {
      expect({ key, value: after.data[key] }).toEqual({ key, value: data[key] })
    }
    expect(after.data.tags).toEqual(['main-cast'])
    expect(after.data.spouse).toEqual(['mira-renmoor'])
  })

  it('leaves a pre-v0.6.0 character byte-identical — no gender is invented', () => {
    const { data, body } = parseFrontmatter(STORY_ONLY_FILE)
    const character = frontmatterToCharacter(data, 'aeri')
    expect(character.gender).toBeUndefined()

    const out = serializeFrontmatter(characterToFrontmatter(character), body)
    expect(out).toBe(STORY_ONLY_FILE)
  })

  it('writes dates quoted, so YAML cannot re-type them as timestamps', () => {
    // Unquoted, `1984-06-12` parses as a Date at UTC midnight and formats as
    // June 11 in any negative-offset timezone. See src/shared/dates.ts.
    const out = serializeFrontmatter(
      characterToFrontmatter(
        frontmatterToCharacter({ name: 'X', birthday: '1984-06-12', died: '2001' }, 'x')
      ),
      '\n'
    )
    expect(out).toContain("birthday: '1984-06-12'")
    expect(out).toContain("died: '2001'")
    expect(parseFrontmatter(out).data.birthday).toBe('1984-06-12')
  })

  it('un-mangles a date YAML already typed, rather than propagating it', () => {
    // What an externally-edited (unquoted) file actually parses to.
    const fromDate = frontmatterToCharacter(
      { name: 'X', birthday: new Date('1984-06-12T00:00:00.000Z') },
      'x'
    )
    expect(fromDate.birthday).toBe('1984-06-12')
    const fromNumber = frontmatterToCharacter({ name: 'X', birthday: 1984 }, 'x')
    expect(fromNumber.birthday).toBe('1984')
  })

  it('carries unknown keys through `custom`', () => {
    const character = frontmatterToCharacter({ name: 'X', storyOnlyField: 'value', nested: { a: 1 } }, 'x')
    expect(character.custom).toEqual({ storyOnlyField: 'value', nested: { a: 1 } })
    const fm = characterToFrontmatter(character)
    expect(fm.storyOnlyField).toBe('value')
    expect(fm.nested).toEqual({ a: 1 })
  })

  it('never writes a children key — the child→parent edge is canonical', () => {
    const character = frontmatterToCharacter({ name: 'Parent', children: ['kid-a', 'kid-b'] }, 'parent')
    const fm = characterToFrontmatter(character)
    expect(fm.children).toBeUndefined()
    // ...and it is not smuggled back in as a custom field either.
    expect(character.custom).toBeUndefined()
  })

  it('reads leniently: a bad file degrades rather than throwing', () => {
    const character = frontmatterToCharacter(
      { name: 42, gender: 'wizard', spouse: 'single-string', father: '  spaced  ' },
      'odd'
    )
    expect(character.name).toBe('odd')
    // An unrecognised gender is still a stated gender, so it becomes 'unknown'
    // rather than disappearing.
    expect(character.gender).toBe('unknown')
    expect(character.spouse).toEqual(['single-string'])
    expect(character.father).toBe('spaced')
  })
})
