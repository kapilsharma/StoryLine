// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppApi, ProjectSnapshot } from '@shared/ipc'
import type { BoardNoteView } from '@shared/config'
import type { Note, Project } from '@shared/types'
import App from '@renderer/App'
import { baseConfig, makeApi, makeSnapshot } from './test-utils'

/**
 * Card status (Issue #108): the icon at the left of a card, and the dropdown in
 * the popup and the side panel that sets it. The list itself — defaults,
 * editing, saving — is covered in project-settings.test.tsx and
 * tests/unit/card-status.test.ts.
 */

const full: Note = {
  id: 'the-hunt',
  uid: 'n_hunt',
  title: 'The Hunt',
  status: 'draft',
  body: 'Wolf tracks the pigs.'
}

const snapshot = (project: Partial<Project> = {}): ProjectSnapshot =>
  makeSnapshot({
    project,
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      colOrder: ['ch1', 'ch2', 'ch3'],
      cards: [
        { id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_hunt' },
        { id: 'c2', rowId: 'aeri', colStart: 'ch2', colEnd: 'ch2', noteUid: 'n_bare' },
        { id: 'c3', rowId: 'aeri', colStart: 'ch3', colEnd: 'ch3', noteUid: 'n_gone' }
      ]
    },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    timeline: [
      { id: 'ch1', label: 'Chapter 1', order: 1 },
      { id: 'ch2', label: 'Chapter 2', order: 2 },
      { id: 'ch3', label: 'Chapter 3', order: 3 }
    ],
    notes: [
      { ...full, body: '', hasBody: true },
      { id: 'bare', uid: 'n_bare', title: 'No Status Yet', body: '' },
      { id: 'gone', uid: 'n_gone', title: 'Old Status', status: 'retired', body: '' }
    ]
  })

async function boot({
  view = 'popup',
  readOnly = false,
  project = {}
}: { view?: BoardNoteView; readOnly?: boolean; project?: Partial<Project> } = {}): Promise<AppApi> {
  const snap = snapshot(project)
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    getNote: vi.fn().mockResolvedValue(full),
    saveNote: vi.fn().mockResolvedValue(snap),
    getConfig: vi.fn().mockResolvedValue({
      recents: [],
      settings: { ...baseConfig.settings, boardNoteView: view }
    })
  })
  render(<App readOnly={readOnly} bootRoot={snap.root} />)
  await screen.findByText('My Novel')
  return api
}

function cardFor(title: string): HTMLElement {
  const el = screen.getByText(title, { exact: false }).closest('.board-card')
  if (!el) throw new Error(`no card for ${title}`)
  return el as HTMLElement
}

describe('card status icon', () => {
  it('shows the status icon first, before the 📝, with its meaning as a tooltip', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    const card = cardFor('The Hunt')
    expect(card.textContent).toMatch(/^🌓\s*📝/)
    expect(card.querySelector('.card-status-icon')).toHaveAttribute('title', 'Draft started')
  })

  it('shows nothing for no status, or a status the project no longer defines', async () => {
    await boot()
    await screen.findByText('No Status Yet', { exact: false })
    expect(cardFor('No Status Yet').querySelector('.card-status-icon')).toBeNull()
    expect(cardFor('Old Status').querySelector('.card-status-icon')).toBeNull()
  })

  it('uses the project’s own icons', async () => {
    await boot({ project: { cardStatuses: [{ id: 'draft', icon: '✍️', label: 'Writing' }] } })
    await screen.findByText('The Hunt', { exact: false })
    expect(cardFor('The Hunt').textContent).toContain('✍️')
    expect(cardFor('The Hunt').textContent).not.toContain('🌓')
  })
})

describe('status dropdown', () => {
  it('popup: shows the current status and saves a change onto the full note', async () => {
    const api = await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('Status')
    expect(select.value).toBe('draft')

    await userEvent.selectOptions(select, 'done')
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith('/project', 'main', { ...full, status: 'done' })
    )
  })

  it('popup: clearing the status removes it', async () => {
    const api = await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    await userEvent.selectOptions(await screen.findByLabelText('Status'), '')
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith('/project', 'main', { ...full, status: undefined })
    )
  })

  it('keeps an undefined status as an option rather than showing it as none', async () => {
    await boot()
    await userEvent.click(await screen.findByText('Old Status', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('Status')
    expect(select.value).toBe('retired')
    expect(screen.getByRole('option', { name: /retired \(no longer defined\)/ })).toBeInTheDocument()
  })

  it('side panel: saves at once, without waiting for the autosave', async () => {
    const api = await boot({ view: 'panel' })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('Status')
    await waitFor(() => expect(select.value).toBe('draft'))

    await userEvent.selectOptions(select, 'stuck')
    expect(api.saveNote).toHaveBeenCalledWith(
      '/project',
      'main',
      expect.objectContaining({ id: 'the-hunt', status: 'stuck', body: full.body })
    )
  })

  it('is disabled in a published export', async () => {
    await boot({ readOnly: true })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    expect(await screen.findByLabelText('Status')).toBeDisabled()
  })

  it('is hidden when the project has no statuses', async () => {
    await boot({ project: { cardStatuses: [] } })
    await userEvent.click(await screen.findByText('No Status Yet', { exact: false }))
    await screen.findByRole('button', { name: 'Edit' })
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })
})
