// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BoardData, ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION } from '@shared/types'
import { CharacterEditor } from '@renderer/components/CharacterEditor'
import { makeApi, renderWithProviders } from './test-utils'

/**
 * The notes column of the Characters tab (Issue 33). Covers what the column
 * offers for a character with and without a note — the 15/33/50 split itself is
 * CSS, which jsdom cannot measure.
 */

const board: BoardData = {
  board: {
    id: 'main',
    name: 'Main Board',
    cards: [],
    hiddenRows: [],
    hiddenCols: [],
    presets: [],
    rowOrder: ['aeri'],
    rowGroupOrder: [],
    colOrder: [],
    collapsedRowGroups: [],
    collapsedColGroups: [],
    zoom: 1
  },
  characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#00ff00' }],
  timeline: [],
  notes: [],
  views: [],
  problems: []
}

const snapshot: ProjectSnapshot = {
  root: '/tmp/project',
  project: {
    schemaVersion: SCHEMA_VERSION,
    name: 'My Novel',
    timelineLabel: 'Chapter',
    boards: ['main'],
    created: '2026-08-01',
    lastOpened: '2026-08-11'
  },
  boards: [board]
}

/** Render the Characters tab with `body` behind the selected character. */
async function openCharacter(
  body: string,
  { readOnly = false }: { readOnly?: boolean } = {}
): Promise<ReturnType<typeof makeApi>> {
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snapshot),
    reloadProject: vi.fn().mockResolvedValue(snapshot),
    getEntityBody: vi.fn().mockResolvedValue(body),
    saveEntityBody: vi.fn().mockResolvedValue(snapshot)
  })
  renderWithProviders(<CharacterEditor />, { readOnly, bootRoot: snapshot.root })
  await waitFor(() => expect(screen.getByRole('button', { name: /Aeri/ })).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /Aeri/ }))
  return api
}

describe('the Characters tab notes column', () => {
  it('offers "Add note" when nothing has been written', async () => {
    await openCharacter('')
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeInTheDocument()
  })

  it('treats a file carrying only the old skeleton as having no note', async () => {
    await openCharacter('\n## Notes\n\n\n## Research\n\n')
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeInTheDocument()
    // The empty headings are not shown as if they were content.
    expect(screen.queryByRole('heading', { name: 'Research' })).not.toBeInTheDocument()
  })

  it('starts an empty editor from "Add note"', async () => {
    await openCharacter('\n## Notes\n\n\n## Research\n\n')
    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }))
    const textarea = screen.getByPlaceholderText('Write in Markdown…')
    expect(textarea).toHaveValue('')
  })

  it('previews an existing note, and edits it in place', async () => {
    const api = await openCharacter('## Notes\n\nQuiet, precise.\n')
    expect(await screen.findByText('Quiet, precise.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByPlaceholderText('Write in Markdown…')
    expect(textarea).toHaveValue('## Notes\n\nQuiet, precise.\n')

    await userEvent.type(textarea, ' Watchful.')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(api.saveEntityBody).toHaveBeenCalledWith(
        '/tmp/project',
        'main',
        'character',
        'aeri',
        '## Notes\n\nQuiet, precise.\n Watchful.'
      )
    )
    // Back to the preview, showing what was typed.
    expect(screen.getByText(/Watchful\./)).toBeInTheDocument()
  })

  it('is read-only in a published export', async () => {
    await openCharacter('## Notes\n\nQuiet, precise.\n', { readOnly: true })
    expect(await screen.findByText('Quiet, precise.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument()
  })

  it('says nothing can be written until the character exists', async () => {
    makeApi({
      openProject: vi.fn().mockResolvedValue(snapshot),
      reloadProject: vi.fn().mockResolvedValue(snapshot)
    })
    renderWithProviders(<CharacterEditor />, { bootRoot: snapshot.root })
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '+ Add' }))
    expect(screen.getByText('Create the character to write its note.')).toBeInTheDocument()
  })
})
