// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION } from '@shared/types'
import App from '@renderer/App'
import { makeApi } from './test-utils'

const snapshot: ProjectSnapshot = {
  root: '/',
  project: {
    schemaVersion: SCHEMA_VERSION,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: '2026-08-01',
    lastOpened: '2026-08-10'
  },
  boards: [
    {
      board: {
        id: 'main',
        name: 'Main Board',
        cards: [],
        hiddenRows: [],
        hiddenCols: [],
        presets: [],
        rowOrder: ['aeri'],
        rowGroupOrder: ['aeri'],
        colOrder: ['ch1'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1
      },
      characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
      timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
      notes: []
    }
  ]
}

describe('published (read-only) build', () => {
  it('boots straight into the bundled project, no dashboard', async () => {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    expect(await screen.findByText('My Novel')).toBeInTheDocument()
    expect(api.openProject).toHaveBeenCalledWith('/')
    // The dashboard's actions must never appear in a published export.
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
  })

  it('shows the read-only notice and hides the way back to the dashboard', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.getByText(/Read-only preview/)).toBeInTheDocument()
    expect(screen.getByText(/nothing you change here is saved/)).toBeInTheDocument()
    expect(screen.queryByTitle('Back to dashboard')).not.toBeInTheDocument()
  })

  it('keeps the notice out of the desktop build', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.queryByText(/Read-only preview/)).not.toBeInTheDocument()
    expect(screen.getByTitle('Back to dashboard')).toBeInTheDocument()
  })
})

describe('error toast', () => {
  it('reports a failure that used to be silent outside the dashboard', async () => {
    makeApi({ openProject: vi.fn().mockRejectedValue(new Error('Board is published read-only')) })
    render(<App bootRoot="/" />)

    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Board is published read-only')
  })

  it('can be dismissed', async () => {
    makeApi({ openProject: vi.fn().mockRejectedValue(new Error('Nope')) })
    render(<App bootRoot="/" />)

    await screen.findByRole('status')
    await userEvent.click(screen.getByTitle('Dismiss'))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
