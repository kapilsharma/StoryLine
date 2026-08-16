// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from '@renderer/components/Settings'
import { ProjectView } from '@renderer/components/ProjectView'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * Row label (#62) and project kind (#63), through the UI.
 *
 * The on-disk contract — that a default story project round-trips without
 * gaining keys — is covered in tests/unit/project-meta.test.ts. What matters
 * here is that the form reads and writes the right values, and that the rest of
 * the UI actually honours them.
 */

async function renderSettings(project = {}) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot({ project })) })
  renderWithProviders(<Settings />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  await screen.findByText('Project')
  return api
}

async function renderProjectView(project = {}) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot({ project })) })
  renderWithProviders(<ProjectView />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  return api
}

describe('Settings — project metadata', () => {
  it('shows the defaults for a project that sets neither field', async () => {
    await renderSettings()
    expect(screen.getByLabelText<HTMLInputElement>('Row label').value).toBe('Character')
    expect(screen.getByLabelText<HTMLInputElement>('Column label').value).toBe('Chapter')
    expect(screen.getByLabelText<HTMLSelectElement>('Project kind').value).toBe('story')
  })

  it('shows stored values', async () => {
    await renderSettings({ rowLabel: 'Phase', timelineLabel: 'Section', kind: 'general' as const })
    expect(screen.getByLabelText<HTMLInputElement>('Row label').value).toBe('Phase')
    expect(screen.getByLabelText<HTMLSelectElement>('Project kind').value).toBe('general')
  })

  it('keeps Save disabled until something changes', async () => {
    await renderSettings()
    const save = screen.getByRole('button', { name: 'Save project settings' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Row label'), 'x')
    expect(save).toBeEnabled()
  })

  it('saves the whole metadata set as one object', async () => {
    const api = await renderSettings()
    const rowLabel = screen.getByLabelText('Row label')
    await userEvent.clear(rowLabel)
    await userEvent.type(rowLabel, 'Topic')
    await userEvent.selectOptions(screen.getByLabelText('Project kind'), 'general')
    await userEvent.click(screen.getByRole('button', { name: 'Save project settings' }))

    await waitFor(() =>
      expect(api.saveProjectMeta).toHaveBeenCalledWith('/project', {
        name: 'My Novel',
        timelineLabel: 'Chapter',
        rowLabel: 'Topic',
        kind: 'general'
      })
    )
  })

  it('will not save an empty project name', async () => {
    await renderSettings()
    await userEvent.clear(screen.getByLabelText('Project name'))
    expect(screen.getByRole('button', { name: 'Save project settings' })).toBeDisabled()
  })

  it('offers no save button in a published export', async () => {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot()) })
    renderWithProviders(<Settings />, { bootRoot: '/project', readOnly: true })
    await waitFor(() => expect(api.openProject).toHaveBeenCalled())
    expect(await screen.findByText(/read-only in a published board/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save project settings' })).not.toBeInTheDocument()
  })
})

describe('the rest of the UI honours the labels (#62)', () => {
  it('names the tabs from the defaults', async () => {
    await renderProjectView()
    expect(await screen.findByRole('button', { name: 'Characters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chapters' })).toBeInTheDocument()
  })

  it('names the tabs from the project’s own labels', async () => {
    await renderProjectView({ rowLabel: 'Phase', timelineLabel: 'Section' })
    expect(await screen.findByRole('button', { name: 'Phases' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sections' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Characters' })).not.toBeInTheDocument()
  })
})

describe('project kind hides the family features (#63)', () => {
  it('shows the Family tab on a story project', async () => {
    await renderProjectView()
    expect(await screen.findByRole('button', { name: 'Family' })).toBeInTheDocument()
  })

  it('hides the Family tab on a general project', async () => {
    await renderProjectView({ kind: 'general' as const })
    await screen.findByRole('button', { name: 'Boards' })
    expect(screen.queryByRole('button', { name: 'Family' })).not.toBeInTheDocument()
  })

  it('treats a project with no kind as a story, so nothing existing changes', async () => {
    await renderProjectView({ kind: undefined })
    expect(await screen.findByRole('button', { name: 'Family' })).toBeInTheDocument()
  })
})
