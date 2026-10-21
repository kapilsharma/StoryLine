import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { replyReader } from '../replies'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ProjectSnapshot, SnapshotReply } from '@shared/ipc'
import type { Character, Note } from '@shared/types'
import { countReads } from '../read-counter'

/**
 * The in-memory project index (#184 / #186 / #187 / #189).
 *
 * The one rule: after any handler, the snapshot the app hands the renderer must be
 * exactly what reading the project from disk gives — the index is a cache, never a
 * second source of truth. So the first suite drives the real handlers through a
 * long run of edits and compares every reply against a fresh `loadSnapshot`.
 */

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...a: unknown[]) => unknown>() }))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  app: { getPath: () => require('os').tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: class {}
}))

import { registerIpc } from '@main/ipc'
import { loadSnapshot } from '@main/projectService'
import { indexSnapshot, openIndex } from '@main/projectIndex'

let root: string
const BOARD = 'family'

/** Handlers reply with patches (#188); follow them as the store does. */
const asSnapshot = replyReader()
const invoke = <T = ProjectSnapshot>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(fn({}, ...args) as T).then(asSnapshot)
}

/** A handler's reply exactly as the renderer receives it — for asserting on the reply itself. */
const raw = (channel: string, ...args: unknown[]): Promise<SnapshotReply> =>
  Promise.resolve(handlers.get(channel)!({}, ...args) as SnapshotReply)

/** The reply must equal the project as it now is on disk. */
async function inSync(reply: Promise<ProjectSnapshot>): Promise<ProjectSnapshot> {
  const snapshot = await reply
  expect(snapshot).toEqual(await loadSnapshot(root))
  return snapshot
}

const board = (s: ProjectSnapshot, id = BOARD) => s.boards.find((b) => b.board.id === id)!
const noteFile = (id: string): string => join(root, 'boards', BOARD, 'notes', `${id}.md`)
const noteText = (uid: string, title: string, body = 'Body.'): string =>
  `---\nuid: ${uid}\ntitle: ${title}\nboards:\n  - ${BOARD}\n---\n${body}\n`

beforeEach(async () => {
  root = join(await fs.mkdtemp(join(tmpdir(), 'zn-index-')), 'ashvale')
  await fs.cp(join(__dirname, '../fixtures/ashvale-family'), root, { recursive: true })
  const timeline = join(root, 'boards', BOARD, 'timeline')
  await fs.mkdir(timeline, { recursive: true })
  for (const n of [1, 2, 3]) {
    await fs.writeFile(join(timeline, `ch${n}.md`), `---\nid: ch${n}\nlabel: Chapter ${n}\norder: ${n}\n---\n\n`)
  }
  // The fixture has no notes yet, and git keeps no empty folder.
  await fs.mkdir(join(root, 'boards', BOARD, 'notes'), { recursive: true })
  handlers.clear()
  registerIpc({ isDestroyed: () => false, webContents: { send: () => {} } } as never)
  // The renderer gets this first reply whole; the reader must see it too.
  asSnapshot(await openIndex(root))
  // Opening stamps `lastOpened` into project.json, which the next update reads
  // back once. Settle that here so read counts below are about the edit alone.
  await indexSnapshot(root)
})

afterEach(async () => {
  await fs.rm(join(root, '..'), { recursive: true, force: true })
})

describe('the index stays equal to disk through every kind of edit', () => {
  // ~40 handler calls, each compared with a full read: slow under a loaded suite.
  it('characters, columns, cards, notes, views, boards and project meta', { timeout: 60_000 }, async () => {
    let s = await indexSnapshot(root)
    const tessa = board(s).characters.find((c) => c.id === 'tessa-ashvale')!

    // Project
    s = await inSync(invoke('project:saveFamilies', root, { ...s.project.families, Ashvale: '#123456' }))

    // Characters: edit, add (onto the board), rename, a body, delete
    s = await inSync(invoke('character:save', root, BOARD, { ...tessa, name: 'Tessa A.' }))
    const newcomer: Character = { ...tessa, id: '', name: 'Aaron Newcomer', father: undefined, mother: undefined }
    s = await inSync(invoke('character:save', root, BOARD, newcomer, true))
    expect(board(s).characters.map((c) => c.id)).toContain('aaron-newcomer')
    s = await inSync(invoke('character:rename', root, BOARD, 'aaron-newcomer', 'Zed Newcomer'))
    s = await inSync(invoke('entity:saveBody', root, BOARD, 'character', 'zed-newcomer', '## Notes\n\nArrives late.\n'))
    s = await inSync(invoke('character:delete', root, BOARD, 'zed-newcomer'))

    // Columns: a new unit, wrap one in a group, an outline, a move, deletes
    s = await inSync(invoke('timeline:save', root, BOARD, { id: '', label: 'Chapter 0', order: 0 }))
    s = await inSync(invoke('colgroup:wrap', root, BOARD, 'ch2', 'Act One', false))
    s = await inSync(
      invoke('columns:addOutline', root, BOARD, [
        { label: 'Act Two', kind: 'node', children: [{ label: 'Chapter 9', kind: 'unit', children: [] }] }
      ])
    )
    s = await inSync(invoke('columns:move', root, BOARD, { kind: 'unit', id: 'ch3' }, null, 0))
    s = await inSync(invoke('timeline:delete', root, BOARD, 'ch1'))
    const act = board(s).colGroups.find((g) => g.label === 'Act Two')!
    s = await inSync(invoke('colgroup:delete', root, BOARD, act.id))

    // Cards and their notes
    s = await inSync(
      invoke('card:create', root, { boardId: BOARD, title: 'The Reading', rowId: 'tessa-ashvale', colStart: 'ch2', colEnd: 'ch2' })
    )
    const card = board(s).board.cards.at(-1)!
    const meta = board(s).notes.find((n) => n.uid === card.noteUid)!
    const note = await invoke<Note>('note:get', root, BOARD, meta.id)
    s = await inSync(invoke('note:save', root, BOARD, { ...note, body: 'The will is read aloud.', status: 'draft' }))
    s = await inSync(invoke('note:save', root, BOARD, { id: '', title: 'Loose Idea', boards: [BOARD], body: 'Maybe.' }))
    const loose = board(s).notes.find((n) => n.title === 'Loose Idea')!
    s = await inSync(
      invoke('note:save', root, BOARD, {
        ...(await invoke<Note>('note:get', root, BOARD, loose.id)),
        related: [{ file: `${meta.id}.md`, comment: 'follows' }]
      })
    )
    s = await inSync(invoke('note:rename', root, BOARD, meta.id, 'Reading of the Will'))
    expect(board(s).notes.find((n) => n.id === loose.id)!.related?.[0].file).toBe('reading-of-the-will.md')
    s = await inSync(invoke('card:update', root, BOARD, { ...card, colStart: 'ch3', colEnd: 'ch3' }))
    s = await inSync(invoke('card:delete', root, BOARD, card.id))
    s = await inSync(invoke('note:delete', root, BOARD, 'reading-of-the-will'))

    // Family-tree views
    s = await inSync(invoke('view:create', root, BOARD, 'Ashvale Line', 'tessa-ashvale'))
    s = await inSync(invoke('view:create', root, BOARD, 'All Families', null))
    s = await inSync(invoke('view:rename', root, BOARD, 'ashvale-line', 'The Ashvales'))
    s = await inSync(invoke('view:reorder', root, BOARD, [...board(s).board.views].reverse()))
    s = await inSync(invoke('view:delete', root, BOARD, 'all-families'))

    // Boards — added and removed, which the index rebuilds for
    s = await inSync(invoke('board:create', root, 'Second'))
    s = await inSync(invoke('board:rename', root, 'second', 'Second Board'))
    s = await inSync(invoke('board:reorder', root, ['second', BOARD]))
    s = await inSync(invoke('board:delete', root, 'second'))
    expect(s.boards.map((b) => b.board.id)).toEqual([BOARD])
  })
})

describe('an edit reads only what it wrote', () => {
  it('an autosave reads back just its own note', async () => {
    const { id } = (await invoke<ProjectSnapshot>('note:save', root, BOARD, { id: '', title: 'Scene', boards: [BOARD], body: 'x' })).boards[0].notes[0]
    const note = await invoke<Note>('note:get', root, BOARD, id)
    const { reads } = await countReads(root, () => invoke('note:save', root, BOARD, { ...note, body: 'Longer now.' }))
    expect(reads).toEqual([`boards/${BOARD}/notes/${id}.md`])
  })

  it('a card move reads only the board file', async () => {
    const s = await invoke('card:create', root, { boardId: BOARD, title: 'Move Me', rowId: 'tessa-ashvale', colStart: 'ch1', colEnd: 'ch1' })
    const card = board(s).board.cards.at(-1)!
    const { reads } = await countReads(root, () => invoke('card:update', root, BOARD, { ...card, colStart: 'ch2', colEnd: 'ch2' }))
    // Once by the handler (it needs the board and its mtime), once into the index.
    expect(new Set(reads)).toEqual(new Set([`boards/${BOARD}/board.json`]))
  })

  it('a new card does not list the notes to pick its id', async () => {
    const { reads } = await countReads(root, () =>
      invoke('card:create', root, { boardId: BOARD, title: 'Fresh', rowId: 'tessa-ashvale', colStart: 'ch1', colEnd: 'ch1' })
    )
    expect(new Set(reads)).toEqual(new Set([`boards/${BOARD}/board.json`, `boards/${BOARD}/notes/fresh.md`]))
  })
})

describe('replies carry what changed, not the project (#188)', () => {
  it('an autosave replies with just its note', async () => {
    const s = await invoke('card:create', root, { boardId: BOARD, title: 'Small', rowId: 'tessa-ashvale', colStart: 'ch1', colEnd: 'ch1' })
    const id = board(s).notes.find((n) => n.title === 'Small')!.id
    const note = await invoke<Note>('note:get', root, BOARD, id)
    const reply = await raw('note:save', root, BOARD, { ...note, body: 'Typed some more.' })
    expect(reply).toMatchObject({ kind: 'patch', patch: { ops: [{ target: 'note', id }] } })
    expect(asSnapshot(reply)).toEqual(await loadSnapshot(root))
  })

  it('a full reload replies with the whole project', async () => {
    const reply = await raw('project:reload', root)
    expect(reply.kind).toBe('snapshot')
    asSnapshot(reply)
  })
})

describe('new ids never overwrite a file the index has not seen yet', () => {
  it('skips an id taken by a note added outside the app moments ago', async () => {
    // Written behind the index's back, before the watcher has reported it.
    await fs.writeFile(noteFile('scene'), noteText('n_outside1', 'Scene', 'Written in Obsidian.'))
    const s = await invoke('card:create', root, { boardId: BOARD, title: 'Scene', rowId: 'tessa-ashvale', colStart: 'ch1', colEnd: 'ch1' })
    expect(board(s).notes.some((n) => n.id === 'scene-2')).toBe(true)
    expect(await fs.readFile(noteFile('scene'), 'utf8')).toContain('Written in Obsidian.')
  })
})

describe('external edits (#189)', () => {
  it('a watcher-reported change is patched in and returned for the renderer', async () => {
    await fs.writeFile(noteFile('outside'), noteText('n_outside2', 'From Outside'))
    const reply = await raw('project:reloadChanges', root, [{ kind: 'note', id: 'outside', boardId: BOARD, type: 'add' }])
    // Just the one note goes back to the renderer (#188), and its copy then equals disk.
    expect(reply).toMatchObject({
      kind: 'patch',
      patch: { ops: expect.arrayContaining([expect.objectContaining({ target: 'note', id: 'outside' })]) }
    })
    expect(asSnapshot(reply)).toEqual(await loadSnapshot(root))
    expect(await indexSnapshot(root)).toEqual(await loadSnapshot(root))
  })

  it('keeps a note whose file is caught empty mid-sync, then takes the real content', async () => {
    await invoke('note:save', root, BOARD, { id: 'synced', uid: 'n_sync0001', title: 'Synced', boards: [BOARD], body: 'Original.' })
    const change = { kind: 'note' as const, id: 'synced', boardId: BOARD, type: 'change' as const }

    await fs.writeFile(noteFile('synced'), '') // Drive truncates before it writes
    const skipped = await raw('project:reloadChanges', root, [change])
    expect(skipped).toMatchObject({ kind: 'patch', patch: { ops: [] } })
    asSnapshot(skipped)
    expect(board(await indexSnapshot(root)).notes.find((n) => n.id === 'synced')?.title).toBe('Synced')

    await fs.writeFile(noteFile('synced'), noteText('n_sync0001', 'Synced Again'))
    await invoke('project:reloadChanges', root, [change])
    expect(board(await indexSnapshot(root)).notes.find((n) => n.id === 'synced')?.title).toBe('Synced Again')
  })

  it('takes a brand-new empty file as it is', async () => {
    await fs.writeFile(noteFile('blank'), '')
    await invoke('project:reloadChanges', root, [{ kind: 'note', id: 'blank', boardId: BOARD, type: 'add' }])
    expect(await indexSnapshot(root)).toEqual(await loadSnapshot(root))
  })

  it('a removal drops the entity', async () => {
    await fs.rm(join(root, 'boards', BOARD, 'characters', 'tessa-ashvale.md'))
    await invoke('project:reloadChanges', root, [{ kind: 'character', id: 'tessa-ashvale', boardId: BOARD, type: 'unlink' }])
    expect(board(await indexSnapshot(root)).characters.some((c) => c.id === 'tessa-ashvale')).toBe(false)
  })

  it('a full reload reads the project afresh, picking up what the index never heard about', async () => {
    await fs.writeFile(noteFile('unheard'), noteText('n_unheard1', 'Unheard'))
    await inSync(invoke('project:reload', root))
  })
})

describe('serialised updates', () => {
  it('concurrent edits all land, and the last reply has every one of them', async () => {
    const s = await invoke('card:create', root, { boardId: BOARD, title: 'Base', rowId: 'tessa-ashvale', colStart: 'ch1', colEnd: 'ch1' })
    const id = board(s).notes.find((n) => n.title === 'Base')!.id
    const note = await invoke<Note>('note:get', root, BOARD, id)
    const replies = await Promise.all([
      invoke('note:save', root, BOARD, { ...note, body: 'One.' }),
      invoke('note:save', root, BOARD, { id: '', title: 'Second', boards: [BOARD], body: 'Two.' }),
      invoke('note:save', root, BOARD, { id: '', title: 'Third', boards: [BOARD], body: 'Three.' })
    ])
    const titles = board(replies[2]).notes.map((n) => n.title)
    expect(titles).toEqual(expect.arrayContaining(['Base', 'Second', 'Third']))
    expect(await indexSnapshot(root)).toEqual(await loadSnapshot(root))
  })
})

describe('another root', () => {
  it('a handler on a project other than the held one reads that project', async () => {
    const other = join(root, '..', 'other')
    await fs.cp(root, other, { recursive: true })
    await fs.writeFile(join(other, 'boards', BOARD, 'notes', 'only-here.md'), noteText('n_onlyhere', 'Only Here'))
    const s = await invoke('project:saveFamilies', other, {})
    expect(board(s).notes.some((n) => n.id === 'only-here')).toBe(true)
    expect(s).toEqual(await loadSnapshot(other))
  })
})
