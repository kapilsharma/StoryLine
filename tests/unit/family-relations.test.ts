import { describe, expect, it } from 'vitest'
import { applyChildren, clearReferencesTo, retargetReferences, syncSpouses } from '../../src/main/data/relations'
import { nuclear, person } from '../family-fixtures'

describe('syncSpouses', () => {
  it('writes the new partner’s side of a marriage', () => {
    const all = [person('a', 'male'), person('b', 'female')]
    const writes = syncSpouses(all, { ...all[0], spouse: ['b'] })
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('b')
    expect(writes[0].spouse).toEqual(['a'])
  })

  it('clears the other side when a marriage is removed', () => {
    const all = [person('a', 'male', { spouse: ['b'] }), person('b', 'female', { spouse: ['a'] })]
    const writes = syncSpouses(all, { ...all[0], spouse: [] })
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('b')
    expect(writes[0].spouse).toEqual([])
  })

  it('does nothing when the link is already symmetric', () => {
    const all = [person('a', 'male', { spouse: ['b'] }), person('b', 'female', { spouse: ['a'] })]
    expect(syncSpouses(all, all[0])).toHaveLength(0)
  })
})

describe('clearReferencesTo', () => {
  it('removes a deleted parent from their children', () => {
    const writes = clearReferencesTo(nuclear, 'dad')
    const kid = writes.find((c) => c.id === 'kid-a')!
    expect(kid.father).toBeUndefined()
    expect(kid.mother).toBe('mum')
    // The surviving spouse loses the link too.
    expect(writes.find((c) => c.id === 'mum')!.spouse).toBeUndefined()
  })

  it('touches nobody when the character is unreferenced', () => {
    const all = [...nuclear, person('stranger', 'other')]
    expect(clearReferencesTo(all, 'stranger')).toHaveLength(0)
  })
})

describe('retargetReferences', () => {
  it('moves every inbound relation to the new id', () => {
    const writes = retargetReferences(nuclear, 'dad', 'father-renamed')
    expect(writes.find((c) => c.id === 'kid-a')!.father).toBe('father-renamed')
    expect(writes.find((c) => c.id === 'mum')!.spouse).toEqual(['father-renamed'])
  })
})

describe('applyChildren', () => {
  it('writes the parent link onto the child, not onto the parent', () => {
    const all = [person('mum', 'female'), person('kid', 'male')]
    const writes = applyChildren(all, all[0], ['kid'])
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe('kid')
    expect(writes[0].mother).toBe('mum')
  })

  it('uses father for a male parent', () => {
    const all = [person('dad', 'male'), person('kid', 'male')]
    expect(applyChildren(all, all[0], ['kid'])[0].father).toBe('dad')
  })

  it('clears the link when a child is removed from the list', () => {
    const all = [person('dad', 'male'), person('kid', 'male', { father: 'dad' })]
    const writes = applyChildren(all, all[0], [])
    expect(writes).toHaveLength(1)
    expect(writes[0].father).toBeUndefined()
  })

  it('ignores an attempt to make someone their own child', () => {
    const all = [person('dad', 'male')]
    expect(applyChildren(all, all[0], ['dad'])).toHaveLength(0)
  })
})
