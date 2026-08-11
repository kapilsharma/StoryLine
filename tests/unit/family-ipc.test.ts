import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ProjectSnapshot } from '@shared/ipc'
import type { Character, View } from '@shared/types'

/**
 * Exercises the family-tree IPC handler bodies (Issue 29) against an on-disk temp
 * project, the same way `ipc-boards.test.ts` does for boards. `electron` is mocked
 * so `ipcMain.handle` just captures the handlers into a registry.
 *
 * What is worth testing at this level rather than in the pure layers: the
 * cross-file writes. Spouse symmetry, clearing references on delete, retargeting
 * on rename and writing a Children edit onto the *children* all touch several
 * files at once, and each is easy to half-implement in a way no pure test sees.
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
const BID = 'main'

const invoke = <T = ProjectSnapshot>(channel: string, ...args: unknown[]): Promise<T> => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(fn({}, ...args) as T)
}

const board = (snap: ProjectSnapshot) => snap.boards.find((b) => b.board.id === BID)!
const cast = (snap: ProjectSnapshot): Character[] => board(snap).characters
const person = (snap: ProjectSnapshot, id: string): Character | undefined =>
  cast(snap).find((c) => c.id === id)
const views = (snap: ProjectSnapshot): View[] => board(snap).views

/** Create a character and return the snapshot. Off-board, as the Characters tab does. */
const add = (name: string, extra: Partial<Character> = {}): Promise<ProjectSnapshot> =>
  invoke('character:save', root, BID, { id: '', type: 'character', name, colour: '#888888', ...extra })

/** Create a character *on* the board, as the board's "+ Row" does. */
const addOnBoard = (name: string, extra: Partial<Character> = {}): Promise<ProjectSnapshot> =>
  invoke(
    'character:save',
    root,
    BID,
    { id: '', type: 'character', name, colour: '#888888', ...extra },
    true
  )

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-family-ipc-'))
  await createProject(root)
  handlers.clear()
  registerIpc({} as never)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('character:save — spouse symmetry and family colours', () => {
  it('writes the spouse link onto the other person too', async () => {
    await add('Rowan Ashvale')
    await add('Mira Renmoor')
    const snap = await invoke('character:save', root, BID, {
      ...person(await invoke<ProjectSnapshot>('project:reload', root), 'rowan-ashvale')!,
      spouse: ['mira-renmoor']
    })
    expect(person(snap, 'mira-renmoor')?.spouse).toEqual(['rowan-ashvale'])
  })

  it('removes it from the other side when the link is dropped', async () => {
    await add('Rowan Ashvale', { spouse: [] })
    await add('Mira Renmoor')
    const rowan = person(await invoke<ProjectSnapshot>('project:reload', root), 'rowan-ashvale')!
    await invoke('character:save', root, BID, { ...rowan, spouse: ['mira-renmoor'] })
    const snap = await invoke('character:save', root, BID, { ...rowan, spouse: [] })
    expect(person(snap, 'mira-renmoor')?.spouse).toBeUndefined()
  })

  it('persists a colour per family in project.json, stable as people are added', async () => {
    let snap = await add('Rowan Ashvale')
    const ashvale = snap.project.families.Ashvale
    expect(ashvale).toMatch(/^#[0-9A-Fa-f]{6}$/)

    snap = await add('Ines Calder')
    // The existing assignment must not move when a second family appears.
    expect(snap.project.families.Ashvale).toBe(ashvale)
    expect(snap.project.families.Calder).toBeDefined()
    expect(snap.project.families.Calder).not.toBe(ashvale)
  })

  it('leaves families untouched for a cast with no surnames', async () => {
    const snap = await add('Aeri')
    expect(snap.project.families).toEqual({})
  })
})

describe('character:delete', () => {
  it('clears inbound parent and spouse references rather than leaving ghosts', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale', { father: 'edmund-ashvale', spouse: [] })
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    await invoke('character:save', root, BID, {
      ...person(snap, 'edmund-ashvale')!,
      spouse: ['rowan-ashvale']
    })

    snap = await invoke('character:delete', root, BID, 'edmund-ashvale')
    const rowan = person(snap, 'rowan-ashvale')!
    expect(rowan.father).toBeUndefined()
    expect(rowan.spouse).toBeUndefined()
    expect(board(snap).problems).toEqual([])
  })
})

describe('character:rename', () => {
  it('moves the file and retargets every relation pointing at the old id', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale', { father: 'edmund-ashvale' })

    const snap = await invoke('character:rename', root, BID, 'edmund-ashvale', 'Edmond Ashvale')
    expect(person(snap, 'edmund-ashvale')).toBeUndefined()
    expect(person(snap, 'edmond-ashvale')?.name).toBe('Edmond Ashvale')
    expect(person(snap, 'rowan-ashvale')?.father).toBe('edmond-ashvale')
    // No dangling ref means no ghost node on the tree.
    expect(board(snap).problems).toEqual([])
  })

  it('also retargets the board’s own row references', async () => {
    await add('Edmund Ashvale')
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    await invoke('board:save', root, {
      ...board(snap).board,
      rowOrder: ['edmund-ashvale'],
      rowGroupOrder: ['edmund-ashvale'],
      hiddenRows: ['edmund-ashvale']
    })

    snap = await invoke('character:rename', root, BID, 'edmund-ashvale', 'Edmond Ashvale')
    expect(board(snap).board.rowOrder).toEqual(['edmond-ashvale'])
    expect(board(snap).board.rowGroupOrder).toEqual(['edmond-ashvale'])
    expect(board(snap).board.hiddenRows).toEqual(['edmond-ashvale'])
  })

  it('keeps the id when the new name slugs to the same thing', async () => {
    await add('Edmund Ashvale')
    const snap = await invoke('character:rename', root, BID, 'edmund-ashvale', 'Edmund  Ashvale')
    expect(person(snap, 'edmund-ashvale')?.name).toBe('Edmund  Ashvale')
  })
})

describe('character:setChildren', () => {
  it('writes the parent onto the child, never a children key on the parent', async () => {
    await add('Edmund Ashvale', { gender: 'male' })
    await add('Rowan Ashvale')

    const snap = await invoke('character:setChildren', root, BID, 'edmund-ashvale', ['rowan-ashvale'])
    expect(person(snap, 'rowan-ashvale')?.father).toBe('edmund-ashvale')
    const raw = await fs.readFile(join(root, 'boards', BID, 'characters', 'edmund-ashvale.md'), 'utf8')
    expect(raw).not.toContain('children')
  })

  it('uses `mother` for a female parent', async () => {
    await add('Hester Ashvale', { gender: 'female' })
    await add('Rowan Ashvale')
    const snap = await invoke('character:setChildren', root, BID, 'hester-ashvale', ['rowan-ashvale'])
    expect(person(snap, 'rowan-ashvale')?.mother).toBe('hester-ashvale')
  })

  it('clears the parent field of a child removed from the list', async () => {
    await add('Edmund Ashvale', { gender: 'male' })
    await add('Rowan Ashvale')
    await invoke('character:setChildren', root, BID, 'edmund-ashvale', ['rowan-ashvale'])
    const snap = await invoke('character:setChildren', root, BID, 'edmund-ashvale', [])
    expect(person(snap, 'rowan-ashvale')?.father).toBeUndefined()
  })
})

describe('view IPC handlers', () => {
  it('a fresh board has no views, and view:create makes the first', async () => {
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    expect(views(snap)).toEqual([])

    snap = await invoke('view:create', root, BID, 'Everyone', null)
    expect(views(snap).map((v) => v.id)).toEqual(['everyone'])
    expect(board(snap).board.views).toEqual(['everyone'])
    expect(views(snap)[0].root).toBeNull()
  })

  it('stores views under the board, not the project', async () => {
    await invoke('view:create', root, BID, 'Everyone', null)
    const path = join(root, 'boards', BID, 'views', 'everyone.json')
    expect(JSON.parse(await fs.readFile(path, 'utf8')).name).toBe('Everyone')
  })

  it('view:duplicate copies the filters but not the camera or arrangement', async () => {
    await add('Rowan Ashvale')
    await invoke('view:create', root, BID, 'Ashvale side', 'rowan-ashvale')
    let snap = await invoke<ProjectSnapshot>('view:save', root, BID, {
      ...views(await invoke<ProjectSnapshot>('project:reload', root))[0],
      parentDepth: 2,
      childDepth: 0,
      includeSpouseFamilies: false,
      hidden: ['someone'],
      arranged: true,
      overrides: { 'rowan-ashvale': { x: 10, y: 20 } },
      panX: 99,
      panY: 99,
      zoom: 2
    })

    snap = await invoke('view:duplicate', root, BID, 'ashvale-side', 'Calder side')
    const copy = views(snap).find((v) => v.id === 'calder-side')!
    expect(copy.root).toBe('rowan-ashvale')
    expect(copy.parentDepth).toBe(2)
    expect(copy.childDepth).toBe(0)
    expect(copy.includeSpouseFamilies).toBe(false)
    expect(copy.hidden).toEqual(['someone'])
    // A fresh camera and no inherited arrangement — it opens fitted to itself.
    expect(copy.arranged).toBe(false)
    expect(copy.overrides).toEqual({})
    expect({ panX: copy.panX, panY: copy.panY, zoom: copy.zoom }).toEqual({ panX: 0, panY: 0, zoom: 1 })
    // Inserted immediately after its source, not at the end.
    expect(board(snap).board.views).toEqual(['ashvale-side', 'calder-side'])
  })

  it('view:rename changes the label and keeps the id, because ids are references', async () => {
    await invoke('view:create', root, BID, 'Everyone', null)
    const snap = await invoke('view:rename', root, BID, 'everyone', 'The lot')
    expect(views(snap).map((v) => [v.id, v.name])).toEqual([['everyone', 'The lot']])
  })

  it('view:delete removes the file and the tab, leaving the characters alone', async () => {
    await add('Rowan Ashvale')
    await invoke('view:create', root, BID, 'Everyone', null)
    const snap = await invoke('view:delete', root, BID, 'everyone')
    expect(views(snap)).toEqual([])
    expect(board(snap).board.views).toEqual([])
    expect(person(snap, 'rowan-ashvale')).toBeDefined()
    await expect(fs.access(join(root, 'boards', BID, 'views', 'everyone.json'))).rejects.toThrow()
  })

  it('view:reorder drops unknown ids and appends any it was not given', async () => {
    await invoke('view:create', root, BID, 'A', null)
    await invoke('view:create', root, BID, 'B', null)
    const snap = await invoke('view:reorder', root, BID, ['b', 'ghost'])
    expect(board(snap).board.views).toEqual(['b', 'a'])
    expect(views(snap).map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('surfaces a view file added externally rather than hiding it', async () => {
    await invoke('view:create', root, BID, 'Everyone', null)
    await fs.writeFile(
      join(root, 'boards', BID, 'views', 'hand-made.json'),
      JSON.stringify({ name: 'Hand made' })
    )
    const snap = await invoke<ProjectSnapshot>('project:reload', root)
    // Listed views first, then the stragglers — and the partial file is defaulted.
    expect(views(snap).map((v) => v.id)).toEqual(['everyone', 'hand-made'])
    expect(views(snap)[1].showGhosts).toBe(true)
    expect(views(snap)[1].zoom).toBe(1)
  })

  it('project:saveFamilies persists a hand-picked palette', async () => {
    await add('Rowan Ashvale')
    const snap = await invoke('project:saveFamilies', root, { Ashvale: '#123456' })
    expect(snap.project.families).toEqual({ Ashvale: '#123456' })
  })
})

describe('membership (Issue 29, second half)', () => {
  it('a character created off the board does not become a row', async () => {
    const snap = await add('Edmund Ashvale')
    expect(board(snap).board.members).toEqual([])
    expect(person(snap, 'edmund-ashvale')).toBeDefined()
  })

  it('a character created *on* the board does', async () => {
    const snap = await addOnBoard('Aeri')
    expect(board(snap).board.members).toEqual(['aeri'])
  })

  it('editing an existing character never changes membership', async () => {
    await addOnBoard('Aeri')
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    // Even with the flag set, an update is not a create.
    snap = await invoke('character:save', root, BID, { ...person(snap, 'aeri')!, role: 'Lead' }, true)
    expect(board(snap).board.members).toEqual(['aeri'])
  })

  it('view:create seeds members from the filters, so a new tab is not blank', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale', { father: 'edmund-ashvale' })
    const snap = await invoke<ProjectSnapshot>('view:create', root, BID, 'Everyone', null)
    expect(views(snap)[0].members?.sort()).toEqual(['edmund-ashvale', 'rowan-ashvale'])
  })

  it('a seeded tree does not pick up a character added afterwards', async () => {
    await add('Edmund Ashvale')
    await invoke('view:create', root, BID, 'Everyone', null)
    const snap = await add('Someone Else')
    expect(views(snap)[0].members).toEqual(['edmund-ashvale'])
  })

  it('view:create honours the root filter when seeding', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale', { father: 'edmund-ashvale' })
    await add('Unrelated Person')
    const snap = await invoke<ProjectSnapshot>('view:create', root, BID, 'Edmund side', 'edmund-ashvale')
    // Edmund and his child, but not the stranger.
    expect(views(snap)[0].members?.sort()).toEqual(['edmund-ashvale', 'rowan-ashvale'])
  })

  it('view:duplicate copies the members, not just the filters', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale')
    await invoke('view:create', root, BID, 'Everyone', null)
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    await invoke('view:save', root, BID, { ...views(snap)[0], members: ['edmund-ashvale'] })

    snap = await invoke('view:duplicate', root, BID, 'everyone', 'Copy')
    expect(views(snap).find((v) => v.id === 'copy')!.members).toEqual(['edmund-ashvale'])
  })

  it('deleting a character clears them from board and tree membership', async () => {
    await addOnBoard('Edmund Ashvale')
    await invoke('view:create', root, BID, 'Everyone', null)
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    expect(board(snap).board.members).toEqual(['edmund-ashvale'])
    expect(views(snap)[0].members).toEqual(['edmund-ashvale'])
    // Also give them a stored position, so the arrangement is checked too.
    await invoke('view:save', root, BID, {
      ...views(snap)[0],
      arranged: true,
      overrides: { 'edmund-ashvale': { x: 5, y: 6 } }
    })

    snap = await invoke('character:delete', root, BID, 'edmund-ashvale')
    expect(board(snap).board.members).toEqual([])
    expect(views(snap)[0].members).toEqual([])
    expect(views(snap)[0].overrides).toEqual({})
  })

  it('renaming a character retargets board and tree membership', async () => {
    await addOnBoard('Edmund Ashvale')
    await invoke('view:create', root, BID, 'Everyone', 'edmund-ashvale')
    let snap = await invoke<ProjectSnapshot>('project:reload', root)
    await invoke('view:save', root, BID, {
      ...views(snap)[0],
      arranged: true,
      overrides: { 'edmund-ashvale': { x: 5, y: 6 } },
      collapsed: ['edmund-ashvale']
    })

    snap = await invoke('character:rename', root, BID, 'edmund-ashvale', 'Edmond Ashvale')
    expect(board(snap).board.members).toEqual(['edmond-ashvale'])
    const v = views(snap)[0]
    expect(v.members).toEqual(['edmond-ashvale'])
    expect(v.root).toBe('edmond-ashvale')
    expect(v.collapsed).toEqual(['edmond-ashvale'])
    expect(v.overrides).toEqual({ 'edmond-ashvale': { x: 5, y: 6 } })
  })

  it('leaves a pre-v0.6.0 board and view alone — absent membership means everyone', async () => {
    await add('Edmund Ashvale')
    await add('Rowan Ashvale')

    // Write the legacy shape by hand: no `members` key anywhere.
    const boardPath = join(root, 'boards', BID, 'board.json')
    const raw = JSON.parse(await fs.readFile(boardPath, 'utf8'))
    delete raw.members
    raw.views = ['legacy']
    await fs.writeFile(boardPath, JSON.stringify(raw, null, 2))
    await fs.mkdir(join(root, 'boards', BID, 'views'), { recursive: true })
    await fs.writeFile(
      join(root, 'boards', BID, 'views', 'legacy.json'),
      JSON.stringify({ id: 'legacy', name: 'Legacy' })
    )

    const snap = await invoke<ProjectSnapshot>('project:reload', root)
    expect(board(snap).board.members).toBeNull()
    expect(views(snap)[0].members).toBeNull()
  })
})

describe('board:delete', () => {
  it('takes the board’s trees with it', async () => {
    await invoke('board:create', root, 'Second')
    await invoke('view:create', root, 'second', 'Everyone', null)
    await invoke('board:delete', root, 'second')
    await expect(fs.access(join(root, 'boards', 'second'))).rejects.toThrow()
  })
})
