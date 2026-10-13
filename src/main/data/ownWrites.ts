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
 */

/**
 * How long a claim lives. The watcher's `awaitWriteFinish` delays its event to
 * ~200 ms after the local write settles, so a few seconds is ample headroom
 * while still short enough that a stale claim can't shadow a real edit for long.
 */
const CLAIM_TTL_MS = 5000

/** Absolute path → expiry timestamp (ms). */
const claims = new Map<string, number>()

const key = (path: string): string => resolve(path)

function sweep(now: number): void {
  for (const [path, expiry] of claims) if (expiry <= now) claims.delete(path)
}

/** Record that the app just wrote `path`, so the next watcher event for it is ours. */
export function markOwnWrite(path: string): void {
  const now = Date.now()
  sweep(now)
  claims.set(key(path), now + CLAIM_TTL_MS)
}

/**
 * If `path` was written by the app within the grace window, consume the claim
 * and return true — the watcher should suppress this event. Otherwise false, and
 * the event is treated as a genuine external edit.
 */
export function claimOwnWrite(path: string): boolean {
  const expiry = claims.get(key(path))
  if (expiry == null) return false
  claims.delete(key(path))
  return expiry > Date.now()
}

/** Drop every claim. Called when a project closes or a new one opens. */
export function clearOwnWrites(): void {
  claims.clear()
}
