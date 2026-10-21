import { resolve } from 'path'

/**
 * Tells the filesystem watcher which `change`/`add` events are the app's own
 * writes rather than genuine external edits (Issue #130).
 *
 * Every mutation already writes its file(s) and returns a fresh
 * `ProjectSnapshot` that the renderer applies at once. ~200 ms later the watcher
 * sees that same write and, left alone, re-reads the whole project a second
 * time — pure waste (~500 ms on a Google Drive project) and a race that can
 * briefly stomp in-progress editor state. So each write registers its path here;
 * when the watcher event for that path arrives it is claimed and dropped.
 *
 * A path is claimed exactly once: the first event for it is swallowed and the
 * claim removed, so a *later* genuine external edit to the same file still
 * reloads. Claims also expire after a grace window, in case the watcher never
 * fires for a path (an OS that coalesces events, or a write that leaves the
 * bytes unchanged) — the set can never pin-suppress a real edit indefinitely.
 *
 * A claim can also carry the mtime the app's write left (#190). The watcher
 * reports a file once it has been quiet for a moment, so a write of ours and an
 * external edit made just after it arrive as one event. Matching on the path
 * alone would swallow that external edit; matching the mtime too tells the two
 * apart — the file on disk is no longer the one we wrote.
 */

/**
 * How long a claim lives. The watcher delays its event to ~200 ms after the
 * local write settles, so a few seconds is ample headroom
 * while still short enough that a stale claim can't shadow a real edit for long.
 */
const CLAIM_TTL_MS = 5000

/** Absolute path → when the claim expires (ms), and the mtime our write left, if known. */
const claims = new Map<string, { expiry: number; mtimeMs?: number }>()

const key = (path: string): string => resolve(path)

function sweep(now: number): void {
  for (const [path, { expiry }] of claims) if (expiry <= now) claims.delete(path)
}

/**
 * Record that the app just wrote `path` — leaving it with `mtimeMs`, when known —
 * so the next watcher event for it is ours.
 */
export function markOwnWrite(path: string, mtimeMs?: number): void {
  const now = Date.now()
  sweep(now)
  claims.set(key(path), { expiry: now + CLAIM_TTL_MS, mtimeMs })
}

/**
 * If `path` was written by the app within the grace window — and, when both
 * mtimes are known, is still exactly as that write left it — consume the claim
 * and return true: the watcher should suppress this event. Otherwise false, and
 * the event is treated as a genuine external edit.
 */
export function claimOwnWrite(path: string, mtimeMs?: number): boolean {
  const claim = claims.get(key(path))
  if (!claim) return false
  claims.delete(key(path))
  if (claim.expiry <= Date.now()) return false
  // Both sides know the mtime and it moved: someone wrote after us — theirs.
  if (claim.mtimeMs !== undefined && mtimeMs !== undefined && Math.abs(claim.mtimeMs - mtimeMs) > 1) return false
  return true
}

/** Drop every claim. Called when a project closes or a new one opens. */
export function clearOwnWrites(): void {
  claims.clear()
}
