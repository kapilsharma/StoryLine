import { promises as fs } from 'fs'
import { dirname } from 'path'

/**
 * Filesystem helpers with an mtime guard to avoid clobbering external edits.
 *
 * Decisions log: auto-save is mtime-guarded — re-read before write if the file
 * changed on disk, to avoid clobbering external (Obsidian/editor) edits.
 */

export interface ReadResult {
  text: string
  /** Modification time in ms; carry this back into a guarded write. */
  mtimeMs: number
}

/** Thrown by `writeTextGuarded` when the file changed on disk since it was read. */
export class StaleWriteError extends Error {
  constructor(public readonly filePath: string) {
    super(`Refusing to write ${filePath}: file changed on disk since last read`)
    this.name = 'StaleWriteError'
  }
}

/** Read a UTF-8 text file along with its current mtime. */
export async function readText(filePath: string): Promise<ReadResult> {
  const [text, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])
  return { text, mtimeMs: stat.mtimeMs }
}

/**
 * Write `text` to `filePath`, creating parent directories as needed.
 *
 * When `expectedMtimeMs` is provided, the current on-disk mtime must match it
 * (within a 1ms tolerance) or `StaleWriteError` is thrown — the caller should
 * reload and re-apply its change. Pass `undefined` to write unconditionally
 * (e.g. for a brand-new file).
 *
 * Returns the mtime of the freshly written file.
 */
export async function writeTextGuarded(
  filePath: string,
  text: string,
  expectedMtimeMs?: number
): Promise<number> {
  if (expectedMtimeMs !== undefined) {
    try {
      const stat = await fs.stat(filePath)
      if (Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        throw new StaleWriteError(filePath)
      }
    } catch (err) {
      // ENOENT means the file is gone — fall through and recreate it.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, text, 'utf8')
  const stat = await fs.stat(filePath)
  return stat.mtimeMs
}

/** True if a path exists. */
export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
