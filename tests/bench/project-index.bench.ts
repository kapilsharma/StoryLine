import { it, vi } from 'vitest'
import { replyReader } from '../replies'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Note } from '@shared/types'
import type { ProjectSnapshot } from '@shared/ipc'
import { countReads } from '../read-counter'

/**
 * Per-edit cost benchmark for the project index (#184, #185).
 *
 * Drives the real IPC handlers (as the ipc-*.test.ts suites do, with `electron`
 * mocked) over projects of growing size and reports, per scenario: open time,
 * median time of an autosave (`note:save`), a card move (`card:update`) and a
 * card create (`card:create`), how many project files each of those reads, and
 * the size of what it sends back to the renderer (and the time to structured-clone
 * it, which Electron's IPC does on each side). `watchReadyMs` is how long
 * after the open starts the file watcher finishes its first crawl.
 *
 *   npm run bench:index
 *
 * Environment:
 *   BENCH_PROJECT   a real project to start from. It is COPIED to a temp folder
 *                   first — the original is never opened or written. Without it
 *                   a synthetic project is generated.
 *   BENCH_CARDS     comma-separated card totals to pad up to (default 0,1000,3000;
 *                   0 = the project as it is).
 *   BENCH_CHAPTERS  ~10k-word chapter notes added per scenario (default 40).
 *   BENCH_RUNS      timed runs per operation (default 9).
 *   BENCH_OUT       optional path to also write the results as JSON.
 *
 * Kept out of `npm test` (own config: vitest.bench.config.ts) — it is slow, and a
 * timing is a measurement, not a pass/fail.
 */

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...a: unknown[]) => unknown>() }))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  app: { getPath: () => require('os').tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: class {}
}))

import { registerIpc, watcherReady } from '@main/ipc'
import { createProject } from '@main/projectService'

const window = { isDestroyed: () => false, webContents: { send: (): void => {} } }

/** Handlers reply with patches (#188); follow them as the store does. */
const asSnapshot = replyReader()
const invoke = <T = ProjectSnapshot>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(fn({}, ...args) as T).then(asSnapshot)
}

const env = (name: string, fallback: string): string => process.env[name] || fallback
const CARD_TOTALS = env('BENCH_CARDS', '0,1000,3000').split(',').map(Number)
const CHAPTERS = Number(env('BENCH_CHAPTERS', '40'))
const RUNS = Number(env('BENCH_RUNS', '9'))

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

/** A small stand-in project when no real one is given: 1 board, 20 rows, 60 columns, 40 cards. */
async function synthesize(dir: string): Promise<void> {
  await createProject(dir)
  const board = join(dir, 'boards', 'main')
  const write = (path: string, text: string): Promise<void> => fs.writeFile(join(board, path), text)
  const rows = Array.from({ length: 20 }, (_, i) => `char-${i}`)
  const cols = Array.from({ length: 60 }, (_, i) => `ch-${i}`)
  await Promise.all(rows.map((id, i) => write(`characters/${id}.md`, `---\nid: ${id}\ntype: character\nname: Character ${i}\n---\n`)))
  await Promise.all(cols.map((id, i) => write(`timeline/${id}.md`, `---\nid: ${id}\nlabel: Chapter ${i}\norder: ${i}\n---\n`)))
  const cards = []
  for (let i = 0; i < 40; i++) {
    const uid = `n_s${i.toString(16).padStart(7, '0')}`
    await write(`notes/scene-${i}.md`, `---\nuid: ${uid}\ntitle: Scene ${i}\nboards:\n  - main\n---\nWhat happens in scene ${i}.\n`)
    cards.push({ id: `card-s${i}`, noteUid: uid, rowId: rows[i % rows.length], colStart: cols[i % cols.length], colEnd: cols[i % cols.length] })
  }
  const boardJson = join(board, 'board.json')
  const b = JSON.parse(await fs.readFile(boardJson, 'utf8'))
  await fs.writeFile(boardJson, JSON.stringify({ ...b, cards, members: rows, rowOrder: rows }, null, 2))
}

/** The first board's id, read from disk. */
async function firstBoard(dir: string): Promise<string> {
  const project = JSON.parse(await fs.readFile(join(dir, 'project.json'), 'utf8'))
  return project.boards[0]
}

/** Pad the first board up to `total` cards (copies of its notes) and add `chapters` long notes. */
async function grow(dir: string, total: number, chapters: number): Promise<void> {
  const boardId = await firstBoard(dir)
  const notes = join(dir, 'boards', boardId, 'notes')
  const boardJson = join(dir, 'boards', boardId, 'board.json')
  const board = JSON.parse(await fs.readFile(boardJson, 'utf8'))
  const files = (await fs.readdir(notes)).filter((f) => f.endsWith('.md'))
  const template = board.cards[0]
  for (let i = 0; board.cards.length < total; i++) {
    const src = await fs.readFile(join(notes, files[i % files.length]), 'utf8')
    const uid = `n_x${i.toString(16).padStart(7, '0')}`
    await fs.writeFile(join(notes, `bench-dup-${i}.md`), src.replace(/^uid: .*$/m, `uid: ${uid}`))
    board.cards.push({ ...template, id: `card-x${i}`, noteUid: uid })
  }
  const para = 'She walked the long corridor again, counting the doors, and wondered what the council had meant by alignment. '
  const body = Array.from({ length: 500 }, () => para).join('\n\n') // ≈ 10k words
  for (let i = 0; i < chapters; i++) {
    const uid = `n_c${i.toString(16).padStart(7, '0')}`
    await fs.writeFile(join(notes, `bench-chapter-${i}.md`), `---\nuid: ${uid}\ntitle: Chapter ${i}\nboards:\n  - ${boardId}\n---\n${body}\n`)
    board.cards.push({ ...template, id: `card-c${i}`, noteUid: uid })
  }
  await fs.writeFile(boardJson, JSON.stringify(board, null, 2))
}

/**
 * With BENCH_PROFILE=<folder>, a V8 CPU profile of each scenario's timed edits is
 * written there (open it in Chrome DevTools → Performance, or VS Code).
 */
async function startProfile(): Promise<{ stop: (file: string) => Promise<void> } | null> {
  if (!process.env.BENCH_PROFILE) return null
  const { Session } = await import('inspector/promises')
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.start')
  return {
    stop: async (file) => {
      const { profile } = await session.post('Profiler.stop')
      await fs.mkdir(process.env.BENCH_PROFILE!, { recursive: true })
      await fs.writeFile(file, JSON.stringify(profile))
      session.disconnect()
    }
  }
}

interface Row {
  scenario: string
  cards: number
  openMs: number
  watchReadyMs: number
  noteSaveMs: number
  cardMoveMs: number
  cardCreateMs: number
  noteSaveReads: number
  cardMoveReads: number
  responseKB: number
  cloneMs: number
}

it('measures per-edit cost by project size', { timeout: 30 * 60_000 }, async () => {
  const base = await fs.mkdtemp(join(tmpdir(), 'zn-bench-'))
  const rows: Row[] = []
  try {
    for (const total of CARD_TOTALS) {
      const dir = join(base, `p-${total}`)
      if (process.env.BENCH_PROJECT) await fs.cp(process.env.BENCH_PROJECT, dir, { recursive: true })
      else await synthesize(dir)
      await grow(dir, total, CHAPTERS)

      handlers.clear()
      registerIpc(window as never)
      let snap!: ProjectSnapshot
      const openMs = await time(async () => (snap = await invoke('project:open', dir)))
      // Opening also starts the file watcher, whose first crawl of the folder runs
      // in this same process. Time it on its own, and let it finish, so the edits
      // below are timed in the steady state a writer works in, not against it.
      const watchReadyMs = openMs + (await time(() => watcherReady()))
      const boardId = snap.boards[0].board.id
      const cards = snap.boards[0].board.cards.length
      // A mid-board note and card, so nothing benefits from being first or last.
      const card = snap.boards[0].board.cards[cards >> 1]
      const meta = snap.boards[0].notes.find((n) => n.uid === card.noteUid)!
      const note = await invoke<Note>('note:get', dir, boardId, meta.id)
      const cols = snap.boards[0].timeline.map((t) => t.id)

      const saves: number[] = []
      const moves: number[] = []
      const creates: number[] = []
      const profiler = await startProfile()
      // One kind of edit at a time, creates last: a new file makes the watcher
      // re-crawl its whole folder, and that would otherwise be billed to whatever
      // edit happened to come next.
      for (let i = 0; i < RUNS; i++) {
        saves.push(await time(() => invoke('note:save', dir, boardId, { ...note, body: `${note.body}\nEdit ${i}.` })))
      }
      for (let i = 0; i < RUNS; i++) {
        const col = cols[i % cols.length] ?? card.colStart
        moves.push(await time(() => invoke('card:update', dir, boardId, { ...card, colStart: col, colEnd: col })))
      }
      for (let i = 0; i < RUNS; i++) {
        creates.push(
          await time(() =>
            invoke('card:create', dir, { boardId, title: `Bench ${i}`, rowId: card.rowId, colStart: card.colStart, colEnd: card.colEnd })
          )
        )
      }
      await profiler?.stop(`${process.env.BENCH_PROFILE}/edits-${total}.cpuprofile`)
      // Raw, so the reply is measured as it crosses the IPC — then followed like any other.
      const save = await countReads(dir, () =>
        Promise.resolve(handlers.get('note:save')!({}, dir, boardId, { ...note, body: `${note.body}\nCounted.` }))
      )
      asSnapshot(save.result)
      const move = await countReads(dir, () => invoke('card:update', dir, boardId, card))

      rows.push({
        scenario: total === 0 ? 'as-is' : `${total} cards`,
        cards,
        openMs: Math.round(openMs),
        watchReadyMs: Math.round(watchReadyMs),
        noteSaveMs: Math.round(median(saves)),
        cardMoveMs: Math.round(median(moves)),
        cardCreateMs: Math.round(median(creates)),
        noteSaveReads: save.reads.length,
        cardMoveReads: move.reads.length,
        responseKB: Math.round((JSON.stringify(save.result).length / 1024) * 10) / 10,
        // Electron sends an IPC reply by structured clone; this is that cost on one side.
        cloneMs: Math.round(median(Array.from({ length: RUNS }, () => {
          const t = performance.now()
          structuredClone(save.result)
          return performance.now() - t
        })))
      })
    }
  } finally {
    await fs.rm(base, { recursive: true, force: true }).catch(() => {})
  }

  // Straight to stdout: Vitest buffers console output from passing tests.
  const head = `project: ${process.env.BENCH_PROJECT ?? '(synthetic)'}  chapters/scenario: ${CHAPTERS}  runs: ${RUNS}`
  const cols = Object.keys(rows[0]) as (keyof Row)[]
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)))
  const line = (cells: string[]): string => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  process.stdout.write(`\n${head}\n${line(cols)}\n${rows.map((r) => line(cols.map((c) => String(r[c])))).join('\n')}\n\n`)
  if (process.env.BENCH_OUT) await fs.writeFile(process.env.BENCH_OUT, JSON.stringify(rows, null, 2))
})
