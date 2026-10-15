// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppApi, ProjectSnapshot } from '@shared/ipc'
import type { AppSettings } from '@shared/config'
import type { Note } from '@shared/types'
import App from '@renderer/App'
import { baseConfig, makeApi, makeSnapshot } from './test-utils'

/**
 * Card % complete (Issue #165): the bar along the bottom of a card, and the
 * dropdown after the status in the popup and the side panel. Parsing and
 * frontmatter are in tests/unit/card-progress.test.ts.
 */

const full: Note = {
  id: 'the-hunt',
  uid: 'n_hunt',
  title: 'The Hunt',
  progress: 40,
  body: 'Wolf tracks the pigs.'
}

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      colOrder: ['ch1', 'ch2', 'ch3'],
      cards: [
        { id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_hunt' },
        { id: 'c2', rowId: 'aeri', colStart: 'ch2', colEnd: 'ch2', noteUid: 'n_bare' },
        { id: 'c3', rowId: 'aeri', colStart: 'ch3', colEnd: 'ch3', noteUid: 'n_zero' }
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
      { id: 'bare', uid: 'n_bare', title: 'Not Tracked', body: '' },
      { id: 'zero', uid: 'n_zero', title: 'Not Begun', progress: 0, body: '' }
    ]
  })

async function boot({
  readOnly = false,
  settings = {},
  note = full
}: { readOnly?: boolean; settings?: Partial<AppSettings>; note?: Note } = {}): Promise<AppApi> {
  const snap = snapshot()
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    getNote: vi.fn().mockResolvedValue(note),
    saveNote: vi.fn().mockResolvedValue(snap),
    getConfig: vi.fn().mockResolvedValue({
      recents: [],
      settings: { ...baseConfig.settings, ...settings }
    })
  })
  render(<App readOnly={readOnly} bootRoot={snap.root} />)
  await screen.findByText('My Novel')
  return api
}

async function cardFor(title: string): Promise<HTMLElement> {
  const el = (await screen.findByText(title, { exact: false })).closest('.board-card')
  if (!el) throw new Error(`no card for ${title}`)
  return el as HTMLElement
}

describe('% complete bar', () => {
  it('marks a tracked card and passes its value to the CSS bar', async () => {
    await boot()
    const card = await cardFor('The Hunt')
    expect(card).toHaveClass('has-progress')
    expect(card.style.getPropertyValue('--pct')).toBe('40%')
    // Drawn by ::after — the card gains no element for it.
    expect(card.querySelector('[class*="progress"]')).toBeNull()
  })

  it('draws a 0% bar, but none for a card that is not tracked', async () => {
    await boot()
    expect((await cardFor('Not Begun')).style.getPropertyValue('--pct')).toBe('0%')
    const bare = await cardFor('Not Tracked')
    expect(bare).not.toHaveClass('has-progress')
    expect(bare.style.getPropertyValue('--pct')).toBe('')
  })

  it('takes its colours from Settings', async () => {
    await boot({ settings: { progressColorStart: '#111111', progressColorEnd: '#222222' } })
    await cardFor('The Hunt')
    const grid = document.querySelector('.board-grid') as HTMLElement
    expect(grid.style.getPropertyValue('--progress-0')).toBe('#111111')
    expect(grid.style.getPropertyValue('--progress-100')).toBe('#222222')
  })
})

describe('% complete dropdown', () => {
  it('popup: sits beside the status and saves a change onto the full note', async () => {
    const api = await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('% complete')
    expect(select.value).toBe('40')
    expect(select.closest('.card-meta-row')?.querySelector('.card-status-select')).not.toBeNull()

    await userEvent.selectOptions(select, '70')
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith('/project', 'main', { ...full, progress: 70 })
    )
  })

  it('popup: "Not tracked" removes the value', async () => {
    const api = await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    await userEvent.selectOptions(await screen.findByLabelText('% complete'), '')
    await waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith('/project', 'main', { ...full, progress: undefined })
    )
  })

  it('side panel: saves at once, keeping the body', async () => {
    const api = await boot({ settings: { boardNoteView: 'panel' } })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('% complete')
    await waitFor(() => expect(select.value).toBe('40'))

    await userEvent.selectOptions(select, '100')
    expect(api.saveNote).toHaveBeenCalledWith(
      '/project',
      'main',
      expect.objectContaining({ id: 'the-hunt', progress: 100, body: full.body })
    )
  })

  it('keeps a hand-written off-step value as its own option', async () => {
    await boot({ settings: { boardNoteView: 'panel' }, note: { ...full, progress: 35 } })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const select = await screen.findByLabelText<HTMLSelectElement>('% complete')
    await waitFor(() => expect(select.value).toBe('35'))
  })

  it('is disabled in a published export', async () => {
    await boot({ readOnly: true })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    expect(await screen.findByLabelText('% complete')).toBeDisabled()
  })
})

describe('% complete colours in Settings', () => {
  it('shows the saved colours and resets both to the defaults', async () => {
    const api = await boot({ settings: { progressColorStart: '#000000' } })
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByLabelText<HTMLInputElement>('Bar colour at 0%').value).toBe('#000000')

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        progressColorStart: baseConfig.settings.progressColorStart,
        progressColorEnd: baseConfig.settings.progressColorEnd
      })
    )
  })
})
