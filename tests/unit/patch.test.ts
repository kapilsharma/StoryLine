import { describe, it, expect } from 'vitest'
import { applyProjectPatch, applyReply, planReload, type ProjectPatch } from '@shared/patch'
import type { BoardData, ProjectSnapshot } from '@shared/ipc'
import { defaultView, type Board, type Character, type Note, type Project, type TimelineUnit } from '@shared/types'
import type { ProjectChange } from '@shared/changes'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const board = (id: string): Board => ({
  id,
  name: id,
  cards: [],
  hiddenRows: [],
  hiddenCols: [],
  presets: [],
  members: null,
  rowOrder: [],
  rowGroupOrder: [],
  colOrder: [],
  collapsedRowGroups: [],
  collapsedColGroups: [],
  zoom: 1,
  views: []
})

const char = (id: string, over: Partial<Character> = {}): Character => ({
  id,
  type: 'character',
  name: id,
  colour: '#888888',
  ...over
})

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: id,
  body: '',
  ...over
})

const unit = (id: string, order: number): TimelineUnit => ({ id, label: id, order })

const boardData = (id: string, over: Partial<BoardData> = {}): BoardData => ({
  board: board(id),
  characters: [],
  timeline: [],
  colGroups: [],
  notes: [],
  views: [],
  problems: [],
  ...over
})

const snapshot = (boards: BoardData[], project: Partial<Project> = {}): ProjectSnapshot => ({
  root: '/project',
  project: {
    schemaVersion: 4,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: boards.map((bd) => bd.board.id),
    created: '2026-01-01',
    lastOpened: '2026-01-02',
    families: {},
    ...project
  },
  boards
})

const change = (over: Partial<ProjectChange> & Pick<ProjectChange, 'kind' | 'id'>): ProjectChange => ({
  type: 'change',
  ...over
})

// ── planReload ──────────────────────────────────────────────────────────────

describe('planReload', () => {
  const snap = snapshot([boardData('main'), boardData('b2')])

  it('focuses an empty batch (nothing to do)', () => {
    expect(planReload(snap, [])).toEqual({ mode: 'focused', changes: [] })
  })

  it('focuses a project.json edit', () => {
    const changes = [change({ kind: 'project', id: 'project' })]
    expect(planReload(snap, changes)).toEqual({ mode: 'focused', changes })
  })

  it('focuses entity edits on boards it already holds', () => {
    const changes = [
      change({ kind: 'note', id: 'n1', boardId: 'main' }),
      change({ kind: 'character', id: 'c1', boardId: 'b2', type: 'add' }),
      change({ kind: 'board', id: 'main', boardId: 'main' })
    ]
    expect(planReload(snap, changes)).toEqual({ mode: 'focused', changes })
  })

  it('falls back to full when an entity names an unknown board', () => {
    const changes = [change({ kind: 'note', id: 'n1', boardId: 'ghost' })]
    expect(planReload(snap, changes)).toEqual({ mode: 'full' })
  })

  it('falls back to full when a whole board is added or removed', () => {
    expect(planReload(snap, [change({ kind: 'board', id: 'new', boardId: 'new', type: 'add' })])).toEqual({
      mode: 'full'
    })
    expect(
      planReload(snap, [change({ kind: 'board', id: 'main', boardId: 'main', type: 'unlink' })])
    ).toEqual({ mode: 'full' })
  })

  it('is all-or-nothing: one structural change makes the whole batch full', () => {
    const changes = [
      change({ kind: 'note', id: 'n1', boardId: 'main' }),
      change({ kind: 'board', id: 'new', boardId: 'new', type: 'add' })
    ]
    expect(planReload(snap, changes).mode).toBe('full')
  })
})

// ── applyProjectPatch ─────────────────────────────────────────────────────────

describe('applyProjectPatch', () => {
  it('replaces an existing note meta in place, keeping array order', () => {
    const snap = snapshot([boardData('main', { notes: [note('a'), note('b'), note('c')] })])
    const patch: ProjectPatch = {
      ops: [{ target: 'note', boardId: 'main', id: 'b', value: note('b', { title: 'B!', hasBody: true }) }]
    }
    const next = applyProjectPatch(snap, patch)
    expect(next.boards[0].notes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(next.boards[0].notes[1]).toMatchObject({ title: 'B!', hasBody: true })
  })

  it('appends an added note and removes a deleted one', () => {
    const snap = snapshot([boardData('main', { notes: [note('a')] })])
    const added = applyProjectPatch(snap, {
      ops: [{ target: 'note', boardId: 'main', id: 'b', value: note('b') }]
    })
    expect(added.boards[0].notes.map((n) => n.id)).toEqual(['a', 'b'])

    const removed = applyProjectPatch(snap, {
      ops: [{ target: 'note', boardId: 'main', id: 'a', value: null }]
    })
    expect(removed.boards[0].notes).toEqual([])
  })

  it('keeps timeline units sorted by order after an upsert', () => {
    const snap = snapshot([boardData('main', { timeline: [unit('a', 1), unit('c', 3)] })])
    const next = applyProjectPatch(snap, {
      ops: [{ target: 'timeline', boardId: 'main', id: 'b', value: unit('b', 2) }]
    })
    expect(next.boards[0].timeline.map((u) => u.id)).toEqual(['a', 'b', 'c'])
  })

  it('recomputes problems when a board’s cast changes', () => {
    // A child pointing at a parent who isn’t on the board is a dangling ref.
    const snap = snapshot([boardData('main', { characters: [char('kid', { father: 'ghost' })] })])
    expect(snap.boards[0].problems).toEqual([]) // fixture starts clean

    const withProblem = applyProjectPatch(snap, {
      ops: [{ target: 'character', boardId: 'main', id: 'kid', value: char('kid', { father: 'ghost' }) }]
    })
    expect(withProblem.boards[0].problems.length).toBeGreaterThan(0)

    // Fixing the ref clears the problem.
    const fixed = applyProjectPatch(snap, {
      ops: [{ target: 'character', boardId: 'main', id: 'kid', value: char('kid') }]
    })
    expect(fixed.boards[0].problems).toEqual([])
  })

  it('replaces board.json content without touching the board’s entities', () => {
    const notes = [note('a')]
    const snap = snapshot([boardData('main', { notes })])
    const next = applyProjectPatch(snap, {
      ops: [{ target: 'board', boardId: 'main', board: { ...board('main'), zoom: 2 } }]
    })
    expect(next.boards[0].board.zoom).toBe(2)
    expect(next.boards[0].notes).toBe(notes) // same identity — untouched
  })

  it('swaps project metadata and reorders boards to match project.boards', () => {
    const snap = snapshot([boardData('main'), boardData('b2')])
    const next = applyProjectPatch(snap, {
      ops: [{ target: 'project', project: { ...snap.project, name: 'Renamed', boards: ['b2', 'main'] } }]
    })
    expect(next.project.name).toBe('Renamed')
    expect(next.boards.map((bd) => bd.board.id)).toEqual(['b2', 'main'])
  })

  it('only touched boards get a new identity', () => {
    const snap = snapshot([boardData('main', { notes: [note('a')] }), boardData('b2')])
    const b2 = snap.boards[1]
    const next = applyProjectPatch(snap, {
      ops: [{ target: 'note', boardId: 'main', id: 'a', value: note('a', { title: 'A!' }) }]
    })
    expect(next.boards[0]).not.toBe(snap.boards[0]) // touched
    expect(next.boards[1]).toBe(b2) // untouched, same reference
  })

  it('returns the same snapshot when there is nothing to apply', () => {
    const snap = snapshot([boardData('main')])
    expect(applyProjectPatch(snap, { ops: [] })).toBe(snap)
  })

  it('skips ops for a board that is no longer in the snapshot', () => {
    const snap = snapshot([boardData('main')])
    const next = applyProjectPatch(snap, {
      ops: [{ target: 'note', boardId: 'gone', id: 'x', value: note('x') }]
    })
    expect(next).toBe(snap) // nothing changed, no throw
  })
})

// The project index (#187) is a patched snapshot that must deep-equal a fresh
// load, so a patch has to put things exactly where the loader would.
describe('applyProjectPatch keeps the loader’s order', () => {
  it('inserts a new note or character in id order, not at the end', () => {
    const snap = snapshot([boardData('main', { notes: [note('a'), note('c')], characters: [char('b'), char('d')] })])
    const next = applyProjectPatch(snap, {
      ops: [
        { target: 'note', boardId: 'main', id: 'b', value: note('b') },
        { target: 'note', boardId: 'main', id: 'd', value: note('d') },
        { target: 'character', boardId: 'main', id: 'a', value: char('a') },
        { target: 'character', boardId: 'main', id: 'c', value: char('c') }
      ]
    })
    expect(next.boards[0].notes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(next.boards[0].characters.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('orders ids by code unit, as the loader’s sort() does', () => {
    const snap = snapshot([boardData('main', { notes: [note('B'), note('b')] })])
    const next = applyProjectPatch(snap, { ops: [{ target: 'note', boardId: 'main', id: 'a', value: note('a') }] })
    expect(next.boards[0].notes.map((n) => n.id)).toEqual(['B', 'a', 'b'])
  })

  it('breaks a timeline tie on order by id, whichever arrived first', () => {
    const snap = snapshot([boardData('main', { timeline: [unit('z', 1)] })])
    const next = applyProjectPatch(snap, { ops: [{ target: 'timeline', boardId: 'main', id: 'a', value: unit('a', 1) }] })
    expect(next.boards[0].timeline.map((u) => u.id)).toEqual(['a', 'z'])
  })

  it('lists views in board.views order, then the rest by id', () => {
    const view = (id: string) => defaultView(id, id)
    const snap = snapshot([boardData('main', { board: { ...board('main'), views: ['y', 'x'] }, views: [view('y'), view('x')] })])
    const added = applyProjectPatch(snap, {
      ops: [
        { target: 'view', boardId: 'main', id: 'b', value: view('b') },
        { target: 'view', boardId: 'main', id: 'a', value: view('a') }
      ]
    })
    expect(added.boards[0].views.map((v) => v.id)).toEqual(['y', 'x', 'a', 'b'])

    // A re-read board.json can reorder the views it lists.
    const reordered = applyProjectPatch(added, {
      ops: [{ target: 'board', boardId: 'main', board: { ...board('main'), views: ['a', 'x', 'y'] } }]
    })
    expect(reordered.boards[0].views.map((v) => v.id)).toEqual(['a', 'x', 'y', 'b'])
  })

  it('keeps the views array when a board edit leaves their order alone', () => {
    const view = (id: string) => defaultView(id, id)
    const snap = snapshot([boardData('main', { board: { ...board('main'), views: ['x'] }, views: [view('x')] })])
    const next = applyProjectPatch(snap, { ops: [{ target: 'board', boardId: 'main', board: { ...board('main'), views: ['x'], zoom: 2 } }] })
    expect(next.boards[0].views).toBe(snap.boards[0].views)
  })
})

// The renderer's side of #188: replies are patches between numbered versions.
describe('applyReply', () => {
  const snap = snapshot([boardData('main', { notes: [note('a')] })])
  const notePatch = (id: string) => ({ ops: [{ target: 'note' as const, boardId: 'main', id, value: note(id) }] })

  it('takes a whole snapshot as it is, whatever it held', () => {
    expect(applyReply(null, { kind: 'snapshot', version: 7, snapshot: snap })).toEqual({ snapshot: snap, version: 7 })
  })

  it('applies a patch made from the version it holds', () => {
    const next = applyReply({ snapshot: snap, version: 7 }, { kind: 'patch', root: snap.root, from: 7, version: 8, patch: notePatch('b') })
    expect(next?.version).toBe(8)
    expect(next?.snapshot.boards[0].notes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('refuses a patch from another version, another project, or with nothing held', () => {
    const reply = { kind: 'patch' as const, root: snap.root, from: 7, version: 8, patch: notePatch('b') }
    expect(applyReply({ snapshot: snap, version: 6 }, reply)).toBeNull()
    expect(applyReply({ snapshot: snap, version: 7 }, { ...reply, root: '/elsewhere' })).toBeNull()
    expect(applyReply(null, reply)).toBeNull()
  })
})

describe('applyProjectPatch — boards project.json leaves out', () => {
  it('keeps a board project.json does not list, after the ones it does', () => {
    const snap = snapshot([boardData('a'), boardData('b'), boardData('c')])
    const next = applyProjectPatch(snap, { ops: [{ target: 'project', project: { ...snap.project, boards: ['c', 'a'] } }] })
    expect(next.boards.map((bd) => bd.board.id)).toEqual(['c', 'a', 'b'])
  })
})
