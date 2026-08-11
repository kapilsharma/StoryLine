import { describe, expect, it } from 'vitest'
import { birthYear } from '@shared/dates'
import { buildGraph } from '@shared/graph'
import {
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_YEARS_PER_ROW,
  layoutTree,
  rowPx,
  timelineAxis
} from '../../src/renderer/src/components/tree/layout'
import { nuclear, view } from '../family-fixtures'

describe('birthYear (Issue 30)', () => {
  it('reads a numeric year from full, partial and bare-year dates', () => {
    expect(birthYear('1984-06-12')).toBe(1984)
    expect(birthYear('1984-06')).toBe(1984)
    expect(birthYear('1984')).toBe(1984)
  })

  it('is null for free text, blank, or undefined (those float freely)', () => {
    expect(birthYear('third age, spring')).toBeNull()
    expect(birthYear('')).toBeNull()
    expect(birthYear(undefined)).toBeNull()
  })
})

describe('timelineAxis (Issue 30)', () => {
  it('spans the dated members with the earliest year at the top', () => {
    const axis = timelineAxis(nuclear, DEFAULT_LAYOUT_OPTIONS)
    expect(axis).not.toBeNull()
    expect(axis!.minYear).toBe(1950) // dad
    expect(axis!.maxYear).toBe(1981) // kid-c
    expect(axis!.yForYear(1950)).toBe(0)
    expect(axis!.yForYear(1981)).toBeGreaterThan(axis!.yForYear(1950))
  })

  it('defaults to a compact 20 years per row', () => {
    const axis = timelineAxis(nuclear, DEFAULT_LAYOUT_OPTIONS)!
    expect(axis.pxPerYear).toBeCloseTo(rowPx(DEFAULT_LAYOUT_OPTIONS) / DEFAULT_YEARS_PER_ROW)
    // A ~20-year span is roughly one row tall, not ~20 rows.
    expect(axis.yForYear(1970)).toBeCloseTo(rowPx(DEFAULT_LAYOUT_OPTIONS))
  })

  it('scales with years-per-row (more years/row = denser = smaller px/year)', () => {
    const dense = timelineAxis(nuclear, DEFAULT_LAYOUT_OPTIONS, 100)!
    const loose = timelineAxis(nuclear, DEFAULT_LAYOUT_OPTIONS, 5)!
    expect(dense.pxPerYear).toBeLessThan(loose.pxPerYear)
  })

  it('is null when nobody has a numeric birth year', () => {
    expect(timelineAxis([], DEFAULT_LAYOUT_OPTIONS)).toBeNull()
  })
})

describe('layoutTree timeline mode (Issue 30)', () => {
  const graph = buildGraph(nuclear)
  const gap = (yearsPerRow?: number): number => {
    const layout = layoutTree(graph, view({ mode: 'timeline', yearsPerRow }))
    const y = new Map(layout.nodes.map((n) => [n.id, n.y]))
    return y.get('kid-a')! - y.get('dad')! // 1975 − 1950
  }

  it('pins every dated node to its birth-year line', () => {
    const layout = layoutTree(graph, view({ mode: 'timeline' }))
    expect(layout.timeline).toBeTruthy()
    for (const n of layout.nodes) {
      const year = birthYear(n.character.birthday)
      if (year != null) expect(n.y).toBe(layout.timeline!.yForYear(year))
    }
    expect(gap()).toBeGreaterThan(0) // parent above child
  })

  it('honours the view yearsPerRow (more years/row = more compact)', () => {
    expect(gap(100)).toBeLessThan(gap(5))
  })

  it('leaves free-flow trees without a year axis', () => {
    expect(layoutTree(graph, view({ mode: 'freeflow' })).timeline).toBeUndefined()
  })
})
