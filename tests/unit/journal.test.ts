import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { clearTouches, drainTouches, recordTouch } from '@main/data/journal'

/** The touched-path journal behind the project index (#187). */
describe('journal', () => {
  beforeEach(() => clearTouches())

  it('hands back each touched path once, oldest first, then is empty', () => {
    recordTouch(join('/p', 'a.md'), 'change')
    recordTouch(join('/p', 'b.md'), 'unlink')
    expect(drainTouches().map((t) => [t.path.endsWith('a.md'), t.type])).toEqual([
      [true, 'change'],
      [false, 'unlink']
    ])
    expect(drainTouches()).toEqual([])
  })

  it('keeps only the latest event for a path, in the latest position', () => {
    recordTouch(join('/p', 'a.md'), 'unlink')
    recordTouch(join('/p', 'b.md'), 'change')
    recordTouch(join('/p', 'a.md'), 'change') // deleted, then written again
    const touches = drainTouches()
    expect(touches).toHaveLength(2)
    expect(touches[1]).toMatchObject({ type: 'change' })
    expect(touches[1].path.endsWith('a.md')).toBe(true)
  })

  it('treats two spellings of one path as the same path', () => {
    recordTouch(join('/p', 'x', '..', 'a.md'), 'change')
    recordTouch(join('/p', 'a.md'), 'change')
    expect(drainTouches()).toHaveLength(1)
  })

  it('clear forgets everything', () => {
    recordTouch(join('/p', 'a.md'), 'change')
    clearTouches()
    expect(drainTouches()).toEqual([])
  })
})
