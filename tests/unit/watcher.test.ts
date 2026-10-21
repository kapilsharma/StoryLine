import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join, sep } from 'path'
import { tmpdir } from 'os'
import { classify, ProjectWatcher } from '@main/data/watcher'
import { writeTextGuarded } from '@main/data/fsutil'
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
      boardId: 'main',
      type: 'change'
    })
  })

  it('classifies per-board notes / characters / timeline, carrying the owning board (#131)', () => {
    expect(classify(p('boards', 'main', 'notes', 'experiment-mage.md'), 'add')).toEqual({
      kind: 'note',
      id: 'experiment-mage',
      boardId: 'main',
      type: 'add'
    })
    expect(classify(p('boards', 'main', 'characters', 'wolf.md'), 'unlink')).toMatchObject({
      kind: 'character',
      id: 'wolf',
      boardId: 'main'
    })
    expect(classify(p('boards', 'b2', 'colgroups', 'part-one.md'), 'change')).toEqual({
      kind: 'colgroup',
      id: 'part-one',
      boardId: 'b2',
      type: 'change'
    })
    expect(classify(p('boards', 'b2', 'timeline', 'ch1.md'), 'change')).toMatchObject({
      kind: 'timeline',
      id: 'ch1',
      boardId: 'b2'
    })
  })

  it('classifies a family-tree view file (v0.6.0)', () => {
    expect(classify(p('boards', 'main', 'views', 'ashvale-side.json'), 'change')).toEqual({
      kind: 'view',
      id: 'ashvale-side',
      boardId: 'main',
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
    // Give the watch a moment to attach before writing.
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

  /** Start a watcher on `root` that collects every change, and wait until it is watching. */
  async function collect(): Promise<ProjectChange[]> {
    const seen: ProjectChange[] = []
    watcher = new ProjectWatcher(root, (change) => seen.push(change))
    watcher.start()
    await watcher.ready
    await new Promise((r) => setTimeout(r, 100))
    return seen
  }

  /** Wait until `seen` holds a change matching `want`, or fail. */
  async function until(seen: ProjectChange[], want: Partial<ProjectChange>, ms = 6000): Promise<void> {
    const end = Date.now() + ms
    while (!seen.some((c) => Object.entries(want).every(([k, v]) => c[k as keyof ProjectChange] === v))) {
      if (Date.now() > end) throw new Error(`no ${JSON.stringify(want)} in ${JSON.stringify(seen)}`)
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  const notes = (): string => join(root, 'boards', 'main', 'notes')

  it('reports a deleted note as an unlink (#190)', async () => {
    await fs.mkdir(notes(), { recursive: true })
    await fs.writeFile(join(notes(), 'gone.md'), 'x')
    const seen = await collect()
    await fs.rm(join(notes(), 'gone.md'))
    await until(seen, { kind: 'note', id: 'gone', type: 'unlink' })
  }, 10000)

  it('reports a burst of writes to one file once, after it settles (#190)', async () => {
    await fs.mkdir(notes(), { recursive: true })
    await fs.writeFile(join(notes(), 'busy.md'), 'v0')
    const seen = await collect()
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(join(notes(), 'busy.md'), `v${i}`)
      await new Promise((r) => setTimeout(r, 20))
    }
    await until(seen, { kind: 'note', id: 'busy' })
    await new Promise((r) => setTimeout(r, 400)) // anything still to come would have come
    expect(seen.filter((c) => c.id === 'busy')).toHaveLength(1)
  }, 10000)

  it('stays quiet about a write the app made itself (#130)', async () => {
    await fs.mkdir(notes(), { recursive: true })
    const seen = await collect()
    await writeTextGuarded(join(notes(), 'mine.md'), 'mine') // tags the path as an own write
    await fs.writeFile(join(notes(), 'theirs.md'), 'theirs')
    await until(seen, { kind: 'note', id: 'theirs' })
    await new Promise((r) => setTimeout(r, 400))
    expect(seen.some((c) => c.id === 'mine')).toBe(false)
  }, 10000)

  it('turns a removed board folder into a board unlink, so the renderer reloads in full (#190)', async () => {
    await fs.mkdir(notes(), { recursive: true })
    await fs.writeFile(join(root, 'boards', 'main', 'board.json'), '{}')
    await fs.writeFile(join(notes(), 'a.md'), 'x')
    const seen = await collect()
    await fs.rm(join(root, 'boards', 'main'), { recursive: true })
    await until(seen, { kind: 'board', id: 'main', type: 'unlink' })
  }, 10000)

  it('is ready as soon as it is watching — there is no crawl', async () => {
    watcher = new ProjectWatcher(root, () => {})
    watcher.start()
    await watcher.ready
  })

  it('start() is idempotent and stop() tears down cleanly', async () => {
    watcher = new ProjectWatcher(root, () => {})
    watcher.start()
    watcher.start() // no-op second call
    await watcher.stop()
    await watcher.stop() // safe when already stopped
  })
})
