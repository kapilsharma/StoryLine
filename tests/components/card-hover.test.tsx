// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppApi, ProjectSnapshot } from '@shared/ipc'
import type { BoardNoteView } from '@shared/config'
import type { Note } from '@shared/types'
import App from '@renderer/App'
import { baseConfig, makeApi, makeSnapshot } from './test-utils'

/**
 * Card hover text (Issue #111): the tooltip on the board, and the field in the
 * fullscreen editor and the side panel that sets it. The frontmatter and the
 * tooltip's placement are covered in tests/unit/card-hover.test.ts.
 */

const HINT = 'Ana lies about the letter.\nSets up chapter 12.'

const full: Note = {
  id: 'the-hunt',
  uid: 'n_hunt',
  title: 'The Hunt',
  hover: HINT,
  body: 'Wolf tracks the pigs.'
}

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      colOrder: ['ch1', 'ch2'],
      cards: [
        { id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: 'n_hunt' },
        { id: 'c2', rowId: 'aeri', colStart: 'ch2', colEnd: 'ch2', noteUid: 'n_bare' }
      ]
    },
    characters: [{ id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e' }],
    timeline: [
      { id: 'ch1', label: 'Chapter 1', order: 1 },
      { id: 'ch2', label: 'Chapter 2', order: 2 }
    ],
    notes: [
      { ...full, body: '', hasBody: true },
      { id: 'bare', uid: 'n_bare', title: 'No Hint', body: '' }
    ]
  })

async function boot({
  view = 'popup',
  readOnly = false,
  note = full
}: { view?: BoardNoteView; readOnly?: boolean; note?: Note } = {}): Promise<AppApi> {
  const snap = snapshot()
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    getNote: vi.fn().mockResolvedValue(note),
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

describe('hover tooltip on the board', () => {
  it('shows the hover text after a short rest, line breaks kept, and hides it on leave', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    const card = cardFor('The Hunt')

    fireEvent.mouseEnter(card)
    // Not instantly — sweeping across the board must not flash a tip per card.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toBe(HINT)
    expect(tip).toHaveClass('card-hover-tip')

    fireEvent.mouseLeave(card)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('never shows if the mouse leaves before the delay', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    const card = cardFor('The Hunt')
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('hides when the card is pressed', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    const card = cardFor('The Hunt')
    fireEvent.mouseEnter(card)
    await screen.findByRole('tooltip')
    fireEvent.pointerDown(card)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows nothing for a card without hover text', async () => {
    await boot()
    await screen.findByText('No Hint', { exact: false })
    fireEvent.mouseEnter(cardFor('No Hint'))
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('stays hidden on a masked card in revision mode', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    await userEvent.click(screen.getByTitle(/revision mode/i))
    await waitFor(() => expect(document.querySelectorAll('.board-card.masked')).toHaveLength(2))

    fireEvent.mouseEnter(document.querySelector('.board-card.masked')!)
    await new Promise((r) => setTimeout(r, 600))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('hover text indicator (#116)', () => {
  it('marks a card that has hover text with ℹ️, and only that card', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    const icon = cardFor('The Hunt').querySelector('.card-hover-icon')
    expect(icon).toHaveTextContent('ℹ️')
    expect(icon).toHaveAttribute('aria-label', 'Has hover text')
    expect(cardFor('No Hint').querySelector('.card-hover-icon')).toBeNull()
  })

  it('keeps the title free of it — the title still reads as before', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    expect(cardFor('The Hunt').querySelector('.card-title')?.textContent).not.toContain('ℹ️')
  })

  it('is hidden on a masked card in revision mode', async () => {
    await boot()
    await screen.findByText('The Hunt', { exact: false })
    await userEvent.click(screen.getByTitle(/revision mode/i))
    await waitFor(() => expect(document.querySelectorAll('.board-card.masked')).toHaveLength(2))
    expect(document.querySelector('.card-hover-icon')).toBeNull()
  })
})

describe('hover text field', () => {
  it('popup: shows the hover text read-only', async () => {
    await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    await screen.findByRole('button', { name: 'Edit' })
    expect(document.querySelector('.note-hover-text')?.textContent).toContain(HINT)
  })

  it('side panel: loads it and autosaves an edit', async () => {
    const api = await boot({ view: 'panel' })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Hover text')
    await waitFor(() => expect(field.value).toBe(HINT))

    await userEvent.clear(field)
    await userEvent.type(field, '  Foreshadows the fire.  ')
    await waitFor(
      () =>
        expect(api.saveNote).toHaveBeenCalledWith(
          '/project',
          'main',
          expect.objectContaining({ id: 'the-hunt', hover: 'Foreshadows the fire.' })
        ),
      { timeout: 2000 }
    )
  })

  it('side panel: clearing it removes the hover text', async () => {
    const api = await boot({ view: 'panel' })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Hover text')
    await waitFor(() => expect(field.value).toBe(HINT))

    await userEvent.clear(field)
    await waitFor(
      () =>
        expect(api.saveNote).toHaveBeenCalledWith(
          '/project',
          'main',
          expect.objectContaining({ id: 'the-hunt', hover: undefined })
        ),
      { timeout: 2000 }
    )
  })

  it('fullscreen editor: loads it and autosaves an edit', async () => {
    const api = await boot()
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>('Hover text')
    await waitFor(() => expect(field.value).toBe(HINT))

    await userEvent.type(field, ' Twist.')
    await waitFor(
      () =>
        expect(api.saveNote).toHaveBeenCalledWith(
          '/project',
          'main',
          expect.objectContaining({ id: 'the-hunt', hover: `${HINT} Twist.` })
        ),
      { timeout: 2000 }
    )
  })

  it('read-only panel: shows the text, offers no field', async () => {
    await boot({ view: 'panel', readOnly: true })
    await userEvent.click(await screen.findByText('The Hunt', { exact: false }))
    await waitFor(() =>
      expect(document.querySelector('.note-panel .note-hover-text')?.textContent).toContain(HINT)
    )
    expect(screen.queryByLabelText('Hover text')).not.toBeInTheDocument()
  })
})
