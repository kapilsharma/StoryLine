// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Note } from '@shared/types'
import { NotePopup } from '@renderer/components/NotePopup'
import { makeApi, renderWithProviders } from './test-utils'

const note: Note = {
  id: 'hunt',
  uid: 'n_abc12345',
  title: 'The Hunt',
  tags: ['wolf', 'tension'],
  related: [],
  body: 'Wolf tracks the **three pigs** through the forest.'
}

beforeEach(() => {
  makeApi({ getNote: vi.fn().mockResolvedValue(note) })
})

describe('NotePopup (read-only preview since v0.4.0)', () => {
  it('renders title, tags and the lazily-loaded markdown body', async () => {
    renderWithProviders(<NotePopup note={note} onClose={() => {}} onOpenNote={() => {}} />)
    expect(screen.getByText('The Hunt')).toBeInTheDocument()
    expect(screen.getByText('wolf')).toBeInTheDocument()
    const strong = await screen.findByText('three pigs')
    expect(strong.tagName).toBe('STRONG')
  })

  it('shows Edit / Rename file / Close and no external-editor buttons', () => {
    renderWithProviders(<NotePopup note={note} onClose={() => {}} onOpenNote={() => {}} />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Rename file')).toBeInTheDocument()
    expect(screen.getByText('Close')).toBeInTheDocument()
    expect(screen.queryByText('Edit in VS Code')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit in Obsidian')).not.toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<NotePopup note={note} onClose={onClose} onOpenNote={() => {}} />)
    await userEvent.click(screen.getByText('Close'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
