import { describe, expect, it } from 'vitest'
import { buildGraph, spousesOf, unionKey } from '@shared/graph'
import {
  cousinMarriage,
  cycle,
  dangling,
  nuclear,
  person,
  remarriage,
  singleParent
} from '../family-fixtures'

describe('buildGraph', () => {
  it('derives children by inverting father/mother', () => {
    const g = buildGraph(nuclear)
    expect(g.childrenOf.get('dad')?.sort()).toEqual(['kid-a', 'kid-b', 'kid-c'])
    expect(g.childrenOf.get('mum')?.sort()).toEqual(['kid-a', 'kid-b', 'kid-c'])
  })

  it('puts a married couple and their children in one union', () => {
    const g = buildGraph(nuclear)
    const u = g.unionById.get(unionKey('dad', 'mum'))
    expect(u).toBeDefined()
    expect(u!.partnerIds.sort()).toEqual(['dad', 'mum'])
    expect(u!.childIds).toHaveLength(3)
    // The marriage and the parenthood must not produce two separate unions.
    expect(g.unions).toHaveLength(1)
  })

  it('sorts siblings by birthday', () => {
    const g = buildGraph(nuclear)
    expect(g.unions[0].childIds).toEqual(['kid-a', 'kid-b', 'kid-c'])
  })

  it('gives a remarried person one union per marriage', () => {
    const g = buildGraph(remarriage)
    expect(g.unionsOf.get('hub')).toHaveLength(2)
    expect(spousesOf(g, 'hub').sort()).toEqual(['wife-1', 'wife-2'])
    const first = g.unionById.get(unionKey('hub', 'wife-1'))!
    const second = g.unionById.get(unionKey('hub', 'wife-2'))!
    expect(first.childIds).toEqual(['kid-1'])
    expect(second.childIds).toEqual(['kid-2'])
  })

  it('handles a lone parent as a one-partner union', () => {
    const g = buildGraph(singleParent)
    const u = g.unions.find((x) => x.childIds.includes('only-1'))!
    expect(u.partnerIds).toEqual(['solo'])
    expect(u.childIds).toEqual(['only-1', 'only-2'])
  })

  it('supports the DAG case: cousins marrying', () => {
    const g = buildGraph(cousinMarriage)
    expect(g.byId.size).toBe(8)
    expect(spousesOf(g, 'cousin-1')).toEqual(['cousin-2'])
    // Both cousins keep their own parents — the graph is not flattened to a tree.
    expect(g.byId.get('cousin-1')!.father).toBe('branch-1')
    expect(g.byId.get('cousin-2')!.mother).toBe('branch-2')
  })

  it('synthesises a ghost for a dangling reference and reports it', () => {
    const g = buildGraph(dangling)
    const ghost = g.byId.get('missing-dad')
    expect(ghost?.ghost).toBe(true)
    expect(ghost?.name).toBe('Missing Dad')
    expect(g.problems.some((p) => p.kind === 'dangling')).toBe(true)
  })

  it('heals a one-sided spouse link and reports it', () => {
    const g = buildGraph([
      person('a', 'male', { spouse: ['b'] }),
      person('b', 'female') // does not list a
    ])
    expect(spousesOf(g, 'b')).toEqual(['a'])
    expect(g.problems.some((p) => p.kind === 'asymmetric-spouse')).toBe(true)
  })

  it('drops self-references rather than building a loop', () => {
    const g = buildGraph([person('me', 'male', { father: 'me', spouse: ['me'] })])
    expect(g.problems.filter((p) => p.kind === 'self-reference')).toHaveLength(2)
    expect(g.childrenOf.get('me') ?? []).toEqual([])
    expect(spousesOf(g, 'me')).toEqual([])
  })

  it('builds a cyclic graph without hanging (the cut happens in layout)', () => {
    const g = buildGraph(cycle)
    expect(g.byId.size).toBe(3)
  })
})
