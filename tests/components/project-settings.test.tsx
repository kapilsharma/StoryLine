// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from '@renderer/components/Settings'
import { ProjectView } from '@renderer/components/ProjectView'
import { DEFAULT_CARD_STATUSES } from '@shared/cardStatus'
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
  // The form fills from the project in an effect, a tick after the heading appears —
  // so wait for it, or a test that reads a field straight away races it.
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Project name').value).not.toBe(''))
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
    expect(screen.getByLabelText<HTMLInputElement>('Level 1 name').value).toBe('Chapter')
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
        timelineLevelLabels: ['Chapter'],
        rowLabel: 'Topic',
        kind: 'general',
        cardStatuses: DEFAULT_CARD_STATUSES
      })
    )
  })

  describe('column levels (Issue #104)', () => {
    it('starts as one level — a plain list, like every project before levels', async () => {
      await renderSettings()
      expect(screen.getAllByLabelText(/^Level \d+ name$/)).toHaveLength(1)
      // The only level can't be removed: there has to be something to put cards on.
      expect(screen.getByRole('button', { name: 'Remove level 1' })).toBeDisabled()
    })

    it('shows every level a project has, outermost first', async () => {
      await renderSettings({ timelineLevelLabels: ['Novel', 'Part', 'Chapter'], timelineLabel: 'Chapter' })
      expect(screen.getAllByLabelText(/^Level \d+ name$/).map((i) => (i as HTMLInputElement).value)).toEqual([
        'Novel',
        'Part',
        'Chapter'
      ])
    })

    it('adds a level below, and a level above', async () => {
      await renderSettings()
      await userEvent.click(screen.getByRole('button', { name: '+ Level below' }))
      await userEvent.click(screen.getByRole('button', { name: '+ Level above' }))
      const inputs = screen.getAllByLabelText(/^Level \d+ name$/) as HTMLInputElement[]
      expect(inputs.map((i) => i.value)).toEqual(['', 'Chapter', ''])
    })

    it('saves the levels it was given, trimmed and in order', async () => {
      const api = await renderSettings()
      await userEvent.click(screen.getByRole('button', { name: '+ Level above' }))
      await userEvent.type(screen.getByLabelText('Level 1 name'), 'Part')
      await userEvent.click(screen.getByRole('button', { name: 'Save project settings' }))

      await waitFor(() =>
        expect(api.saveProjectMeta).toHaveBeenCalledWith('/project', {
          name: 'My Novel',
          timelineLevelLabels: ['Part', 'Chapter'],
          rowLabel: 'Character',
          kind: 'story',
          cardStatuses: DEFAULT_CARD_STATUSES
        })
      )
    })

    it('removes a level', async () => {
      await renderSettings({ timelineLevelLabels: ['Part', 'Chapter'], timelineLabel: 'Chapter' })
      await userEvent.click(screen.getByRole('button', { name: 'Remove level 1' }))
      expect((screen.getByLabelText('Level 1 name') as HTMLInputElement).value).toBe('Chapter')
    })

    it('counts a changed level as a change worth saving', async () => {
      await renderSettings()
      const save = screen.getByRole('button', { name: 'Save project settings' })
      expect(save).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Level 1 name'), 's')
      expect(save).toBeEnabled()
    })
  })

  describe('card statuses (Issue #108)', () => {
    const icons = (): string[] =>
      (screen.getAllByLabelText(/^Status \d+ icon$/) as HTMLInputElement[]).map((i) => i.value)

    it('starts with the built-in set', async () => {
      await renderSettings()
      expect(icons()).toEqual(DEFAULT_CARD_STATUSES.map((s) => s.icon))
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
    })

    it('shows a project’s own statuses', async () => {
      await renderSettings({ cardStatuses: [{ id: 'todo', icon: '⬜', label: 'To do' }] })
      expect(icons()).toEqual(['⬜'])
      expect((screen.getByLabelText('Status 1 meaning') as HTMLInputElement).value).toBe('To do')
    })

    it('reorders, removes and adds, then saves the list in order', async () => {
      const api = await renderSettings()
      await userEvent.click(screen.getByRole('button', { name: 'Move status 2 up' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove status 5' }))
      await userEvent.click(screen.getByRole('button', { name: '+ Status' }))
      await userEvent.type(screen.getByLabelText('Status 5 icon'), 'E')
      await userEvent.type(screen.getByLabelText('Status 5 meaning'), 'Edited')
      expect(icons()).toEqual(['⚡', '💡', '🌓', '🚩', 'E'])

      await userEvent.click(screen.getByRole('button', { name: 'Save project settings' }))
      await waitFor(() => expect(api.saveProjectMeta).toHaveBeenCalled())
      const [, meta] = vi.mocked(api.saveProjectMeta).mock.calls[0]
      expect(meta.cardStatuses.map((s) => s.id)).toEqual(['doc', 'idea', 'draft', 'stuck', ''])
      // The new row's id is given on save, by applyMeta — see tests/unit/card-status.test.ts.
      expect(meta.cardStatuses[4]).toEqual({ id: '', icon: 'E', label: 'Edited' })
    })
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

  it('names the Timeline tab after the deepest level', async () => {
    await renderProjectView({ timelineLevelLabels: ['Novel', 'Part', 'Scene'], timelineLabel: 'Scene' })
    expect(await screen.findByRole('button', { name: 'Scenes' })).toBeInTheDocument()
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
