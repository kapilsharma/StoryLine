import { resolve } from 'path'

/**
 * Every project file the app has written, deleted or renamed since the project
 * index last looked (#184, #187).
 *
 * The index (`src/main/projectIndex.ts`) keeps the open project in memory so an
 * edit doesn't re-read the whole project. Rather than teach each of the ~35
 * mutating IPC handlers how to patch it, the writers themselves report here —
 * `writeTextGuarded` and the repository's delete/rename helpers — and the index
 * re-reads exactly these paths the next time a snapshot is asked for. A handler
 * added later is covered without knowing the index exists.
 *
 * Recorded *after* the filesystem call completes, so a drain never picks up a
 * file mid-write.
 */

/** What happened to a path: it now has content, or it is gone. */
export type TouchType = 'change' | 'unlink'

export interface Touch {
  /** Absolute path. */
  path: string
  type: TouchType
}

/** Absolute path → the last thing that happened to it (a later write wins over a delete). */
const touches = new Map<string, TouchType>()

/** Record that the app just wrote (`change`) or removed (`unlink`) `path`. */
export function recordTouch(path: string, type: TouchType): void {
  const key = resolve(path)
  // Re-insert so iteration order follows the latest event.
  touches.delete(key)
  touches.set(key, type)
}

/** Take every recorded touch, oldest first, and forget them. */
export function drainTouches(): Touch[] {
  const out = [...touches].map(([path, type]) => ({ path, type }))
  touches.clear()
  return out
}

/** Forget every recorded touch — a fresh index has read the files anyway. */
export function clearTouches(): void {
  touches.clear()
}
