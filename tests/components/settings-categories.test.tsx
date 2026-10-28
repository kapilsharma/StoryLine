// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from '@renderer/components/Settings'
import { ProjectView } from '@renderer/components/ProjectView'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * Settings split into categories (#210): a list on the left, the chosen one on
 * the right. The settings themselves are unchanged and tested where they are
 * used; this is the arrangement.
 */

async function renderSettings(project = {}, readOnly = false) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot({ project })) })
  renderWithProviders(<Settings />, { bootRoot: '/project', readOnly })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  await screen.findByRole('tab', { name: 'General' })
  return api
}

const tabNames = (): string[] => screen.getAllByRole('tab').map((t) => t.textContent ?? '')

describe('Settings categories (#210)', () => {
  it('lists the categories and opens on General', async () => {
    await renderSettings()
    expect(tabNames()).toEqual(['General', 'Project', 'Publish', 'Family tree', 'Editor'])
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Project name')).not.toBeInTheDocument()
  })

  it('shows only the chosen category', async () => {
    await renderSettings()
    await userEvent.click(screen.getByRole('tab', { name: 'Family tree' }))
    expect(screen.getByRole('heading', { name: 'Family tree' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'General' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Note opened from a board')).not.toBeInTheDocument()
  })

  it('keeps the editor options under Editor, not General', async () => {
    await renderSettings()
    expect(screen.queryByLabelText('Word count in editors')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Note opened from a board')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Editor' }))
    expect(screen.getByLabelText('Word count in editors')).toBeInTheDocument()
    expect(screen.getByText('Editor preview position')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset editor styles to defaults' })).toBeInTheDocument()
  })

  it('still saves a setting from its category', async () => {
    const api = await renderSettings()
    await userEvent.click(screen.getByRole('tab', { name: 'Editor' }))
    await userEvent.selectOptions(screen.getByLabelText('Word count in editors'), 'Hidden')
    expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ showWordCount: false }))
  })

  it('hides Family tree on a general project, as the Family tab is', async () => {
    await renderSettings({ kind: 'general' as const })
    expect(tabNames()).toEqual(['General', 'Project', 'Publish', 'Editor'])
  })

  it('hides Publish in a published export', async () => {
    await renderSettings({}, true)
    expect(tabNames()).toEqual(['General', 'Project', 'Family tree', 'Editor'])
  })

  it('marks Project while it has unsaved changes, and keeps them across categories', async () => {
    await renderSettings()
    const project = screen.getByRole('tab', { name: 'Project' })
    await userEvent.click(project)
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Project name').value).not.toBe(''))
    expect(project).not.toHaveAttribute('title')

    await userEvent.clear(screen.getByLabelText('Row label'))
    await userEvent.type(screen.getByLabelText('Row label'), 'Topic')
    expect(project).toHaveAttribute('title', 'Unsaved project changes')

    await userEvent.click(screen.getByRole('tab', { name: 'General' }))
    await userEvent.click(project)
    expect(screen.getByLabelText<HTMLInputElement>('Row label').value).toBe('Topic')
    expect(screen.getByRole('button', { name: 'Save project settings' })).toBeEnabled()
  })

  it('reopens the same category after leaving the Settings tab', async () => {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(makeSnapshot()) })
    renderWithProviders(<ProjectView />, { bootRoot: '/project' })
    await waitFor(() => expect(api.openProject).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Editor' }))

    await userEvent.click(screen.getByRole('button', { name: 'Boards' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
  })
})
