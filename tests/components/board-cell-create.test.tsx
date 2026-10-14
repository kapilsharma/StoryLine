// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSnapshot } from '@shared/ipc'
import App from '@renderer/App'
import { makeApi, makeSnapshot } from './test-utils'

/**
 * Empty-cell clicks are delegated to the grid container (#133) rather than bound
 * per cell. This guards that the click still finds its row/column (from the
 * cell's data attributes) and starts the create flow.
 */
const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      colOrder: ['ch1', 'ch2'],
      // A card only in ch1 — so (aeri, ch2) is an empty cell to click.
      cards: [{ id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_hunt' }]
    },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    timeline: [
      { id: 'ch1', label: 'Chapter 1', order: 1 },
      { id: 'ch2', label: 'Chapter 2', order: 2 }
    ],
    notes: [{ id: 'the-hunt', uid: 'n_hunt', title: 'The Hunt', body: '' }]
  })

describe('empty-cell click (delegated to the grid, #133)', () => {
  it('creates a card in the clicked row and column', async () => {
    const snap = snapshot()
    const api = makeApi({
      openProject: vi.fn().mockResolvedValue(snap),
      reloadProject: vi.fn().mockResolvedValue(snap),
      createCard: vi.fn().mockResolvedValue(snap)
    })
    render(<App bootRoot={snap.root} />)
    await screen.findByText('My Novel')

    const cell = document.querySelector('.cell[data-row="aeri"][data-col="ch2"]')
    expect(cell).toBeTruthy()
    fireEvent.click(cell!)

    // The delegated handler ran: it opened the "New card" prompt.
    const input = await screen.findByPlaceholderText('Card title')
    await userEvent.type(input, 'New scene{Enter}')

    await waitFor(() =>
      expect(api.createCard).toHaveBeenCalledWith(
        '/project',
        expect.objectContaining({
          boardId: 'main',
          rowId: 'aeri',
          colStart: 'ch2',
          colEnd: 'ch2',
          title: 'New scene'
        })
      )
    )
  })

  it('does not start a create when a cell already holds a card', async () => {
    const snap = snapshot()
    const api = makeApi({
      openProject: vi.fn().mockResolvedValue(snap),
      reloadProject: vi.fn().mockResolvedValue(snap)
    })
    render(<App bootRoot={snap.root} />)
    await screen.findByText('The Hunt', { exact: false })

    // Clicking the card opens its note; it must not fall through to cell-create.
    fireEvent.click(screen.getByText('The Hunt', { exact: false }))
    expect(screen.queryByPlaceholderText('Card title')).not.toBeInTheDocument()
    expect(api.createCard).not.toHaveBeenCalled()
  })
})
