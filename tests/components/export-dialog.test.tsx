// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from '@renderer/components/board/ExportDialog'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The "Export board" dialog (Issue #125). The markdown assembly is covered in
 * tests/unit/export-markdown.test.ts; here we check the dialog hands the right
 * options to the API and respects the save-dialog outcome.
 */
async function renderDialog(overrides = {}) {
  const onClose = vi.fn()
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(makeSnapshot()),
    exportDocument: vi.fn().mockResolvedValue({ path: '/out/My Novel.md', bytes: 42 }),
    ...overrides
  })
  renderWithProviders(<ExportDialog onClose={onClose} />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  return { api, onClose }
}

describe('ExportDialog', () => {
  it('exports scenes as markdown with notes by default', async () => {
    const { api, onClose } = await renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(api.exportDocument).toHaveBeenCalledWith('/project', 'main', {
        scenes: true,
        plotRows: false,
        includeNotes: true,
        format: 'markdown'
      })
    )
    // A real save (non-null result) closes the dialog.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('passes the chosen selection and format through', async () => {
    const { api } = await renderDialog()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Scenes' })) // off
    await userEvent.click(screen.getByRole('checkbox', { name: 'Plot rows' })) // on
    await userEvent.click(screen.getByRole('checkbox', { name: /Note bodies/ })) // off
    await userEvent.click(screen.getByRole('radio', { name: 'PDF (.pdf)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(api.exportDocument).toHaveBeenCalledWith('/project', 'main', {
        scenes: false,
        plotRows: true,
        includeNotes: false,
        format: 'pdf'
      })
    )
  })

  it('disables Export when nothing is selected', async () => {
    await renderDialog()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Scenes' })) // the only one on, now off
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('keeps the dialog open when the save is cancelled', async () => {
    const { onClose } = await renderDialog({ exportDocument: vi.fn().mockResolvedValue(null) })
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(onClose).not.toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('surfaces an export error without closing', async () => {
    const { onClose } = await renderDialog({
      exportDocument: vi.fn().mockRejectedValue(new Error('disk full'))
    })
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
