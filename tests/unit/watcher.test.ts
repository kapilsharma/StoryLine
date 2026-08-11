import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { classify, ProjectWatcher } from '@main/data/watcher'
import type { ProjectChange } from '@shared/changes'

/** Build a relative path with the OS separator. */
const p = (...segs: string[]): string => segs.join(sep)

describe('watcher classify (per-board layout since v0.2.0)', () => {
  it('classifies project.json', () => {
    expect(classify('project.json', 'change')).toEqual({ kind: 'project', id: 'project', type: 'change' })
  })

  it('classifies a board file', () => {
    expect(classify(p('boards', 'main', 'board.json'), 'change')).toEqual({
      kind: 'board',
      id: 'main',
      type: 'change'
    })
  })

  it('classifies per-board notes / characters / timeline', () => {
    expect(classify(p('boards', 'main', 'notes', 'experiment-mage.md'), 'add')).toEqual({
      kind: 'note',
      id: 'experiment-mage',
      type: 'add'
    })
    expect(classify(p('boards', 'main', 'characters', 'wolf.md'), 'unlink')).toMatchObject({
      kind: 'character',
      id: 'wolf'
    })
    expect(classify(p('boards', 'b2', 'timeline', 'ch1.md'), 'change')).toMatchObject({
      kind: 'timeline',
      id: 'ch1'
    })
  })

  it('classifies a family-tree view file (v0.6.0)', () => {
    expect(classify(p('boards', 'main', 'views', 'ashvale-side.json'), 'change')).toEqual({
      kind: 'view',
      id: 'ashvale-side',
      type: 'change'
    })
    // Views are JSON, not markdown — the wrong extension is not a view.
    expect(classify(p('boards', 'main', 'views', 'notes.md'), 'change')).toBeNull()
  })

  it('ignores backup folders and unrelated paths', () => {
    expect(classify(p('.zn-story-line-backup-v2', 'boards', 'main', 'notes', 'x.md'), 'add')).toBeNull()
    expect(classify(p('boards', '.hidden', 'board.json'), 'add')).toBeNull()
    expect(classify(p('boards', 'main'), 'add')).toBeNull()
    expect(classify('random.txt', 'add')).toBeNull()
  })
})

describe('ProjectWatcher', () => {
  let root: string
  let watcher: ProjectWatcher | null

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-watch-'))
    watcher = null
  })
  afterEach(async () => {
    await watcher?.stop()
    await fs.rm(root, { recursive: true, force: true })
  })

  /** Start a watcher on `root` and resolve with its first change (or reject on timeout). */
  function firstChange(ms = 6000): Promise<ProjectChange> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no change emitted in time')), ms)
      watcher = new ProjectWatcher(root, (change) => {
        clearTimeout(timer)
        resolve(change)
      })
      watcher.start()
    })
  }

  it('emits a classified change when a watched file appears, and ignores dot-folders', async () => {
    const pending = firstChange()
    // Give chokidar a moment to attach before writing.
    await new Promise((r) => setTimeout(r, 300))
    // A write under a dot-folder must be ignored…
    await fs.mkdir(join(root, '.zn-story-line-backup-v1', 'boards', 'main'), { recursive: true })
    await fs.writeFile(join(root, '.zn-story-line-backup-v1', 'boards', 'main', 'board.json'), '{}')
    // …while a real board file produces a 'board' change.
    await fs.mkdir(join(root, 'boards', 'main'), { recursive: true })
    await fs.writeFile(join(root, 'boards', 'main', 'board.json'), '{"id":"main","name":"Main"}')

    const change = await pending
    expect(change).toMatchObject({ kind: 'board', id: 'main' })
  }, 10000)

  it('start() is idempotent and stop() tears down cleanly', async () => {
    watcher = new ProjectWatcher(root, () => {})
    watcher.start()
    watcher.start() // no-op second call
    await watcher.stop()
    await watcher.stop() // safe when already stopped
  })
})
