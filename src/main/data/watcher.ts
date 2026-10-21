import { watch, type FSWatcher } from 'fs'
import { stat } from 'fs/promises'
import { basename, join, normalize, sep } from 'path'
import type { ChangeType, ProjectChange } from '@shared/changes'
import { claimOwnWrite } from './ownWrites'

/**
 * Map a changed file path (relative to root) to an entity change, if any.
 * Layout since v0.2.0 is per-board:
 *   project.json
 *   boards/<id>/board.json
 *   boards/<id>/{characters,timeline,colgroups,notes}/<file>.md
 *   boards/<id>/views/<file>.json          ← family trees (v0.6.0)
 */
export function classify(rel: string, type: ChangeType): ProjectChange | null {
  if (rel === 'project.json') return { kind: 'project', id: 'project', type }

  const parts = rel.split(sep)
  // Everything else lives under boards/<boardId>/…
  if (parts[0] !== 'boards' || parts.length < 3) return null
  const boardId = parts[1]
  if (boardId.startsWith('.')) return null

  // boards/<id>/board.json
  if (parts.length === 3 && parts[2] === 'board.json') {
    return { kind: 'board', id: boardId, boardId, type }
  }

  // boards/<id>/<sub>/<file>.{md,json}
  if (parts.length === 4) {
    const sub = parts[2]
    const file = parts[3]
    const stem = (ext: string): string => basename(file, ext)
    if (sub === 'characters' && file.endsWith('.md')) return { kind: 'character', id: stem('.md'), boardId, type }
    if (sub === 'timeline' && file.endsWith('.md')) return { kind: 'timeline', id: stem('.md'), boardId, type }
    if (sub === 'colgroups' && file.endsWith('.md')) return { kind: 'colgroup', id: stem('.md'), boardId, type }
    if (sub === 'notes' && file.endsWith('.md')) return { kind: 'note', id: stem('.md'), boardId, type }
    if (sub === 'views' && file.endsWith('.json')) return { kind: 'view', id: stem('.json'), boardId, type }
  }
  return null
}

/** How long a path must be quiet before it is reported: the write has settled. */
const SETTLE_MS = 200

/** Dot-folders (`.git`, `.zn-story-line-backup-*`, …) are never project content. */
const hidden = (rel: string): boolean => rel.split(sep).some((seg) => seg.startsWith('.') && seg.length > 1)

/**
 * A path that isn't an entity file but sits where whole folders of them live —
 * `boards/<id>` or `boards/<id>/<folder>`. A change there (a folder copied in,
 * deleted or renamed) can add or remove any number of entities at once, which
 * no focused reload can describe, so it is reported as its board going away:
 * `planReload` turns that into a full reload, which reads the board afresh if
 * it is in fact still there. Returns the board id, or null.
 */
function folderBoard(rel: string): string | null {
  const parts = rel.split(sep)
  return parts[0] === 'boards' && (parts.length === 2 || parts.length === 3) && !parts[1].startsWith('.')
    ? parts[1]
    : null
}

/**
 * Watches a project folder and reports which entity changed, so the renderer
 * can live-reload just that slice (Decisions log: watch + live-reload).
 *
 * One native recursive watch for the whole tree (#190). It replaced chokidar,
 * which on Windows opened a handle per *file* — ~6 s of main-process CPU to open
 * a 3,000-card project — and re-listed a folder after changes, stalling the
 * writes queued behind it. Native events only say "something happened to this
 * path", so each path is reported once it has been quiet for `SETTLE_MS` (as
 * chokidar's `awaitWriteFinish` did), with a `stat` deciding add/change/unlink.
 */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  /** Paths (relative to root) waiting to settle, and whether any event for one was a create/delete/rename. */
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; renamed: boolean }>()
  private markReady: () => void = () => {}
  /**
   * Settles once the watch is in place. With a native recursive watch there is
   * no crawl, so that is as soon as `start` returns; kept as a promise so the
   * benchmark (#185) can tell, and so a slower watcher could slot in later.
   */
  readonly ready = new Promise<void>((resolve) => (this.markReady = resolve))

  constructor(
    private readonly root: string,
    private readonly onChange: (change: ProjectChange) => void
  ) {}

  start(): void {
    if (this.watcher) return
    try {
      this.watcher = watch(this.root, { recursive: true }, (event, filename) => {
        if (filename) this.queue(normalize(filename.toString()), event === 'rename')
      })
      // Google Drive's virtual filesystem on Windows can reject watch calls
      // transiently. Swallow it — the app still works; live-reload just misses
      // that event.
      this.watcher.on('error', (err) => console.warn('[watcher] fs.watch error (ignored):', err.message))
    } catch (err) {
      console.warn('[watcher] could not watch project (live-reload off):', (err as Error).message)
    }
    this.markReady()
  }

  async stop(): Promise<void> {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    if (!this.watcher) return
    this.watcher.close()
    this.watcher = null
  }

  /** (Re)start a path's quiet period. */
  private queue(rel: string, renamed: boolean): void {
    if (!rel || rel === '.' || hidden(rel)) return
    const prior = this.pending.get(rel)
    if (prior) clearTimeout(prior.timer)
    const timer = setTimeout(() => {
      this.pending.delete(rel)
      void this.settle(rel, renamed || Boolean(prior?.renamed))
    }, SETTLE_MS)
    this.pending.set(rel, { timer, renamed: renamed || Boolean(prior?.renamed) })
  }

  /** The path has been quiet: work out what happened to it and report that. */
  private async settle(rel: string, renamed: boolean): Promise<void> {
    if (!this.watcher) return // stopped meanwhile
    const path = join(this.root, rel)
    let type: ChangeType
    let isDir = false
    let mtimeMs: number | undefined
    try {
      const st = await stat(path)
      isDir = st.isDirectory()
      mtimeMs = st.mtimeMs
      type = renamed ? 'add' : 'change'
    } catch {
      type = 'unlink'
    }

    if (!isDir) {
      // A write the app just made returns a fresh snapshot already; claim it and
      // skip the redundant reload this event would otherwise trigger (#130) —
      // unless the file has changed again since (its mtime moved), which means
      // an external edit landed inside the same quiet period.
      if (type !== 'unlink' && claimOwnWrite(path, mtimeMs)) return
      const change = classify(rel, type)
      if (change) return this.onChange(change)
    }
    const boardId = folderBoard(rel)
    if (boardId) this.onChange({ kind: 'board', id: boardId, boardId, type: 'unlink' })
  }
}
