import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { replyReader } from '../replies'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ProjectSnapshot } from '@shared/ipc'

/**
 * Exercises the real board IPC handler bodies (registerIpc) against an on-disk
 * temp project. `electron` is mocked so `ipcMain.handle` just captures the
 * handlers into a registry we can invoke directly.
 */

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...a: unknown[]) => unknown>() }))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  app: { getPath: () => require('os').tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: class {
    isDestroyed(): boolean {
      return false
    }
    webContents = { send: (): void => {} }
  }
}))

import { registerIpc } from '@main/ipc'
import { createProject } from '@main/projectService'

let root: string

/** Handlers reply with patches (#188); follow them as the store does. */
const asSnapshot = replyReader()
const invoke = <T = ProjectSnapshot>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(fn({}, ...args) as T).then(asSnapshot)
}
const ids = (snap: ProjectSnapshot): string[] => snap.boards.map((b) => b.board.id)

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-ipc-'))
  await createProject(root) // scaffolds project.boards = ['main']
  handlers.clear()
  registerIpc({} as never)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('board IPC handlers', () => {
  it('board:create appends the new board to the order', async () => {
    const snap = await invoke('board:create', root, 'Second Board')
    expect(snap.project.boards).toEqual(['main', 'second-board'])
    expect(ids(snap)).toEqual(['main', 'second-board'])
  })

  it('board:reorder persists the requested order (tab strip + dropdown follow it)', async () => {
    await invoke('board:create', root, 'Second Board')
    const snap = await invoke('board:reorder', root, ['second-board', 'main'])
    expect(snap.project.boards).toEqual(['second-board', 'main'])
    expect(ids(snap)).toEqual(['second-board', 'main'])
  })

  it('board:reorder drops unknown ids and appends any it was not given', async () => {
    await invoke('board:create', root, 'Second Board')
    // 'ghost' is unknown (filtered); 'main' omitted (appended after the listed ones).
    const snap = await invoke('board:reorder', root, ['second-board', 'ghost'])
    expect(snap.project.boards).toEqual(['second-board', 'main'])
  })

  it('board:delete removes the board from the order and disk', async () => {
    await invoke('board:create', root, 'Second Board')
    const snap = await invoke('board:delete', root, 'second-board')
    expect(snap.project.boards).toEqual(['main'])
    expect(ids(snap)).toEqual(['main'])
    await expect(fs.access(join(root, 'boards', 'second-board'))).rejects.toBeTruthy()
  })
})

describe('card:create on the Manuscript row (#204)', () => {
  it('names the note manuscript-… and stores the cell it belongs to', async () => {
    const snap = await invoke('card:create', root, {
      boardId: 'main',
      title: 'Chapter 3',
      rowId: '@manuscript',
      colStart: 's1',
      colEnd: 's4',
      cell: { kind: 'node', id: 'ch-3' }
    })
    const main = snap.boards.find((b) => b.board.id === 'main')!
    const card = main.board.cards.at(-1)!
    expect(card).toMatchObject({ rowId: '@manuscript', cell: { kind: 'node', id: 'ch-3' } })
    const note = main.notes.find((n) => n.uid === card.noteUid)!
    expect(note.id).toBe('manuscript-chapter-3')
    expect(note.title).toBe('Chapter 3')
  })

  it('leaves an ordinary card without a cell or a prefix', async () => {
    const snap = await invoke('card:create', root, {
      boardId: 'main',
      title: 'Chapter 3',
      rowId: 'someone',
      colStart: 's1',
      colEnd: 's1'
    })
    const main = snap.boards.find((b) => b.board.id === 'main')!
    const card = main.board.cards.at(-1)!
    expect('cell' in card).toBe(false)
    expect(main.notes.find((n) => n.uid === card.noteUid)!.id).toBe('chapter-3')
  })
})

describe('deleting columns under the Manuscript row (#204)', () => {
  /** Chapter 1 (s1, s2) with its manuscript card, stored over s1–s2, beside a scene card on s1. */
  async function seed(): Promise<void> {
    const repo = await import('@main/data/repository')
    await repo.writeColumnGroup(root, 'main', { id: 'ch-1', type: 'colgroup', label: 'Chapter 1', order: 1 })
    await repo.writeTimelineUnit(root, 'main', { id: 's1', label: 'Scene 1', order: 1, parent: 'ch-1' })
    await repo.writeTimelineUnit(root, 'main', { id: 's2', label: 'Scene 2', order: 2, parent: 'ch-1' })
    const { value: board, mtimeMs } = await repo.readBoard(root, 'main')
    await repo.writeBoard(
      root,
      {
        ...board,
        cards: [
          { id: 'k1', noteUid: 'n_k1', rowId: 'someone', colStart: 's1', colEnd: 's1' },
          {
            id: 'm1',
            noteUid: 'n_m1',
            rowId: '@manuscript',
            colStart: 's1',
            colEnd: 's2',
            cell: { kind: 'node', id: 'ch-1' }
          }
        ]
      },
      mtimeMs
    )
  }
  const cardIds = (snap: ProjectSnapshot): string[] =>
    snap.boards.find((b) => b.board.id === 'main')!.board.cards.map((c) => c.id)

  it('keeps a chapter’s prose when the scene it started on is deleted', async () => {
    await seed()
    const snap = await invoke('timeline:delete', root, 'main', 's1')
    expect(cardIds(snap)).toEqual(['m1'])
  })

  it('removes it along with its chapter', async () => {
    await seed()
    const snap = await invoke('colgroup:delete', root, 'main', 'ch-1')
    expect(cardIds(snap)).toEqual([])
  })
})
