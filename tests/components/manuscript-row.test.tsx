// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSnapshot } from '@shared/ipc'
import type { Card, Note, Project } from '@shared/types'
import App from '@renderer/App'
import { Settings } from '@renderer/components/Settings'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The Manuscript row through the UI (Issue #204): it sits on top of the board,
 * one cell per chapter; an empty cell starts that chapter's note and opens it in
 * the fullscreen editor; a filled one holds a card that can't be dragged or
 * resized; 📖 hides it per board; Settings picks the level.
 */

const chapter2: Card = {
  id: 'm2',
  noteUid: 'n_ms2',
  rowId: '@manuscript',
  colStart: 's3',
  colEnd: 's3',
  cell: { kind: 'node', id: 'ch-2' }
}
const notes: Note[] = [{ id: 'manuscript-chapter-2', uid: 'n_ms2', title: 'Chapter 2', body: '' }]

const snapshot = (
  over: { project?: Partial<Project>; cards?: Card[]; notes?: Note[]; hide?: boolean } = {}
): ProjectSnapshot =>
  makeSnapshot({
    project: { timelineLevelLabels: ['Chapter', 'Scene'], manuscriptLevel: 0, ...over.project },
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      cards: over.cards ?? [chapter2],
      ...(over.hide ? { hideManuscriptRow: true } : {})
    },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    colGroups: [
      { id: 'ch-1', type: 'colgroup', label: 'Chapter 1', order: 1 },
      { id: 'ch-2', type: 'colgroup', label: 'Chapter 2', order: 2 }
    ],
    timeline: [
      { id: 's1', label: 'Scene 1', order: 1, parent: 'ch-1' },
      { id: 's2', label: 'Scene 2', order: 2, parent: 'ch-1' },
      { id: 's3', label: 'Scene 3', order: 1, parent: 'ch-2' }
    ],
    notes: over.notes ?? notes
  })

async function renderBoard(snap: ProjectSnapshot, extra: Parameters<typeof makeApi>[0] = {}) {
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    ...extra
  })
  render(<App bootRoot={snap.root} />)
  await screen.findByText('My Novel')
  return api
}

const emptyCell = (key: string): Promise<HTMLElement> =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(`.manuscript-cell[data-cell="${key}"]`)
    if (!el) throw new Error(`no empty manuscript cell ${key}`)
    return el
  })

describe('the Manuscript row on the board (#204)', () => {
  it('sits above every character row, with a cell per chapter', async () => {
    await renderBoard(snapshot())
    const heads = await waitFor(() => {
      const found = [...document.querySelectorAll('.row-head')].map((h) => h.textContent)
      if (found.length < 2) throw new Error('rows not rendered yet')
      return found
    })
    expect(heads[0]).toContain('Manuscript')
    expect(heads[1]).toContain('Aeri')

    // Chapter 1 is empty and spans both its scenes; Chapter 2 holds its card.
    const cell = await emptyCell('node:ch-1')
    expect(cell.style.gridColumn).toBe('2 / 4')
    expect(document.querySelector('.manuscript-cell[data-cell="node:ch-2"]')).toBeNull()
  })

  it('draws a manuscript card that cannot be dragged or resized', async () => {
    await renderBoard(snapshot())
    const card = (await screen.findByText('Chapter 2', { selector: '.card-title' })).closest('.board-card')!
    expect(card).toHaveClass('manuscript-card')
    expect(card.getAttribute('draggable')).toBe('false')
    expect(card.querySelector('.resize-handle')).toBeNull()
  })

  it('starts a chapter from its empty cell and opens it in the fullscreen editor', async () => {
    const created: Card = {
      id: 'm1',
      noteUid: 'n_ms1',
      rowId: '@manuscript',
      colStart: 's1',
      colEnd: 's2',
      cell: { kind: 'node', id: 'ch-1' }
    }
    const newNote: Note = { id: 'manuscript-chapter-1', uid: 'n_ms1', title: 'Chapter 1', body: '' }
    const after = snapshot({ cards: [chapter2, created], notes: [...notes, newNote] })
    const api = await renderBoard(snapshot(), {
      createCard: vi.fn().mockResolvedValue(after),
      getNote: vi.fn().mockResolvedValue({ ...newNote, body: '\n' })
    })

    fireEvent.click(await emptyCell('node:ch-1'))

    await waitFor(() =>
      expect(api.createCard).toHaveBeenCalledWith('/project', {
        boardId: 'main',
        title: 'Chapter 1',
        rowId: '@manuscript',
        colStart: 's1',
        colEnd: 's2',
        cell: { kind: 'node', id: 'ch-1' }
      })
    )
    // No title prompt: the cell names its own note.
    expect(screen.queryByPlaceholderText('Card title')).not.toBeInTheDocument()
    expect(await screen.findByPlaceholderText('Write in Markdown…')).toBeInTheDocument()
    expect(api.getNote).toHaveBeenCalledWith('/project', 'main', 'manuscript-chapter-1')
  })

  it('is absent, with no 📖 toggle, when the project has no level', async () => {
    await renderBoard(snapshot({ project: { manuscriptLevel: undefined } }))
    await screen.findByText('Aeri')
    expect(document.querySelector('.manuscript-head')).toBeNull()
    expect(screen.queryByTitle('Hide the Manuscript row')).not.toBeInTheDocument()
  })

  it('hides and shows per board with 📖', async () => {
    const api = await renderBoard(snapshot())
    await userEvent.click(await screen.findByTitle('Hide the Manuscript row'))
    await waitFor(() =>
      expect(api.saveBoard).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({ id: 'main', hideManuscriptRow: true })
      )
    )
  })

  it('stays hidden on a board that hid it, with 📖 offering it back', async () => {
    await renderBoard(snapshot({ hide: true }))
    expect(await screen.findByTitle('Show the Manuscript row')).toBeInTheDocument()
    expect(document.querySelector('.manuscript-head')).toBeNull()
  })
})

describe('Settings — Manuscript row (#204)', () => {
  async function renderSettings(project: Partial<Project>) {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot({ project })) })
    renderWithProviders(<Settings />, { bootRoot: '/project' })
    await waitFor(() => expect(api.openProject).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('tab', { name: 'Project' }))
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Project name').value).not.toBe(''))
    return api
  }

  it('offers Off and each level by name, and saves the choice as a depth', async () => {
    const api = await renderSettings({ timelineLevelLabels: ['Novel', 'Chapter', 'Scene'] })
    const select = screen.getByLabelText<HTMLSelectElement>('Manuscript row')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Off', 'Novel', 'Chapter', 'Scene'])
    expect(select.value).toBe('')

    await userEvent.selectOptions(select, 'Chapter')
    await userEvent.click(screen.getByRole('button', { name: 'Save project settings' }))
    await waitFor(() =>
      expect(api.saveProjectMeta).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({ manuscriptLevel: 1 })
      )
    )
  })

  it('keeps a level whose name was since removed selectable', async () => {
    await renderSettings({ timelineLevelLabels: ['Chapter', 'Scene'], manuscriptLevel: 3 })
    const select = screen.getByLabelText<HTMLSelectElement>('Manuscript row')
    expect(select.value).toBe('3')
    expect(select.selectedOptions[0].textContent).toBe('Level 4')
  })
})
