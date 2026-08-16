// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION } from '@shared/types'
import App from '@renderer/App'
import { makeApi } from './test-utils'

/**
 * The character-note popup on the board (Issue 41). Aeri has a note, Bran does
 * not — which is the whole point of the marker: only a row with something to
 * show is clickable.
 */

const snapshot: ProjectSnapshot = {
  root: '/tmp/project',
  project: {
    schemaVersion: SCHEMA_VERSION,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: '2026-08-01',
    lastOpened: '2026-08-11',
    families: {}
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
        rowOrder: ['aeri', 'bran'],
        rowGroupOrder: ['aeri', 'bran'],
        colOrder: ['ch1'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        members: null,
        views: [],
      },
      characters: [
        { id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e', hasNote: true },
        { id: 'bran', type: 'character', name: 'Bran', colour: '#e24b4a' }
      ],
      timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
      notes: [],
      views: [],
      problems: []
    }
  ]
}

const NOTE = '## Notes\n\nQuiet, precise.\n'

async function bootBoard({ readOnly = false }: { readOnly?: boolean } = {}): Promise<void> {
  makeApi({
    openProject: vi.fn().mockResolvedValue(snapshot),
    reloadProject: vi.fn().mockResolvedValue(snapshot),
    getEntityBody: vi.fn().mockResolvedValue(NOTE)
  })
  render(<App readOnly={readOnly} bootRoot={snapshot.root} />)
  await screen.findByText('My Novel')
}

describe('the board’s character note popup', () => {
  it('makes only a character with a note clickable', async () => {
    await bootBoard()
    expect(screen.getByTitle('Read Aeri’s note')).toBeInTheDocument()
    expect(screen.queryByTitle('Read Bran’s note')).not.toBeInTheDocument()
    // Bran is still on the board — just not a button.
    expect(screen.getByText('Bran')).toBeInTheDocument()
  })

  it('previews the note, read-only, and closes on Escape', async () => {
    await bootBoard()
    await userEvent.click(screen.getByTitle('Read Aeri’s note'))

    const dialog = await screen.findByText('Quiet, precise.')
    expect(dialog).toBeInTheDocument()
    // A preview, not an editor.
    expect(screen.queryByPlaceholderText('Write in Markdown…')).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Quiet, precise.')).not.toBeInTheDocument())
  })

  it('sends Edit to the Characters tab with the character selected', async () => {
    await bootBoard()
    await userEvent.click(screen.getByTitle('Read Aeri’s note'))
    await screen.findByText('Quiet, precise.')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    // The Characters tab, showing Aeri's form and its note column (Issue 33).
    const tab = screen.getByRole('button', { name: 'Characters' })
    await waitFor(() => expect(tab.className).toContain('active'))
    expect(await screen.findByDisplayValue('Aeri')).toBeInTheDocument()
    const notes = await screen.findByRole('button', { name: 'Edit note' })
    expect(within(notes.closest('section') as HTMLElement).getByText('Quiet, precise.')).toBeInTheDocument()
  })

  it('offers no Edit in a published export', async () => {
    await bootBoard({ readOnly: true })
    await userEvent.click(screen.getByTitle('Read Aeri’s note'))
    await screen.findByText('Quiet, precise.')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
