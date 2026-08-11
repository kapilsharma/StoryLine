import chokidar, { type FSWatcher } from 'chokidar'
import { basename, relative, sep } from 'path'
import type { ChangeType, ProjectChange } from '@shared/changes'

/**
 * Watches a project folder and reports which entity changed, so the renderer
 * can live-reload just that slice (Decisions log: chokidar watch + live-reload).
 */

/**
 * Map a changed file path (relative to root) to an entity change, if any.
 * Layout since v0.2.0 is per-board:
 *   project.json
 *   boards/<id>/board.json
 *   boards/<id>/{characters,timeline,notes}/<file>.md
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
    return { kind: 'board', id: boardId, type }
  }

  // boards/<id>/<sub>/<file>.{md,json}
  if (parts.length === 4) {
    const sub = parts[2]
    const file = parts[3]
    if (sub === 'characters' && file.endsWith('.md')) return { kind: 'character', id: basename(file, '.md'), type }
    if (sub === 'timeline' && file.endsWith('.md')) return { kind: 'timeline', id: basename(file, '.md'), type }
    if (sub === 'notes' && file.endsWith('.md')) return { kind: 'note', id: basename(file, '.md'), type }
    if (sub === 'views' && file.endsWith('.json')) return { kind: 'view', id: basename(file, '.json'), type }
  }
  return null
}

export class ProjectWatcher {
  private watcher: FSWatcher | null = null

  constructor(
    private readonly root: string,
    private readonly onChange: (change: ProjectChange) => void
  ) {}

  start(): void {
    if (this.watcher) return
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      // Avoid firing mid-write; wait for the file to settle.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      // Ignore dot-folders (.git, .zn-story-line-backup-*, etc.).
      ignored: (path: string) => path.split(sep).some((seg) => seg.startsWith('.') && seg.length > 1)
    })

    const emit = (type: ChangeType) => (path: string) => {
      const change = classify(relative(this.root, path), type)
      if (change) this.onChange(change)
    }

    this.watcher
      .on('add', emit('add'))
      .on('change', emit('change'))
      .on('unlink', emit('unlink'))
  }

  async stop(): Promise<void> {
    if (!this.watcher) return
    await this.watcher.close()
    this.watcher = null
  }
}
