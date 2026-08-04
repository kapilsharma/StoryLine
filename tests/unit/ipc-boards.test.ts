import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

const invoke = <T = ProjectSnapshot>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(fn({}, ...args) as T)
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
