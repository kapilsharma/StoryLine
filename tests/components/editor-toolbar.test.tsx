// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPage } from '@renderer/components/EditorPage'
import { useStore } from '@renderer/store'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The editor's formatting toolbar (Issue #72).
 *
 * The edits themselves are covered in `tests/unit/md-format.test.ts`; what is
 * checked here is the wiring — that a button acts on the textarea's *current*
 * selection, and that the heading dropdown reflects the line the caret is on.
 */

const snapshot = makeSnapshot({
  board: { id: 'main' },
  notes: [{ id: 'note-1', uid: 'n_1', title: 'A note', body: '' }]
})

function Harness(): JSX.Element {
  const { snapshot: snap } = useStore()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (snap) setReady(true)
  }, [snap])
  if (!ready) return <span>booting</span>
  return <EditorPage target={{ kind: 'note', boardId: 'main', id: 'note-1' }} />
}

async function renderEditor(body = '', readOnly = false) {
  const api = makeApi()
  Object.assign(api, {
    openProject: vi.fn().mockResolvedValue(snapshot),
    getNote: vi.fn().mockResolvedValue({ id: 'note-1', uid: 'n_1', title: 'A note', body })
  })
  ;(window as unknown as { api: typeof api }).api = api
  renderWithProviders(<Harness />, { bootRoot: '/project', readOnly })
  const textarea = (await screen.findByPlaceholderText('Write in Markdown…')) as HTMLTextAreaElement
  await waitFor(() => expect(textarea.value).toBe(body))
  return textarea
}

/** Select a range and tell React about it, the way a real caret move would. */
function select(textarea: HTMLTextAreaElement, start: number, end = start): void {
  textarea.setSelectionRange(start, end)
  fireEvent.select(textarea)
}

describe('formatting toolbar', () => {
  it('wraps the selected text in bold', async () => {
    const textarea = await renderEditor('say hello now')
    select(textarea, 4, 9)

    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))

    await waitFor(() => expect(textarea.value).toBe('say **hello** now'))
  })

  it('unwraps when the same button is clicked again', async () => {
    const textarea = await renderEditor('say **hello** now')
    select(textarea, 6, 11)

    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))

    await waitFor(() => expect(textarea.value).toBe('say hello now'))
  })

  it('offers highlight rather than underline, which Markdown has no syntax for', async () => {
    const textarea = await renderEditor('one two')
    expect(screen.queryByRole('button', { name: /underline/i })).not.toBeInTheDocument()
    select(textarea, 4, 7)

    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))

    await waitFor(() => expect(textarea.value).toBe('one ==two=='))
  })

  it('has an italic button', async () => {
    const textarea = await renderEditor('alpha beta')
    select(textarea, 0, 5)

    await userEvent.click(screen.getByRole('button', { name: 'Italic' }))

    await waitFor(() => expect(textarea.value).toBe('*alpha* beta'))
  })

  it('has a strikethrough button', async () => {
    const textarea = await renderEditor('alpha beta')
    select(textarea, 6, 10)

    await userEvent.click(screen.getByRole('button', { name: 'Strikethrough' }))

    await waitFor(() => expect(textarea.value).toBe('alpha ~~beta~~'))
  })

  it('sets the heading level of the line the caret is on', async () => {
    const textarea = await renderEditor('intro\nsecond line\ntail')
    select(textarea, 8)

    await userEvent.selectOptions(screen.getByLabelText('Heading level'), '2')

    await waitFor(() => expect(textarea.value).toBe('intro\n## second line\ntail'))
  })

  it('shows the level of the line the caret moves to, and can clear it', async () => {
    const textarea = await renderEditor('plain\n### deep\n')
    const dropdown = screen.getByLabelText('Heading level') as HTMLSelectElement
    expect(dropdown.value).toBe('0')

    select(textarea, 9)
    await waitFor(() => expect(dropdown.value).toBe('3'))

    await userEvent.selectOptions(dropdown, '0')
    await waitFor(() => expect(textarea.value).toBe('plain\ndeep\n'))
  })

  it('restores the caret after a click, so typing continues in place', async () => {
    const textarea = await renderEditor('one two')
    select(textarea, 4, 7)

    await userEvent.click(screen.getByRole('button', { name: 'Bold' }))

    await waitFor(() => expect(textarea.selectionStart).toBe(6))
    expect(textarea.selectionEnd).toBe(9)
    expect(document.activeElement).toBe(textarea)
  })

  it('is hidden in a published export, where nothing can be edited', async () => {
    await renderEditor('read me', true)
    expect(screen.queryByLabelText('Heading level')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument()
  })
})
