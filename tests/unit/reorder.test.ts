import { describe, it, expect } from 'vitest'
import { moveAfter, moveBefore } from '@renderer/lib/reorder'

describe('moveBefore', () => {
  it('moves an item up to sit before the target', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('moves an item down to sit before the target', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'a', 'c', 'd'])
  })
  it('is a no-op when dragged equals target', () => {
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })
  it('is a no-op for unknown ids', () => {
    expect(moveBefore(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})

describe('moveAfter', () => {
  it('moves an item up to sit after the target', () => {
    expect(moveAfter(['a', 'b', 'c', 'd'], 'd', 'a')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('moves an item down to sit after the target (incl. last position)', () => {
    expect(moveAfter(['a', 'b', 'c', 'd'], 'a', 'd')).toEqual(['b', 'c', 'd', 'a'])
  })
  it('is a no-op when dragged equals target / unknown ids', () => {
    expect(moveAfter(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveAfter(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})
