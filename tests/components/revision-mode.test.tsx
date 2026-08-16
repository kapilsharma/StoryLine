// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Card, Character, Note, TimelineUnit } from '@shared/types'
import { BoardUiProvider, useBoardUi } from '@renderer/components/board/BoardUiContext'
import { BoardToolbar } from '@renderer/components/board/BoardToolbar'
import { BoardsView } from '@renderer/components/board/BoardsView'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/** Revision mode (Issue #67) — masking card titles and revealing them again. */

const characters: Character[] = [
  { id: 'phase-a', type: 'character', name: 'Phase A', colour: '#111' },
  { id: 'phase-b', type: 'character', name: 'Phase B', colour: '#222' }
]
const timeline: TimelineUnit[] = [
  { id: 'objectives', label: 'Objectives', order: 1 },
  { id: 'steps', label: 'Steps', order: 2 }
]
const notes: Note[] = [
  { id: 'n1', uid: 'n_1', title: '2 objectives', body: '' },
  { id: 'n2', uid: 'n_2', title: '11 steps', body: '' },
  { id: 'n3', uid: 'n_3', title: '9 steps', body: '' }
]
const cards: Card[] = [
  { id: 'c1', noteUid: 'n_1', rowId: 'phase-a', colStart: 'objectives', colEnd: 'objectives' },
  { id: 'c2', noteUid: 'n_2', rowId: 'phase-a', colStart: 'steps', colEnd: 'steps' },
  { id: 'c3', noteUid: 'n_3', rowId: 'phase-b', colStart: 'steps', colEnd: 'steps' }
]

const snapshot = makeSnapshot({
  board: { cards, members: ['phase-a', 'phase-b'], colOrder: ['objectives', 'steps'] },
  characters,
  timeline,
  notes
})

/** Render the board plus the toolbar inside one BoardUiProvider. */
async function renderBoard() {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
  renderWithProviders(
    <BoardUiProvider>
      <BoardToolbar />
      <BoardsView />
    </BoardUiProvider>,
    { bootRoot: '/project' }
  )
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  await screen.findByText('2 objectives')
  return api
}

const masked = (): Element[] => [...document.querySelectorAll('.board-card.masked')]
const revisionBtn = (): HTMLElement => screen.getByTitle(/revision mode|Leave revision mode/i)

describe('BoardUiContext revision state', () => {
  function Probe(): JSX.Element {
    const ui = useBoardUi()
    return (
      <div>
        <span data-testid="revising">{String(ui.revising)}</span>
        <span data-testid="revealed-a">{String(ui.isRevealed('a'))}</span>
        <button onClick={() => ui.registerCards(['a', 'b'])}>register</button>
        <button onClick={() => ui.setRevising(true)}>on</button>
        <button onClick={() => ui.setRevising(false)}>off</button>
        <button onClick={() => ui.toggleRevealed('a')}>toggle-a</button>
        <button onClick={() => ui.revealAll(true)}>all</button>
        <button onClick={() => ui.revealMany(['a'], true)}>many-a</button>
      </div>
    )
  }

  const setup = (): void => {
    render(
      <BoardUiProvider>
        <Probe />
      </BoardUiProvider>
    )
  }

  it('starts off, with nothing revealed', () => {
    setup()
    expect(screen.getByTestId('revising')).toHaveTextContent('false')
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('false')
  })

  it('turns on and off', async () => {
    setup()
    await userEvent.click(screen.getByText('on'))
    expect(screen.getByTestId('revising')).toHaveTextContent('true')
    await userEvent.click(screen.getByText('off'))
    expect(screen.getByTestId('revising')).toHaveTextContent('false')
  })

  it('toggles a single card both ways', async () => {
    setup()
    await userEvent.click(screen.getByText('toggle-a'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('true')
    await userEvent.click(screen.getByText('toggle-a'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('false')
  })

  it('reveals a named subset', async () => {
    setup()
    await userEvent.click(screen.getByText('many-a'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('true')
  })

  it('reveals everything registered', async () => {
    setup()
    await userEvent.click(screen.getByText('register'))
    await userEvent.click(screen.getByText('all'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('true')
  })

  it('re-entering revision mode hides everything again', async () => {
    setup()
    await userEvent.click(screen.getByText('toggle-a'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('true')
    // Otherwise the first thing a drill shows you is the answers.
    await userEvent.click(screen.getByText('on'))
    expect(screen.getByTestId('revealed-a')).toHaveTextContent('false')
  })
})

describe('revision mode on the board', () => {
  it('shows card titles normally when off', async () => {
    await renderBoard()
    expect(masked()).toHaveLength(0)
    expect(screen.getByText('2 objectives')).toBeInTheDocument()
  })

  it('masks every card when turned on', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(3))
    expect(screen.queryByText('2 objectives')).not.toBeInTheDocument()
  })

  it('reveals one card on click, leaving the rest hidden', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(3))

    await userEvent.click(masked()[0])
    await waitFor(() => expect(masked()).toHaveLength(2))
  })

  it('reveals a whole column from its header', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(3))

    // Two cards sit in the Steps column.
    await userEvent.click(screen.getByText('Steps'))
    await waitFor(() => expect(masked()).toHaveLength(1))
  })

  it('re-hides a fully revealed column when its header is clicked again', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await userEvent.click(screen.getByText('Steps'))
    await waitFor(() => expect(masked()).toHaveLength(1))
    await userEvent.click(screen.getByText('Steps'))
    await waitFor(() => expect(masked()).toHaveLength(3))
  })

  it('reveals and re-hides everything from the toolbar', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(3))

    await userEvent.click(screen.getByTitle('Reveal every card'))
    await waitFor(() => expect(masked()).toHaveLength(0))

    await userEvent.click(screen.getByTitle('Hide every card again'))
    await waitFor(() => expect(masked()).toHaveLength(3))
  })

  it('hides the reveal/hide-all buttons when not revising', async () => {
    await renderBoard()
    expect(screen.queryByTitle('Reveal every card')).not.toBeInTheDocument()
    await userEvent.click(revisionBtn())
    expect(await screen.findByTitle('Reveal every card')).toBeInTheDocument()
  })

  it('restores every title when revision mode is switched off', async () => {
    await renderBoard()
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(3))
    await userEvent.click(revisionBtn())
    await waitFor(() => expect(masked()).toHaveLength(0))
    expect(screen.getByText('2 objectives')).toBeInTheDocument()
  })
})
