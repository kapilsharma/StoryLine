// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppConfig } from '@shared/config'
import { EditorPage } from '@renderer/components/EditorPage'
import { useStore } from '@renderer/store'
import { baseConfig, makeApi, makeSnapshot, renderWithProviders, wholeReply } from './test-utils'

/**
 * The editors' word count (#194): shown bottom left, live as you type, hidden by
 * the setting, and switched by Ctrl+Alt+W from anywhere. What counts as a word
 * is `tests/unit/word-count.test.ts`; this is the wiring.
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

const config = (showWordCount: boolean): AppConfig => ({
  ...baseConfig,
  settings: { ...baseConfig.settings, showWordCount }
})

async function renderEditor(body: string, showWordCount = true) {
  const api = makeApi({
    getConfig: vi.fn().mockResolvedValue(config(showWordCount)),
    // Echo the saved settings back, as the main process does.
    updateSettings: vi.fn(async (settings) => ({ ...baseConfig, settings }))
  })
  Object.assign(api, {
    openProject: vi.fn().mockResolvedValue(wholeReply(snapshot)),
    getNote: vi.fn().mockResolvedValue({ id: 'note-1', uid: 'n_1', title: 'A note', body })
  })
  renderWithProviders(<Harness />, { bootRoot: '/project' })
  const textarea = (await screen.findByPlaceholderText('Write in Markdown…')) as HTMLTextAreaElement
  await waitFor(() => expect(textarea.value).toBe(body))
  return { api, textarea }
}

const ctrlAltW = (): boolean => fireEvent.keyDown(window, { key: 'w', code: 'KeyW', ctrlKey: true, altKey: true })

describe('word count in the editor', () => {
  it('shows the note’s words at the foot of the editor, and follows typing', async () => {
    const { textarea } = await renderEditor('She walked the **long** corridor.')
    expect(await screen.findByText('5 words')).toBeInTheDocument()
    await userEvent.type(textarea, ' Again')
    expect(await screen.findByText('6 words')).toBeInTheDocument()
  })

  it('is absent when the setting is off', async () => {
    await renderEditor('One two three.', false)
    expect(screen.queryByText(/\bwords?$/)).not.toBeInTheDocument()
  })

  it('Ctrl+Alt+W switches it off and on again, saving the setting', async () => {
    const { api } = await renderEditor('One two three.')
    expect(await screen.findByText('3 words')).toBeInTheDocument()

    ctrlAltW()
    await waitFor(() => expect(screen.queryByText('3 words')).not.toBeInTheDocument())
    expect(api.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ showWordCount: false }))

    ctrlAltW()
    expect(await screen.findByText('3 words')).toBeInTheDocument()
    expect(api.updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ showWordCount: true }))
  })

  it('leaves Ctrl+W and Alt+W alone', async () => {
    const { api } = await renderEditor('One two three.')
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW', altKey: true })
    expect(api.updateSettings).not.toHaveBeenCalled()
  })
})
