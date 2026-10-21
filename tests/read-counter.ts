import { promises as fs } from 'fs'
import { relative, sep } from 'path'
import { vi } from 'vitest'

/**
 * Count the files a piece of code reads (#185).
 *
 * The project index (#184) is judged by one number: an edit must read only the
 * files it wrote, never the whole project. Every project read in the main process
 * goes through `fs.promises.readFile` (via `readText` in `fsutil.ts`), so spying
 * on it sees them all.
 *
 * Paths come back relative to `root` with forward slashes, so a test can assert
 * on them directly: `expect(reads).toEqual(['boards/main/board.json'])`.
 */
export async function countReads<T>(root: string, fn: () => Promise<T>): Promise<{ result: T; reads: string[] }> {
  const spy = vi.spyOn(fs, 'readFile')
  try {
    const result = await fn()
    const reads = spy.mock.calls
      .map(([path]) => relative(root, String(path)).split(sep).join('/'))
      // Only the project's own files: app config and the like are not the index's business.
      .filter((p) => !p.startsWith('..'))
    return { result, reads }
  } finally {
    spy.mockRestore()
  }
}
