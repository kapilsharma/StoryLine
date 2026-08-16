// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoardData, ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION, defaultView, type Character, type View } from '@shared/types'
import { ProjectView } from '@renderer/components/ProjectView'
import { makeApi, renderWithProviders } from './test-utils'

/**
 * The Family tab (Issue 29), in jsdom.
 *
 * Deliberately scoped to what jsdom can actually answer: which tabs exist, which
 * nodes are in the DOM, whether the per-board scoping holds, and what read-only
 * hides. **Not** geometry — jsdom has no layout engine, so every element reports
 * a zero-sized box and an assertion about positions here would pass whether or
 * not the tree is visible. That belongs in Playwright (tests/e2e/family.spec.ts).
 */

const person = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id,
  type: 'character',
  name,
  colour: '#888888',
  ...extra
})

/** A board whose cast is a couple and their child. */
function boardData(id: string, name: string, views: View[], cast?: Character[]): BoardData {
  return {
    board: {
      id,
      name,
      cards: [],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      rowOrder: [],
      rowGroupOrder: [],
      colOrder: [],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1,
      members: null,
      views: views.map((v) => v.id)
    },
    characters:
      cast ?? [
        person('edmund-ashvale', 'Edmund Ashvale', { gender: 'male', spouse: ['hester-ashvale'] }),
        person('hester-ashvale', 'Hester Ashvale', { gender: 'female', spouse: ['edmund-ashvale'] }),
        person('rowan-ashvale', 'Rowan Ashvale', { father: 'edmund-ashvale', mother: 'hester-ashvale' })
      ],
    timeline: [],
    notes: [],
    views,
    problems: []
  }
}

function snapshotWith(boards: BoardData[]): ProjectSnapshot {
  return {
    root: '/tmp/project',
    project: {
      schemaVersion: SCHEMA_VERSION,
      name: 'My Novel',
      timelineLabel: 'Chapter',
      boards: boards.map((b) => b.board.id),
      created: '2026-08-01',
      lastOpened: '2026-08-11',
      families: { Ashvale: '#2E8B67' }
    },
    boards
  }
}

/**
 * A tree whose membership is filter-driven (`members: null`) — the pre-v0.6.0
 * shape, kept for the cases below that are about filters and rendering rather
 * than membership. The membership cases build their own views with explicit
 * `members`, as the app does.
 */
const filterDriven = (id = 'everyone', name = 'Everyone', patch: Partial<View> = {}): View => ({
  ...defaultView(id, name),
  members: null,
  ...patch
})

const everyone = filterDriven()

async function openFamilyTab(snapshot: ProjectSnapshot, readOnly = false): Promise<void> {
  makeApi({
    openProject: vi.fn().mockResolvedValue(snapshot),
    reloadProject: vi.fn().mockResolvedValue(snapshot)
  })
  renderWithProviders(<ProjectView />, { readOnly, bootRoot: snapshot.root })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Family' })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Family' }))
}

describe('the Family tab', () => {
  it('offers to create the first tree on a board that has none', async () => {
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [])]))
    expect(screen.getByText(/No family tree on this board yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create the first tree/ })).toBeInTheDocument()
  })

  it('draws a node per character, labelled the way the tree shows them', async () => {
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [everyone])]))
    // "Rowan Ashvale" already carries its surname, so it is not doubled up.
    for (const name of ['Edmund Ashvale', 'Hester Ashvale', 'Rowan Ashvale']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('is scoped to the active board — switching boards switches the cast', async () => {
    const snapshot = snapshotWith([
      boardData('main', 'Main Board', [everyone]),
      boardData('other', 'Other Board', [filterDriven('other-tree', 'Other tree')], [
        person('elsewhere', 'Elsewhere Person')
      ])
    ])
    await openFamilyTab(snapshot)
    expect(screen.getByText('Edmund Ashvale')).toBeInTheDocument()
    expect(screen.queryByText('Elsewhere Person')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'other')
    await waitFor(() => expect(screen.getByText('Elsewhere Person')).toBeInTheDocument())
    expect(screen.queryByText('Edmund Ashvale')).not.toBeInTheDocument()
    // The view tab strip follows the board too.
    expect(screen.getByRole('button', { name: 'Other tree' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Everyone' })).not.toBeInTheDocument()
  })

  it('shows a ghost for a referenced-but-missing parent, and says so', async () => {
    const snapshot = snapshotWith([
      boardData('main', 'Main Board', [everyone], [
        person('orphan', 'Orphan Ashvale', { father: 'missing-dad' })
      ])
    ])
    // `problems` normally arrives computed from the main process; mirror that.
    snapshot.boards[0].problems = [
      { kind: 'dangling', id: 'missing-dad', message: 'Orphan Ashvale’s father "missing-dad" has no character file.' }
    ]
    await openFamilyTab(snapshot)

    expect(screen.getByText('Missing Dad')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '1 problem' }))
    expect(screen.getByText(/has no character file/)).toBeInTheDocument()
  })

  it('hides the missing person when the tree says not to show ghosts', async () => {
    const snapshot = snapshotWith([
      boardData('main', 'Main Board', [{ ...everyone, showGhosts: false }], [
        person('orphan', 'Orphan Ashvale', { father: 'missing-dad' })
      ])
    ])
    await openFamilyTab(snapshot)
    expect(screen.queryByText('Missing Dad')).not.toBeInTheDocument()
    expect(screen.getByText('Orphan Ashvale')).toBeInTheDocument()
  })

  it('legends the families on screen, but only when there is more than one', async () => {
    const single = snapshotWith([boardData('main', 'Main Board', [everyone])])
    await openFamilyTab(single)
    // One family (Ashvale) — a legend of one entry is noise.
    expect(screen.queryByText('Ashvale')).not.toBeInTheDocument()
  })

  it('applies a view’s filters — childDepth 0 is ancestors only', async () => {
    const ancestors = filterDriven('ancestors', 'Ancestors', {
      root: 'rowan-ashvale',
      childDepth: 0
    })
    const cast = [
      person('edmund-ashvale', 'Edmund Ashvale', { gender: 'male' }),
      person('hester-ashvale', 'Hester Ashvale', { gender: 'female' }),
      person('rowan-ashvale', 'Rowan Ashvale', { father: 'edmund-ashvale', mother: 'hester-ashvale' }),
      person('juno-ashvale', 'Juno Ashvale', { father: 'rowan-ashvale' })
    ]
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [ancestors], cast)]))

    for (const name of ['Rowan Ashvale', 'Edmund Ashvale', 'Hester Ashvale']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // The root's own child is below the cut.
    expect(screen.queryByText('Juno Ashvale')).not.toBeInTheDocument()
  })

  it('draws only its members, not everyone in the folder', async () => {
    // The whole point of Issue 29's second half: a relative entered for context
    // must not turn up on a tree just because their file exists.
    const curated = { ...defaultView('curated', 'Curated'), members: ['edmund-ashvale', 'rowan-ashvale'] }
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [curated])]))

    expect(screen.getByText('Edmund Ashvale')).toBeInTheDocument()
    expect(screen.getByText('Rowan Ashvale')).toBeInTheDocument()
    expect(screen.queryByText('Hester Ashvale')).not.toBeInTheDocument()
  })

  it('offers the people who are off the tree, and only those', async () => {
    const curated = { ...defaultView('curated', 'Curated'), members: ['edmund-ashvale'] }
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [curated])]))

    // Two of the three characters are off this tree.
    const add = screen.getByRole('button', { name: /Add person \(2\)/ })
    await userEvent.click(add)
    const menu = document.querySelector('.context-menu')!
    expect(within(menu as HTMLElement).getByText('Hester Ashvale')).toBeInTheDocument()
    expect(within(menu as HTMLElement).getByText('Rowan Ashvale')).toBeInTheDocument()
    expect(within(menu as HTMLElement).queryByText('Edmund Ashvale')).not.toBeInTheDocument()
  })

  it('adding a person writes them into the tree’s members', async () => {
    const curated = { ...defaultView('curated', 'Curated'), members: ['edmund-ashvale'] }
    const snapshot = snapshotWith([boardData('main', 'Main Board', [curated])])
    const saveView = vi.fn().mockResolvedValue(snapshot)
    makeApi({
      openProject: vi.fn().mockResolvedValue(snapshot),
      reloadProject: vi.fn().mockResolvedValue(snapshot),
      saveView
    })
    renderWithProviders(<ProjectView />, { bootRoot: snapshot.root })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Family' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Family' }))

    await userEvent.click(screen.getByRole('button', { name: /Add person/ }))
    await userEvent.click(screen.getByText('Hester Ashvale'))

    await waitFor(() => expect(saveView).toHaveBeenCalled())
    const written = saveView.mock.calls[0][2] as View
    expect(written.members?.sort()).toEqual(['edmund-ashvale', 'hester-ashvale'])
    // A non-arranged tree needs no position — the layout engine places them.
    expect(written.overrides).toEqual({})
  })

  it('an empty tree explains how to put people on it', async () => {
    const empty = { ...defaultView('empty', 'Empty'), members: [] }
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [empty])]))
    expect(screen.getByText(/Nobody on this tree yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add person \(3\)/ })).toBeInTheDocument()
  })

  it('read-only hides tree creation, so a published tree cannot be reshaped', async () => {
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [everyone])]), true)
    const tabs = screen.getByText('Everyone').parentElement!
    expect(within(tabs).queryByRole('button', { name: '+' })).not.toBeInTheDocument()
  })

  it('read-only on an empty board says so without offering to create', async () => {
    await openFamilyTab(snapshotWith([boardData('main', 'Main Board', [])]), true)
    expect(screen.getByText(/No family tree on this board yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create the first tree/ })).not.toBeInTheDocument()
  })
})
