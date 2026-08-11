import type { Character } from '@shared/types'
import { birthYear } from '@shared/dates'
import type { LayoutOptions, TimelineAxis } from './types'

/**
 * How many calendar years fill one row-height by default. Generational trees
 * span ~30 years parent-to-child, so pinning one year to a whole row makes the
 * canvas absurdly tall — a compact default keeps a family on one screen while
 * the per-view "years per row" control lets a user spread it back out.
 */
export const DEFAULT_YEARS_PER_ROW = 20

/** One "row" of vertical space — the same unit a generation occupies free-flow. */
export function rowPx(opts: LayoutOptions): number {
  return opts.nodeHeight + opts.generationGap
}

/**
 * Build the year axis from the dated members (Issue 30). Earliest year at the
 * top. `yearsPerRow` sets the vertical density: `pxPerYear = rowPx / yearsPerRow`.
 * Returns null when nobody has a numeric birth year, so the caller can fall back
 * to a plain free-moving canvas rather than draw an axis with no anchor.
 */
export function timelineAxis(
  characters: Character[],
  opts: LayoutOptions,
  yearsPerRow: number = DEFAULT_YEARS_PER_ROW
): TimelineAxis | null {
  let minYear = Infinity
  let maxYear = -Infinity
  for (const c of characters) {
    const y = birthYear(c.birthday)
    if (y == null) continue
    if (y < minYear) minYear = y
    if (y > maxYear) maxYear = y
  }
  if (minYear === Infinity) return null

  const perRow = yearsPerRow > 0 ? yearsPerRow : DEFAULT_YEARS_PER_ROW
  const pxPerYear = rowPx(opts) / perRow
  return {
    minYear,
    maxYear,
    pxPerYear,
    yForYear: (year) => (year - minYear) * pxPerYear
  }
}
