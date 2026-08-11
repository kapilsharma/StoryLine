import type { Character, Gender } from '@shared/types'
import { defaultView, type View } from '@shared/types'

/**
 * Fixture families for the family-tree tests (Issue 29). Reused across every
 * layout test, so a regression shows up in the same place each time.
 */

export function person(
  id: string,
  gender: Gender,
  extra: Partial<Character> = {}
): Character {
  return {
    id,
    type: 'character',
    name: id
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    colour: '#888888',
    gender,
    ...extra
  }
}

/** Two parents and three children. */
export const nuclear: Character[] = [
  person('dad', 'male', { spouse: ['mum'], birthday: '1950' }),
  person('mum', 'female', { spouse: ['dad'], birthday: '1952' }),
  person('kid-a', 'male', { father: 'dad', mother: 'mum', birthday: '1975' }),
  person('kid-b', 'female', { father: 'dad', mother: 'mum', birthday: '1978' }),
  person('kid-c', 'male', { father: 'dad', mother: 'mum', birthday: '1981' })
]

/** Grandparents → parents → children. */
export const threeGenerations: Character[] = [
  person('gp-1', 'male', { spouse: ['gp-2'], birthday: '1920' }),
  person('gp-2', 'female', { spouse: ['gp-1'], birthday: '1922' }),
  person('parent', 'male', { father: 'gp-1', mother: 'gp-2', spouse: ['parent-in-law'], birthday: '1950' }),
  person('parent-in-law', 'female', { spouse: ['parent'], birthday: '1951' }),
  person('child-1', 'female', { father: 'parent', mother: 'parent-in-law', birthday: '1975' }),
  person('child-2', 'male', { father: 'parent', mother: 'parent-in-law', birthday: '1977' })
]

/** One person, two unions, children in both. */
export const remarriage: Character[] = [
  person('hub', 'male', { spouse: ['wife-1', 'wife-2'], birthday: '1940' }),
  person('wife-1', 'female', { spouse: ['hub'], birthday: '1942' }),
  person('wife-2', 'female', { spouse: ['hub'], birthday: '1955' }),
  person('kid-1', 'male', { father: 'hub', mother: 'wife-1', birthday: '1965' }),
  person('kid-2', 'female', { father: 'hub', mother: 'wife-2', birthday: '1980' })
]

/** A lone parent with children. */
export const singleParent: Character[] = [
  person('solo', 'female', { birthday: '1960' }),
  person('only-1', 'male', { mother: 'solo', birthday: '1985' }),
  person('only-2', 'female', { mother: 'solo', birthday: '1988' })
]

/** Cousins marry — the DAG case a pure tree layout cannot express. */
export const cousinMarriage: Character[] = [
  person('root-a', 'male', { spouse: ['root-b'], birthday: '1900' }),
  person('root-b', 'female', { spouse: ['root-a'], birthday: '1902' }),
  person('branch-1', 'male', { father: 'root-a', mother: 'root-b', spouse: ['spouse-1'], birthday: '1930' }),
  person('branch-2', 'female', { father: 'root-a', mother: 'root-b', spouse: ['spouse-2'], birthday: '1932' }),
  person('spouse-1', 'female', { spouse: ['branch-1'], birthday: '1931' }),
  person('spouse-2', 'male', { spouse: ['branch-2'], birthday: '1930' }),
  person('cousin-1', 'male', { father: 'branch-1', mother: 'spouse-1', spouse: ['cousin-2'], birthday: '1960' }),
  person('cousin-2', 'female', { father: 'spouse-2', mother: 'branch-2', spouse: ['cousin-1'], birthday: '1962' })
]

/** A person is their own ancestor — must be reported, not hung. */
export const cycle: Character[] = [
  person('a', 'male', { father: 'c' }),
  person('b', 'male', { father: 'a' }),
  person('c', 'male', { father: 'b' })
]

/** A reference with no file behind it. */
export const dangling: Character[] = [person('orphan', 'female', { father: 'missing-dad' })]

/** Two unrelated families with no link at all. */
export const orphans: Character[] = [
  person('x-1', 'male', { spouse: ['x-2'] }),
  person('x-2', 'female', { spouse: ['x-1'] }),
  person('y-1', 'male', { spouse: ['y-2'] }),
  person('y-2', 'female', { spouse: ['y-1'] })
]

/**
 * Two lineages joined by exactly one marriage. This is the fixture that proves
 * the whole point of views: the same data must render as her side, his
 * side, or the joined tree purely by changing the view.
 */
export const twoFamiliesJoined: Character[] = [
  // His side
  person('h-gp1', 'male', { spouse: ['h-gp2'], birthday: '1920' }),
  person('h-gp2', 'female', { spouse: ['h-gp1'], birthday: '1921' }),
  person('him', 'male', { father: 'h-gp1', mother: 'h-gp2', spouse: ['her'], birthday: '1950' }),
  person('his-sister', 'female', { father: 'h-gp1', mother: 'h-gp2', birthday: '1953' }),
  // Her side
  person('w-gp1', 'male', { spouse: ['w-gp2'], birthday: '1922' }),
  person('w-gp2', 'female', { spouse: ['w-gp1'], birthday: '1924' }),
  person('her', 'female', { father: 'w-gp1', mother: 'w-gp2', spouse: ['him'], birthday: '1952' }),
  person('her-brother', 'male', { father: 'w-gp1', mother: 'w-gp2', birthday: '1955' }),
  // The joining generation
  person('their-kid', 'female', { father: 'him', mother: 'her', birthday: '1980' })
]

/**
 * A view with the given filters applied over the defaults.
 *
 * `members: null` rather than `defaultView`'s `[]`, because these fixtures exist
 * to test the **filters** and the layout engine: null is what makes the filters
 * live. Membership itself is exercised in `family-membership.test.ts`, which sets
 * `members` explicitly — as the app does.
 */
export function view(patch: Partial<View> = {}): View {
  return { ...defaultView('test', 'Test'), members: null, ...patch }
}
