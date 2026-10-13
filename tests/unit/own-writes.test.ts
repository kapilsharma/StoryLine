import { afterEach, describe, expect, it, vi } from 'vitest'
import { markOwnWrite, claimOwnWrite, clearOwnWrites } from '@main/data/ownWrites'

/**
 * The registry that lets the watcher tell the app's own writes from external
 * edits (#130). Paths are compared after `path.resolve`, so the exact string
 * does not matter — only that mark and claim agree.
 */
describe('ownWrites (#130 watcher own-write suppression)', () => {
  afterEach(() => {
    clearOwnWrites()
    vi.useRealTimers()
  })

  it('claims a path the app just wrote, and only once', () => {
    markOwnWrite('/proj/boards/b/board.json')
    // The watcher event for our write is suppressed…
    expect(claimOwnWrite('/proj/boards/b/board.json')).toBe(true)
    // …but a later edit to the same file is a genuine external change again.
    expect(claimOwnWrite('/proj/boards/b/board.json')).toBe(false)
  })

  it('does not claim a path the app never wrote', () => {
    expect(claimOwnWrite('/proj/boards/b/notes/x.md')).toBe(false)
  })

  it('matches regardless of how the path is spelled', () => {
    markOwnWrite('/proj/boards/b/notes/x.md')
    expect(claimOwnWrite('/proj/boards/b/sub/../notes/x.md')).toBe(true)
  })

  it('expires a stale claim so a much later external edit still reloads', () => {
    vi.useFakeTimers()
    markOwnWrite('/proj/project.json')
    vi.advanceTimersByTime(6000) // past the grace window
    expect(claimOwnWrite('/proj/project.json')).toBe(false)
  })

  it('drops every claim when cleared (project close/open)', () => {
    markOwnWrite('/proj/a.json')
    clearOwnWrites()
    expect(claimOwnWrite('/proj/a.json')).toBe(false)
  })
})
