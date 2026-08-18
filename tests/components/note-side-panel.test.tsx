// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppApi, ProjectSnapshot } from '@shared/ipc'
import type { AppSettings } from '@shared/config'
import type { Note } from '@shared/types'
import App from '@renderer/App'
import { baseConfig, makeApi, makeSnapshot } from './test-utils'

/**
 * The note beside the board (Issue #83) — the optional side panel and the
 * live-preview editing inside it. The popup it sits alongside is covered by
 * `NotePopup.test.tsx` and `character-note-popup.test.tsx`; the choice between
 * them is at the bottom of this file.
 *
 * Driven through `App` rather than by rendering the panel directly, because half
 * of what this adds is *where* it opens from: a card, a row header, and the board
 * that has to stay visible next to it.
 */

const NOTE_UID = 'n_hunt0001'

const note: Note = {
  id: 'the-hunt',
  uid: NOTE_UID,
  title: 'The Hunt',
  tags: ['wolf'],
  related: [],
  body: 'Wolf tracks the pigs.\n\nSecond paragraph.'
}

const snapshot = (): ProjectSnapshot =>
  makeSnapshot({
    board: {
      rowOrder: ['aeri'],
      rowGroupOrder: ['aeri'],
      colOrder: ['ch1'],
      cards: [{ id: 'c1', rowId: 'aeri', colStart: 'ch1', colEnd: 'ch1', noteUid: NOTE_UID }]
    },
    characters: [
      { id: 'aeri', type: 'character', name: 'Aeri', colour: '#22c55e', hasNote: true },
      { id: 'bran', type: 'character', name: 'Bran', colour: '#e24b4a' }
    ],
    timeline: [{ id: 'ch1', label: 'Chapter 1', order: 1 }],
    notes: [{ ...note, body: '', hasBody: true }]
  })

const CHAR_NOTE = 'Quiet, precise.'

/**
 * The panel is opt-in: the popup stays the default (#83), so every test here
 * boots with the setting the reader would have chosen.
 */
async function boot({
  readOnly = false,
  settings = {}
}: { readOnly?: boolean; settings?: Partial<AppSettings> } = {}): Promise<AppApi> {
  const snap = snapshot()
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snap),
    reloadProject: vi.fn().mockResolvedValue(snap),
    getNote: vi.fn().mockResolvedValue(note),
    getEntityBody: vi.fn().mockResolvedValue(CHAR_NOTE),
    saveNote: vi.fn().mockResolvedValue(snap),
    saveEntityBody: vi.fn().mockResolvedValue(snap),
    getConfig: vi.fn().mockResolvedValue({
      recents: [],
      settings: { ...baseConfig.settings, boardNoteView: 'panel', ...settings }
    })
  })
  render(<App readOnly={readOnly} bootRoot={snap.root} />)
  await screen.findByText('My Novel')
  return api
}

/** The panel, once open. */
const panel = (): HTMLElement => screen.getByRole('complementary', { name: 'Note' })

const openCardNote = async (): Promise<void> => {
  // Found rather than got: the board renders a tick after the project opens.
  await userEvent.click(await screen.findByText('The Hunt'))
  await screen.findByRole('complementary', { name: 'Note' })
}

describe('the board’s note side panel', () => {
  it('opens a card’s note beside the board, not over it', async () => {
    await boot()
    await openCardNote()

    // Rendered markdown, and the board still on screen next to it.
    expect(within(panel()).getByText('Wolf tracks the pigs.')).toBeInTheDocument()
    expect(document.querySelector('.board-grid')).toBeInTheDocument()
    expect(document.querySelector('.modal-overlay')).not.toBeInTheDocument()
  })

  it('opens a row header’s character note in the same panel', async () => {
    await boot()
    await userEvent.click(await screen.findByTitle('Read Aeri’s note'))
    expect(await within(panel()).findByText(CHAR_NOTE)).toBeInTheDocument()
    expect(within(panel()).getByText('characters/aeri.md')).toBeInTheDocument()
    // Only a character with a note is clickable at all (Issue #41).
    expect(screen.queryByTitle('Read Bran’s note')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    await boot()
    await openCardNote()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Note' })).not.toBeInTheDocument()
    )
  })

  it('turns the clicked block into its source and renders the rest', async () => {
    await boot()
    await openCardNote()
    await userEvent.click(within(panel()).getByText('Wolf tracks the pigs.'))

    const source = within(panel()).getByLabelText('Block source')
    expect(source).toHaveValue('Wolf tracks the pigs.')
    // The block being edited is the only one in source; its neighbour stays
    // rendered — that is the whole point of a live preview.
    expect(within(panel()).getByText('Second paragraph.')).toBeInTheDocument()
    expect(within(panel()).getAllByLabelText('Block source')).toHaveLength(1)
  })

  it('saves an edited block back into the whole note', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const api = await boot()
      await openCardNote()
      await userEvent.click(within(panel()).getByText('Second paragraph.'))
      await userEvent.type(within(panel()).getByLabelText('Block source'), ' Edited.')

      await vi.advanceTimersByTimeAsync(1000)
      await waitFor(() =>
        expect(api.saveNote).toHaveBeenCalledWith(
          '/project',
          'main',
          expect.objectContaining({
            id: 'the-hunt',
            body: 'Wolf tracks the pigs.\n\nSecond paragraph. Edited.'
          })
        )
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the block again on Escape, leaving the panel open', async () => {
    await boot()
    await openCardNote()
    await userEvent.click(within(panel()).getByText('Second paragraph.'))
    await userEvent.keyboard('{Escape}')

    await waitFor(() =>
      expect(within(panel()).queryByLabelText('Block source')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('complementary', { name: 'Note' })).toBeInTheDocument()
  })

  it('walks from one block to the next with the arrow keys', async () => {
    await boot()
    await openCardNote()
    await userEvent.click(within(panel()).getByText('Wolf tracks the pigs.'))
    // The click leaves the caret at the end of the block, so one Down is enough
    // to fall through into the next one — the panel behaves like one editor.
    await userEvent.keyboard('{ArrowDown}')

    expect(within(panel()).getByLabelText('Block source')).toHaveValue('Second paragraph.')
    expect(within(panel()).getByText('Wolf tracks the pigs.')).toBeInTheDocument()
  })

  it('applies a toolbar format to the open block only', async () => {
    await boot()
    await openCardNote()
    const source = within(panel()).getByText('Wolf tracks the pigs.')
    await userEvent.click(source)
    const textarea = within(panel()).getByLabelText('Block source') as HTMLTextAreaElement
    textarea.setSelectionRange(0, 4)
    await userEvent.click(within(panel()).getByRole('button', { name: 'Bold' }))

    expect(within(panel()).getByLabelText('Block source')).toHaveValue('**Wolf** tracks the pigs.')
  })

  it('offers no formatting until a block is open', async () => {
    await boot()
    await openCardNote()
    expect(within(panel()).getByRole('button', { name: 'Bold' })).toBeDisabled()
    await userEvent.click(within(panel()).getByText('Wolf tracks the pigs.'))
    expect(within(panel()).getByRole('button', { name: 'Bold' })).toBeEnabled()
  })

  it('edits a character note in place instead of sending you to another tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const api = await boot()
      await userEvent.click(await screen.findByTitle('Read Aeri’s note'))
      await within(panel()).findByText(CHAR_NOTE)
      await userEvent.click(within(panel()).getByText(CHAR_NOTE))
      await userEvent.type(within(panel()).getByLabelText('Block source'), ' Watchful.')

      await vi.advanceTimersByTimeAsync(1000)
      await waitFor(() =>
        expect(api.saveEntityBody).toHaveBeenCalledWith(
          '/project',
          'main',
          'character',
          'aeri',
          'Quiet, precise. Watchful.'
        )
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new block when the room below the note is clicked', async () => {
    await boot()
    await openCardNote()
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.click(panel().querySelector('.live-md-tail') as HTMLElement)

    const source = within(panel()).getByLabelText('Block source')
    expect(source).toHaveValue('')
    await userEvent.type(source, 'A third thought.')
    // Appended after a blank line, so it is its own paragraph rather than a
    // sentence glued onto the last one.
    expect(within(panel()).getByLabelText('Block source')).toHaveValue('A third thought.')
    expect(within(panel()).getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('takes the width the divider was last dragged to', async () => {
    await boot({ settings: { notePanelFraction: 0.35 } })
    await openCardNote()
    expect(panel().style.flexBasis).toBe('35%')
  })

  it('is read-only in a published export', async () => {
    await boot({ readOnly: true })
    await openCardNote()
    expect(within(panel()).getByText('Read-only', { exact: false })).toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Rename file' })).not.toBeInTheDocument()

    await userEvent.click(within(panel()).getByText('Wolf tracks the pigs.'))
    expect(within(panel()).queryByLabelText('Block source')).not.toBeInTheDocument()
  })
})

/**
 * Panel or popup is the reader's choice (#83). Neither view is going away, so
 * both routes off the same click are worth holding down.
 */
describe('choosing between the popup and the panel', () => {
  it('opens the popup by default, leaving the older behaviour untouched', async () => {
    await boot({ settings: { boardNoteView: 'popup' } })
    await userEvent.click(await screen.findByText('The Hunt'))

    expect(await screen.findByText('Wolf tracks the pigs.')).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access
    expect(document.querySelector('.note-popup')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Note' })).not.toBeInTheDocument()
    // The popup is a reader: editing is a button away, not a click into the text.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Block source')).not.toBeInTheDocument()
  })

  it('is the shipped default', () => {
    expect(baseConfig.settings.boardNoteView).toBe('popup')
  })

  it('switches to the panel when the setting is changed', async () => {
    const api = await boot({ settings: { boardNoteView: 'popup' } })
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await userEvent.selectOptions(
      screen.getByLabelText('Note opened from a board'),
      'Panel beside the board'
    )

    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ boardNoteView: 'panel' })
    )
  })
})
