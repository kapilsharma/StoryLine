// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectSnapshot } from '@shared/ipc'
import { SCHEMA_VERSION } from '@shared/types'
import { GROUP_GLOBAL, type GroupManifest } from '@shared/projectGroup'
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
    lastOpened: '2026-08-10',
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
        rowOrder: ['aeri'],
        rowGroupOrder: ['aeri'],
        colOrder: ['ch1'],
        collapsedRowGroups: [],
        collapsedColGroups: [],
        zoom: 1,
        members: null,
        views: [],
      },
      characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
      timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
      notes: [],
      views: [],
      problems: []
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

describe('credit footer (issue #89)', () => {
  it('links to the ZN Story Line repo on a published build', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    await screen.findByText('My Novel')
    const credit = screen.getByRole('link', { name: 'Built by Zoey Nyxx Story Line' })
    expect(credit).toHaveAttribute('href', 'https://github.com/kapilsharma/StoryLine')
  })

  it('is absent from the desktop build', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.queryByRole('link', { name: 'Built by Zoey Nyxx Story Line' })).not.toBeInTheDocument()
  })
})

describe('project group dropdown (issue #86)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[GROUP_GLOBAL]
  })

  function setGroup(manifest: GroupManifest): void {
    ;(window as unknown as Record<string, unknown>)[GROUP_GLOBAL] = manifest
  }

  it('is absent for an ungrouped export', async () => {
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('is absent for a single-member group', async () => {
    setGroup({ name: 'Solo', members: [{ name: 'My Novel', folder: 'my-novel' }] })
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('lists every member and marks the current one selected', async () => {
    setGroup({
      name: 'My Story Universe',
      members: [
        { name: 'My Novel', folder: 'my-novel' },
        { name: 'Dracula', folder: 'dracula' }
      ]
    })
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App readOnly bootRoot="/" />)

    await screen.findByRole('heading', { name: 'My Novel' })
    expect(screen.getByText('My Story Universe')).toBeInTheDocument()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('my-novel')
    expect(screen.getByRole('option', { name: 'Dracula' })).toBeInTheDocument()
  })

  it('never appears on the desktop build', async () => {
    setGroup({
      name: 'My Story Universe',
      members: [
        { name: 'My Novel', folder: 'my-novel' },
        { name: 'Dracula', folder: 'dracula' }
      ]
    })
    makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    render(<App bootRoot="/" />)

    await screen.findByText('My Novel')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
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
