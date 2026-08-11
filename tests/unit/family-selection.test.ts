import { describe, expect, it } from 'vitest'
import { buildGraph } from '@shared/graph'
import { selectCharacters } from '../../src/renderer/src/components/tree/layout'
import { threeGenerations, twoFamiliesJoined, view } from '../family-fixtures'

/**
 * Pass 0 (solution.md §5.2) — the filters that make one view a different family
 * tree. `twoFamiliesJoined` is the fixture that matters: one dataset, three
 * different trees, chosen purely by the view.
 */

const select = (characters: Parameters<typeof buildGraph>[0], v: ReturnType<typeof view>): string[] =>
  [...selectCharacters(buildGraph(characters), v)].sort()

describe('no root', () => {
  it('selects everyone', () => {
    expect(select(threeGenerations, view())).toHaveLength(threeGenerations.length)
  })

  it('still honours the hidden list', () => {
    const got = select(threeGenerations, view({ hidden: ['child-2'] }))
    expect(got).not.toContain('child-2')
  })
})

describe('depth caps', () => {
  it('childDepth 0 gives ancestors only', () => {
    const got = select(threeGenerations, view({ root: 'parent', childDepth: 0 }))
    expect(got).toContain('gp-1')
    expect(got).toContain('gp-2')
    expect(got).not.toContain('child-1')
  })

  it('parentDepth 0 gives descendants only', () => {
    const got = select(threeGenerations, view({ root: 'parent', parentDepth: 0 }))
    expect(got).toContain('child-1')
    expect(got).not.toContain('gp-1')
  })

  it('limits how many generations up', () => {
    const got = select(
      twoFamiliesJoined,
      view({ root: 'their-kid', parentDepth: 1, childDepth: 0, includeSpouseFamilies: false })
    )
    expect(got).toContain('him')
    expect(got).toContain('her')
    expect(got).not.toContain('h-gp1')
  })
})

describe('spouses', () => {
  it('always comes along, so a couple is never split', () => {
    const got = select(
      threeGenerations,
      view({ root: 'parent', parentDepth: 0, childDepth: 0, includeSpouseFamilies: false })
    )
    expect(got).toContain('parent-in-law')
  })
})

describe('includeSpouseFamilies — one dataset, three trees', () => {
  const hisSide = view({ root: 'him', includeSpouseFamilies: false })
  const herSide = view({ root: 'her', includeSpouseFamilies: false })
  const joined = view({ root: 'their-kid', includeSpouseFamilies: true })

  it('his side excludes her parents', () => {
    const got = select(twoFamiliesJoined, hisSide)
    expect(got).toContain('h-gp1')
    expect(got).toContain('his-sister')
    // She is his spouse, so she is present — but her family is not.
    expect(got).toContain('her')
    expect(got).not.toContain('w-gp1')
    expect(got).not.toContain('her-brother')
  })

  it('her side excludes his parents', () => {
    const got = select(twoFamiliesJoined, herSide)
    expect(got).toContain('w-gp1')
    expect(got).toContain('her-brother')
    expect(got).toContain('him')
    expect(got).not.toContain('h-gp1')
    expect(got).not.toContain('his-sister')
  })

  it('the joined tree reaches both families from the child', () => {
    const got = select(twoFamiliesJoined, joined)
    for (const id of ['h-gp1', 'h-gp2', 'w-gp1', 'w-gp2', 'him', 'her', 'their-kid']) {
      expect(got).toContain(id)
    }
  })

  it('the three trees differ only by the view, never by the data', () => {
    const a = select(twoFamiliesJoined, hisSide)
    const b = select(twoFamiliesJoined, herSide)
    const c = select(twoFamiliesJoined, joined)
    expect(a).not.toEqual(b)
    expect(c.length).toBeGreaterThan(a.length)
    expect(c.length).toBeGreaterThan(b.length)
  })
})

describe('termination', () => {
  it('finishes on a densely interlinked graph', () => {
    // Cousin marriage plus spouse-family expansion is the case most likely to
    // loop if the walk is not guarded.
    const got = select(
      twoFamiliesJoined,
      view({ root: 'their-kid', includeSpouseFamilies: true })
    )
    expect(got.length).toBe(twoFamiliesJoined.length)
  })
})
