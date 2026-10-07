import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ProjectSnapshot } from '@shared/ipc'
import type { ColumnGroup, TimelineUnit } from '@shared/types'

/**
 * The column-hierarchy handlers (Issue #104) against a real temp project.
 *
 * The property that matters most is the reason groups became entities: renaming
 * one must not detach its note. Everything else here is the bookkeeping that keeps
 * the tree consistent — order, parents, cascades — on disk, not just in memory.
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
const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true).catch(() => false)
const groupFile = (id: string): string => join(root, 'boards', 'main', 'colgroups', `${id}.md`)
const unitFile = (id: string): string => join(root, 'boards', 'main', 'timeline', `${id}.md`)

const board = (snap: ProjectSnapshot) => snap.boards[0]
const group = (snap: ProjectSnapshot, id: string): ColumnGroup | undefined =>
  board(snap).colGroups.find((g) => g.id === id)
const unit = (snap: ProjectSnapshot, id: string): TimelineUnit | undefined =>
  board(snap).timeline.find((u) => u.id === id)

const newGroup = (label: string, parent?: string): Promise<ProjectSnapshot> =>
  invoke('colgroup:save', root, 'main', { id: '', type: 'colgroup', label, order: 0, ...(parent ? { parent } : {}) })
const newUnit = (label: string, parent?: string): Promise<ProjectSnapshot> =>
  invoke('timeline:save', root, 'main', { id: '', label, order: 0, ...(parent ? { parent } : {}) })

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-columns-'))
  await createProject(root)
  handlers.clear()
  registerIpc({} as never)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('colgroup:save', () => {
  it('creates a group with a slug id, at the end of its siblings', async () => {
    await newGroup('Part One')
    const snap = await newGroup('Part Two')
    expect(snap.boards[0].colGroups.map((g) => [g.id, g.label, g.order])).toEqual([
      ['part-one', 'Part One', 1],
      ['part-two', 'Part Two', 2]
    ])
    expect(await exists(groupFile('part-one'))).toBe(true)
  })

  it('numbers a nested group among its own siblings', async () => {
    await newGroup('Novel')
    await newGroup('Part A', 'novel')
    const snap = await newGroup('Part B', 'novel')
    expect(group(snap, 'part-b')).toMatchObject({ parent: 'novel', order: 2 })
  })

  it('gives two groups with the same label different ids', async () => {
    await newGroup('Part')
    const snap = await newGroup('Part')
    expect(snap.boards[0].colGroups.map((g) => g.id)).toEqual(['part', 'part-2'])
  })

  it('refuses a group with no name', async () => {
    await expect(newGroup('   ')).rejects.toThrow(/needs a name/)
  })

  it('renaming a group keeps its id, its file and its note — nothing is orphaned', async () => {
    await newGroup('Act 1')
    await invoke('entity:saveBody', root, 'main', 'colgroup', 'act-1', '\nThe fault appears.\n')

    const snap = await invoke('colgroup:save', root, 'main', {
      ...group(await invoke('project:reload', root), 'act-1')!,
      label: 'The Gathering'
    })

    expect(group(snap, 'act-1')).toMatchObject({ id: 'act-1', label: 'The Gathering', hasNote: true })
    expect(board(snap).colGroups).toHaveLength(1)
    expect(await invoke('entity:getBody', root, 'main', 'colgroup', 'act-1')).toContain('The fault appears.')
    // No renamed copy was written beside it.
    expect(await fs.readdir(join(root, 'boards', 'main', 'colgroups'))).toEqual(['act-1.md'])
  })

  it('refuses to move a group inside itself or anything under it', async () => {
    await newGroup('Novel')
    await newGroup('Part', 'novel')
    const snap = await invoke('project:reload', root)
    await expect(
      invoke('colgroup:save', root, 'main', { ...group(snap, 'novel')!, parent: 'part' })
    ).rejects.toThrow(/inside itself/)
  })

  it('drops a parent that does not exist rather than saving a dangling reference', async () => {
    const snap = await newGroup('Orphan', 'nowhere')
    expect(group(snap, 'orphan')?.parent).toBeUndefined()
  })

  it('puts a group moved to another parent last under it', async () => {
    await newGroup('A')
    await newGroup('B')
    await newGroup('Child', 'a')
    await newGroup('Other', 'b')
    const snap = await invoke('project:reload', root)
    const moved = await invoke('colgroup:save', root, 'main', { ...group(snap, 'child')!, parent: 'b' })
    expect(group(moved, 'child')).toMatchObject({ parent: 'b', order: 2 })
  })
})

describe('notes on groups and columns', () => {
  it('reads back what was written, and marks the group as having a note', async () => {
    await newGroup('Part One')
    expect(group(await invoke('project:reload', root), 'part-one')?.hasNote).toBeUndefined()
    const snap = await invoke('entity:saveBody', root, 'main', 'colgroup', 'part-one', 'Hello')
    expect(group(snap, 'part-one')?.hasNote).toBe(true)
    expect((await invoke<string>('entity:getBody', root, 'main', 'colgroup', 'part-one')).trim()).toBe('Hello')
  })

  it('editing the note leaves the group’s fields alone, and the other way round', async () => {
    await newGroup('Part One')
    await invoke('entity:saveBody', root, 'main', 'colgroup', 'part-one', 'Hello')
    const raw = await fs.readFile(groupFile('part-one'), 'utf8')
    expect(raw).toMatch(/^label: Part One$/m)
    expect(raw).toMatch(/^type: colgroup$/m)
    expect(raw.trim().endsWith('Hello')).toBe(true)
  })

  it('marks a column that has a note, but not one holding only the seed template', async () => {
    const created = await newUnit('Chapter 1')
    expect(unit(created, 'chapter-1')?.hasNote).toBeUndefined()
    const written = await invoke('entity:saveBody', root, 'main', 'timeline', 'chapter-1', 'Real prose.')
    expect(unit(written, 'chapter-1')?.hasNote).toBe(true)
  })
})

describe('timeline:save with a parent', () => {
  it('files a column under a group, last among its siblings', async () => {
    await newGroup('Part One')
    await newUnit('S1', 'part-one')
    const snap = await newUnit('S2', 'part-one')
    expect(unit(snap, 's2')).toMatchObject({ parent: 'part-one', order: 2 })
  })

  it('ignores a parent that does not exist', async () => {
    const snap = await newUnit('S1', 'nowhere')
    expect(unit(snap, 's1')?.parent).toBeUndefined()
  })

  it('moving a column to another group via the form puts it last there', async () => {
    await newGroup('A')
    await newGroup('B')
    await newUnit('S1', 'a')
    await newUnit('S2', 'b')
    const snap = await invoke('project:reload', root)
    const moved = await invoke('timeline:save', root, 'main', { ...unit(snap, 's1')!, parent: 'b' })
    expect(unit(moved, 's1')).toMatchObject({ parent: 'b', order: 2 })
  })

  it('keeps a plain edit exactly where it was', async () => {
    await newGroup('A')
    await newUnit('S1', 'a')
    await newUnit('S2', 'a')
    const snap = await invoke('project:reload', root)
    const edited = await invoke('timeline:save', root, 'main', { ...unit(snap, 's1')!, label: 'Renamed' })
    expect(unit(edited, 's1')).toMatchObject({ label: 'Renamed', parent: 'a', order: 1 })
  })
})

describe('colgroup:delete', () => {
  async function build(): Promise<void> {
    await newGroup('Novel')
    await newGroup('Part', 'novel')
    await newUnit('S1', 'part')
    await newUnit('S2', 'novel')
    await newUnit('Elsewhere')
    await invoke('entity:saveBody', root, 'main', 'timeline', 's1', 'A scene note.')
    await invoke('entity:saveBody', root, 'main', 'colgroup', 'part', 'A part note.')
    const snap = await invoke('project:reload', root)
    await invoke('board:save', root, {
      ...board(snap).board,
      collapsedColGroups: ['part', 'other'],
      cards: [
        { id: 'c-in', noteUid: 'n1', rowId: 'a', colStart: 's1', colEnd: 's1' },
        { id: 'c-out', noteUid: 'n2', rowId: 'a', colStart: 'elsewhere', colEnd: 'elsewhere' }
      ]
    })
  }

  it('deletes the group and everything under it — groups, columns and their files', async () => {
    await build()
    const snap = await invoke('colgroup:delete', root, 'main', 'novel')

    expect(board(snap).colGroups).toEqual([])
    expect(board(snap).timeline.map((u) => u.id)).toEqual(['elsewhere'])
    for (const f of [groupFile('novel'), groupFile('part'), unitFile('s1'), unitFile('s2')]) {
      expect(await exists(f)).toBe(false)
    }
    expect(await exists(unitFile('elsewhere'))).toBe(true)
  })

  it('removes the cards on the deleted columns, and only those', async () => {
    await build()
    const snap = await invoke('colgroup:delete', root, 'main', 'novel')
    expect(board(snap).board.cards.map((c) => c.id)).toEqual(['c-out'])
  })

  it('forgets the collapsed state of the groups that went', async () => {
    await build()
    const snap = await invoke('colgroup:delete', root, 'main', 'novel')
    expect(board(snap).board.collapsedColGroups).toEqual(['other'])
  })

  it('deletes only the part when asked to, leaving its parent and the parent’s other children', async () => {
    await build()
    const snap = await invoke('colgroup:delete', root, 'main', 'part')
    expect(board(snap).colGroups.map((g) => g.id)).toEqual(['novel'])
    expect(board(snap).timeline.map((u) => u.id).sort()).toEqual(['elsewhere', 's2'])
  })

  it('deletes an empty group', async () => {
    await newGroup('Empty')
    const snap = await invoke('colgroup:delete', root, 'main', 'empty')
    expect(board(snap).colGroups).toEqual([])
  })
})

describe('columns:move', () => {
  it('reparents a column into a group, closing the gap it left behind', async () => {
    await newGroup('Part')
    await newUnit('S1')
    await newUnit('S2')
    await newUnit('S3')
    const snap = await invoke('columns:move', root, 'main', { kind: 'unit', id: 's2' }, 'part')

    expect(unit(snap, 's2')).toMatchObject({ parent: 'part', order: 1 })
    // Top level was [part, s1, s2, s3]; with s2 gone, s3 closes up to 3.
    expect(unit(snap, 's1')?.order).toBe(2)
    expect(unit(snap, 's3')?.order).toBe(3)
  })

  it('moves a column back out to the top level', async () => {
    await newGroup('Part')
    await newUnit('S1', 'part')
    const snap = await invoke('columns:move', root, 'main', { kind: 'unit', id: 's1' }, null)
    expect(unit(snap, 's1')?.parent).toBeUndefined()
    expect(await fs.readFile(unitFile('s1'), 'utf8')).not.toMatch(/^parent:/m)
  })

  it('places an item at a given index among its new siblings', async () => {
    await newGroup('Part')
    await newUnit('S1', 'part')
    await newUnit('S2', 'part')
    await newUnit('Mover')
    const snap = await invoke('columns:move', root, 'main', { kind: 'unit', id: 'mover' }, 'part', 1)
    const order = Object.fromEntries(board(snap).timeline.map((u) => [u.id, u.order]))
    expect(order).toMatchObject({ s1: 1, mover: 2, s2: 3 })
  })

  it('moves a group, with everything in it, under another', async () => {
    await newGroup('A')
    await newGroup('B')
    await newUnit('S1', 'a')
    const snap = await invoke('columns:move', root, 'main', { kind: 'node', id: 'a' }, 'b')
    expect(group(snap, 'a')?.parent).toBe('b')
    expect(unit(snap, 's1')?.parent).toBe('a')
  })

  it('refuses to move a group into its own subtree, and changes nothing', async () => {
    await newGroup('A')
    await newGroup('B', 'a')
    await expect(invoke('columns:move', root, 'main', { kind: 'node', id: 'a' }, 'b')).rejects.toThrow(
      /not allowed/
    )
    expect(group(await invoke('project:reload', root), 'a')?.parent).toBeUndefined()
  })

  it('preserves the note on whatever it moves', async () => {
    await newGroup('Part')
    await newUnit('S1')
    await invoke('entity:saveBody', root, 'main', 'timeline', 's1', 'Kept.')
    await invoke('columns:move', root, 'main', { kind: 'unit', id: 's1' }, 'part')
    expect(await invoke('entity:getBody', root, 'main', 'timeline', 's1')).toContain('Kept.')
  })
})

describe('columns:reorder', () => {
  it('puts the siblings in the order given', async () => {
    await newGroup('Part')
    await newUnit('S1', 'part')
    await newUnit('S2', 'part')
    await newUnit('S3', 'part')
    const snap = await invoke('columns:reorder', root, 'main', 'part', [
      { kind: 'unit', id: 's3' },
      { kind: 'unit', id: 's1' },
      { kind: 'unit', id: 's2' }
    ])
    const order = Object.fromEntries(board(snap).timeline.map((u) => [u.id, u.order]))
    expect(order).toEqual({ s3: 1, s1: 2, s2: 3 })
  })

  it('reorders groups and columns together at the top level', async () => {
    await newGroup('Part')
    await newUnit('S1')
    const snap = await invoke('columns:reorder', root, 'main', null, [
      { kind: 'unit', id: 's1' },
      { kind: 'node', id: 'part' }
    ])
    expect(unit(snap, 's1')?.order).toBe(1)
    expect(group(snap, 'part')?.order).toBe(2)
  })
})

describe('colgroup:wrap', () => {
  it('puts a new group in the column’s place and the column inside it', async () => {
    await newGroup('Part')
    await newUnit('S1', 'part')
    await newUnit('S2', 'part')
    const snap = await invoke('colgroup:wrap', root, 'main', 's2', 'Chapter Two', false)

    expect(group(snap, 'chapter-two')).toMatchObject({ label: 'Chapter Two', parent: 'part', order: 2 })
    expect(unit(snap, 's2')).toMatchObject({ parent: 'chapter-two', order: 1 })
    // The neighbour is untouched.
    expect(unit(snap, 's1')).toMatchObject({ parent: 'part', order: 1 })
  })

  it('keeps the column’s id, so its cards still point at it', async () => {
    await newUnit('S1')
    const before = await invoke('project:reload', root)
    await invoke('board:save', root, {
      ...board(before).board,
      cards: [{ id: 'c1', noteUid: 'n1', rowId: 'a', colStart: 's1', colEnd: 's1' }]
    })
    const snap = await invoke('colgroup:wrap', root, 'main', 's1', 'Wrapper', false)
    expect(unit(snap, 's1')).toBeDefined()
    expect(board(snap).board.cards).toHaveLength(1)
    expect(board(snap).board.cards[0].colStart).toBe('s1')
  })

  it('leaves the note on the column by default', async () => {
    await newUnit('S1')
    await invoke('entity:saveBody', root, 'main', 'timeline', 's1', 'The scene note.')
    const snap = await invoke('colgroup:wrap', root, 'main', 's1', 'Chapter', false)
    expect(unit(snap, 's1')?.hasNote).toBe(true)
    expect(group(snap, 'chapter')?.hasNote).toBeUndefined()
  })

  it('moves the note up to the new group when asked', async () => {
    await newUnit('S1')
    await invoke('entity:saveBody', root, 'main', 'timeline', 's1', 'The scene note.')
    const snap = await invoke('colgroup:wrap', root, 'main', 's1', 'Chapter', true)

    expect(group(snap, 'chapter')?.hasNote).toBe(true)
    expect(await invoke('entity:getBody', root, 'main', 'colgroup', 'chapter')).toContain('The scene note.')
    expect(unit(snap, 's1')?.hasNote).toBeUndefined()
  })

  it('falls back to the column’s own label when given no name', async () => {
    await newUnit('Opening')
    const snap = await invoke('colgroup:wrap', root, 'main', 'opening', '  ', false)
    expect(group(snap, 'opening')?.label).toBe('Opening')
  })

  it('rejects a column that does not exist', async () => {
    await expect(invoke('colgroup:wrap', root, 'main', 'ghost', 'X', false)).rejects.toThrow(/No column/)
  })
})

describe('timeline:delete', () => {
  it('still removes a single column and its cards', async () => {
    await newGroup('Part')
    await newUnit('S1', 'part')
    const before = await invoke('project:reload', root)
    await invoke('board:save', root, {
      ...board(before).board,
      cards: [{ id: 'c1', noteUid: 'n1', rowId: 'a', colStart: 's1', colEnd: 's1' }]
    })
    const snap = await invoke('timeline:delete', root, 'main', 's1')
    expect(board(snap).timeline).toEqual([])
    expect(board(snap).board.cards).toEqual([])
    // Its group stays — emptying a group is not deleting it.
    expect(board(snap).colGroups.map((g) => g.id)).toEqual(['part'])
  })
})
