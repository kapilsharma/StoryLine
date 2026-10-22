// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ProjectSnapshot } from '@shared/ipc'
import type { MenuCommand, MenuState } from '@shared/menu'
import App from '@renderer/App'
import { resetMenuBridge } from '@renderer/lib/menuBridge'
import { baseConfig, makeApi, makeSnapshot } from './test-utils'

/**
 * The window's side of the app menu (Issue #168): it tells the main process
 * what the menu applies to, and a menu click runs the same action as the button
 * it stands for.
 */

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    project: { manuscriptLevel: 0 },
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      cards: [{ id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_hunt' }]
    },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
    notes: [{ id: 'the-hunt', uid: 'n_hunt', title: 'The Hunt', body: '' }]
  })

let send: (command: MenuCommand) => void = () => {}

async function renderApp(extra: Parameters<typeof makeApi>[0] = {}) {
  const snap = snapshot()
  const api = makeApi({
    getConfig: vi.fn().mockResolvedValue({
      ...baseConfig,
      recents: [{ name: 'My Novel', path: '/project', lastOpened: '2026-10-22' }]
    }),
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    saveBoard: vi.fn().mockResolvedValue(snap),
    onMenuCommand: vi.fn((listener: (c: MenuCommand) => void) => {
      send = listener
      return () => {}
    }),
    ...extra
  })
  render(<App bootRoot={snap.root} />)
  await screen.findByText('The Hunt', { exact: false })
  return api
}

/** Click a menu item, as the main process would report it. */
const click = (command: MenuCommand): void => act(() => send(command))

/** The last state the window reported. */
const lastState = (api: ReturnType<typeof makeApi>): MenuState => {
  const calls = (api.setMenuState as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1][0] as MenuState
}

beforeEach(() => resetMenuBridge())

describe('what the window tells the menu', () => {
  it('reports the open project, its tab and the board on screen', async () => {
    const api = await renderApp()
    await waitFor(() => expect(lastState(api).board).not.toBeNull())
    expect(lastState(api)).toMatchObject({
      project: true,
      readOnly: false,
      editorOpen: false,
      tab: 'boards',
      wordCount: true,
      rowsLabel: 'Characters',
      recents: [{ name: 'My Novel', path: '/project' }],
      board: {
        hasCards: true,
        manuscript: true,
        rowKinds: null,
        hasRowGroups: false,
        columnLevels: [],
        filtersOpen: false,
        revising: false
      }
    })
  })

  it('stops reporting a board once the Boards tab is left', async () => {
    const api = await renderApp()
    click({ id: 'go', tab: 'notes' })
    await waitFor(() => expect(lastState(api)).toMatchObject({ tab: 'notes', board: null }))
  })

  it('reports the dashboard after Back to Projects', async () => {
    const api = await renderApp()
    click({ id: 'file.close' })
    await waitFor(() => expect(lastState(api)).toMatchObject({ project: false, tab: null, board: null }))
    expect(await screen.findByText('Recent projects', { exact: false })).toBeInTheDocument()
  })
})

describe('menu commands run the same actions as the buttons', () => {
  it('Go switches tabs', async () => {
    await renderApp()
    click({ id: 'go', tab: 'characters' })
    expect(await screen.findByRole('heading', { name: 'Characters' })).toBeInTheDocument()
  })

  it('View › Filters opens the filter bar', async () => {
    await renderApp()
    click({ id: 'view.filters' })
    await waitFor(() => expect(document.querySelector('.board-filter-bar')).not.toBeNull())
  })

  it('View › Manuscript Row hides the row on this board', async () => {
    const api = await renderApp()
    click({ id: 'view.manuscript' })
    await waitFor(() =>
      expect(api.saveBoard).toHaveBeenCalledWith('/project', expect.objectContaining({ hideManuscriptRow: true }))
    )
  })

  it('View › Zoom In zooms the board, not the page', async () => {
    const api = await renderApp()
    click({ id: 'view.zoomIn' })
    await waitFor(() =>
      expect(api.saveBoard).toHaveBeenCalledWith('/project', expect.objectContaining({ zoom: 1.1 }))
    )
  })

  it('View › Word Count toggles the setting', async () => {
    const api = await renderApp()
    click({ id: 'view.wordCount' })
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ showWordCount: false }))
    )
  })

  it('Board › Revision Mode masks the cards', async () => {
    await renderApp()
    click({ id: 'board.revision' })
    await waitFor(() => expect(document.querySelector('.card-masked')).not.toBeNull())
  })

  it('Board › New Board asks for a name', async () => {
    await renderApp()
    click({ id: 'board.new' })
    expect(await screen.findByPlaceholderText('Board name')).toBeInTheDocument()
  })

  it('File › Export Board opens the export dialog', async () => {
    await renderApp()
    click({ id: 'file.exportBoard' })
    expect(await screen.findByText('Export board')).toBeInTheDocument()
  })

  it('File › Publish runs the export once, on the Settings tab', async () => {
    const api = await renderApp()
    click({ id: 'file.publish' })
    expect(await screen.findByRole('heading', { name: 'Publish' })).toBeInTheDocument()
    await waitFor(() => expect(api.exportStaticSite).toHaveBeenCalledTimes(1))

    // Coming back to Settings later must not publish again.
    click({ id: 'go', tab: 'boards' })
    click({ id: 'go', tab: 'settings' })
    await screen.findByRole('heading', { name: 'Publish' })
    expect(api.exportStaticSite).toHaveBeenCalledTimes(1)
  })

  it('File › Open Recent opens that project', async () => {
    const api = await renderApp()
    click({ id: 'file.close' })
    await screen.findByText('Recent projects', { exact: false })
    click({ id: 'file.openRecent', path: '/project' })
    await waitFor(() => expect(api.openProject).toHaveBeenCalledTimes(2))
  })
})
