import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// #190: one settled watcher event can cover our write *and* an external edit just
// after it. The mtime our write left tells them apart.
describe('ownWrites — matching the mtime the write left', () => {
  beforeEach(() => clearOwnWrites())

  it('claims the file while it is exactly as our write left it', () => {
    markOwnWrite('/proj/notes/a.md', 1000)
    expect(claimOwnWrite('/proj/notes/a.md', 1000.4)).toBe(true)
  })

  it('does not claim it once someone has written after us', () => {
    markOwnWrite('/proj/notes/a.md', 1000)
    expect(claimOwnWrite('/proj/notes/a.md', 1250)).toBe(false)
    // …and the claim is spent, so it can't swallow a later event either.
    expect(claimOwnWrite('/proj/notes/a.md', 1000)).toBe(false)
  })

  it('falls back to the path alone when either side has no mtime', () => {
    markOwnWrite('/proj/notes/a.md')
    expect(claimOwnWrite('/proj/notes/a.md', 1250)).toBe(true)
    markOwnWrite('/proj/notes/b.md', 1000)
    expect(claimOwnWrite('/proj/notes/b.md')).toBe(true)
  })
})
