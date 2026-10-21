import type { ProjectSnapshot, SnapshotReply } from '@shared/ipc'
import { applyReply, type HeldSnapshot } from '@shared/patch'

/**
 * Handlers that change the project reply with what changed (#188), not the whole
 * snapshot. Tests that drive the handlers directly want the snapshot, so this
 * follows the replies exactly as the renderer's store does — a whole snapshot
 * replaces, a patch applies onto the version it names — and hands back the
 * snapshot each one stands for. Anything that is not a reply passes through.
 *
 * A gap (a patch from a version not held) throws: in a test that is a bug, not
 * something to recover from.
 */
export function replyReader(): <T>(value: T) => T {
  let held: HeldSnapshot | null = null
  return <T>(value: T): T => {
    if (!isReply(value)) return value
    const next = applyReply(held, value)
    if (!next) {
      throw new Error(`reply gap: holding v${held?.version}, got a patch from v${(value as { from?: number }).from}`)
    }
    held = next
    return next.snapshot as T
  }
}

export function isReply(value: unknown): value is SnapshotReply {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return (kind === 'snapshot' || kind === 'patch') && typeof (value as { version?: unknown }).version === 'number'
}

/** The snapshot in a whole-snapshot reply (the static API never sends patches). */
export async function snapshotOf(reply: SnapshotReply | Promise<SnapshotReply>): Promise<ProjectSnapshot> {
  const r = await reply
  if (r.kind !== 'snapshot') throw new Error('expected a whole snapshot, got a patch')
  return r.snapshot
}
