// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetRef } from '@shared/assets'
import { EditorPage } from '@renderer/components/EditorPage'
import { useStore } from '@renderer/store'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * Mount the editor a render *after* the project opens, which is what happens in
 * the real app — the editor is opened by a user action, long after boot.
 *
 * Mounting it in the same commit that first sets the snapshot does not work:
 * child effects run before the provider's, so the store's root/board refs are
 * still null when the editor's load effect fires and `getNote` never reaches the
 * api. Deferring by one commit reproduces the real ordering.
 */
function Harness(): JSX.Element {
  const { snapshot } = useStore()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (snapshot) setReady(true)
  }, [snapshot])
  if (!ready) return <span>booting</span>
  return <EditorPage target={{ kind: 'note', boardId: 'main', id: 'note-1' }} />
}

/**
 * Adding an image to a note from the editor (Issue #61).
 *
 * The behaviour that matters is what ends up *in the markdown*: a
 * project-relative `assets/…` path, an image embed for a picture and a plain
 * link for a PDF, inserted at the caret rather than appended.
 */

const snapshot = makeSnapshot({
  board: { id: 'main' },
  notes: [{ id: 'note-1', uid: 'n_1', title: 'A note', body: '' }]
})

const ref = (file: string): AssetRef => ({
  boardId: 'main',
  file,
  markdownPath: `assets/${file}`,
  bytes: 100
})

async function renderEditor(body = '', api = makeApi()) {
  Object.assign(api, {
    openProject: vi.fn().mockResolvedValue(snapshot),
    getNote: vi.fn().mockResolvedValue({ id: 'note-1', uid: 'n_1', title: 'A note', body })
  })
  ;(window as unknown as { api: typeof api }).api = api
  renderWithProviders(<Harness />, { bootRoot: '/project' })
  const textarea = (await screen.findByPlaceholderText('Write in Markdown…')) as HTMLTextAreaElement
  await waitFor(() => expect(textarea.value).toBe(body))
  return { api, textarea }
}

describe('inserting an asset', () => {
  it('inserts an image embed with a project-relative path', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockResolvedValue(ref('diagram.png')) })
    const { textarea } = await renderEditor('', api)

    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    await waitFor(() => expect(textarea.value).toBe('![diagram.png](assets/diagram.png)'))
  })

  it('inserts a plain link for a PDF, not a broken image embed', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockResolvedValue(ref('spec.pdf')) })
    const { textarea } = await renderEditor('', api)

    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    await waitFor(() => expect(textarea.value).toBe('[spec.pdf](assets/spec.pdf)'))
  })

  it('inserts at the caret rather than appending', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockResolvedValue(ref('x.png')) })
    const { textarea } = await renderEditor('start end', api)

    textarea.setSelectionRange(6, 6) // between "start " and "end"
    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    await waitFor(() => expect(textarea.value).toBe('start ![x.png](assets/x.png)end'))
  })

  it('replaces the selection when there is one', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockResolvedValue(ref('x.png')) })
    const { textarea } = await renderEditor('before REPLACEME after', api)

    textarea.setSelectionRange(7, 16) // exactly REPLACEME, not the trailing space
    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    await waitFor(() => expect(textarea.value).toBe('before ![x.png](assets/x.png) after'))
  })

  it('does nothing when the picker is cancelled', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockResolvedValue(null) })
    const { textarea } = await renderEditor('unchanged', api)

    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    await waitFor(() => expect(api.pickAsset).toHaveBeenCalled())
    expect(textarea.value).toBe('unchanged')
  })

  it('surfaces an import failure instead of failing silently', async () => {
    const api = makeApi({ pickAsset: vi.fn().mockRejectedValue(new Error('That file is 12.0 MB')) })
    await renderEditor('', api)

    await userEvent.click(screen.getByRole('button', { name: '+ Image' }))
    expect(await screen.findByText(/That file is 12.0 MB/)).toBeInTheDocument()
  })

  it('hides the import controls in a published export', async () => {
    const api = makeApi()
    Object.assign(api, {
      openProject: vi.fn().mockResolvedValue(snapshot),
      getNote: vi.fn().mockResolvedValue({ id: 'note-1', uid: 'n_1', title: 'A note', body: '' })
    })
    ;(window as unknown as { api: typeof api }).api = api
    renderWithProviders(<Harness />, { bootRoot: '/project', readOnly: true })
    await screen.findByPlaceholderText('Write in Markdown…')
    expect(screen.queryByRole('button', { name: '+ Image' })).not.toBeInTheDocument()
  })
})

describe('paste and drop', () => {
  /**
   * jsdom implements neither `DataTransfer` nor `File.arrayBuffer`, so both are
   * faked to exactly the shape the handlers read — a `files` list of things with
   * a name and bytes.
   */
  const file = (name: string): File => {
    const f = new File(['png-bytes'], name, { type: 'image/png' })
    Object.defineProperty(f, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('png-bytes').buffer
    })
    return f
  }
  const transfer = (...files: File[]): object => ({ files, types: ['Files'] })

  it('imports a pasted image', async () => {
    const importAsset = vi.fn().mockResolvedValue(ref('pasted.png'))
    const api = makeApi({ importAsset })
    const { textarea } = await renderEditor('', api)

    fireEvent.paste(textarea, { clipboardData: transfer(file('pasted.png')) })

    await waitFor(() => expect(importAsset).toHaveBeenCalled())
    expect(importAsset.mock.calls[0][2]).toMatchObject({ name: 'pasted.png' })
    await waitFor(() => expect(textarea.value).toBe('![pasted.png](assets/pasted.png)'))
  })

  it('ignores a pasted file whose type is not allowed', async () => {
    const importAsset = vi.fn()
    const api = makeApi({ importAsset })
    const { textarea } = await renderEditor('', api)

    fireEvent.paste(textarea, {
      clipboardData: transfer(new File(['x'], 'evil.exe', { type: 'application/octet-stream' }))
    })

    await waitFor(() => expect(textarea.value).toBe(''))
    expect(importAsset).not.toHaveBeenCalled()
  })

  it('imports a dropped image', async () => {
    const importAsset = vi.fn().mockResolvedValue(ref('dropped.png'))
    const api = makeApi({ importAsset })
    const { textarea } = await renderEditor('', api)

    fireEvent.drop(textarea, { dataTransfer: transfer(file('dropped.png')) })

    await waitFor(() => expect(textarea.value).toBe('![dropped.png](assets/dropped.png)'))
  })
})
