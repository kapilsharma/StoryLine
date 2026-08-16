// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TimelineUnit } from '@shared/types'
import { TimelineForm } from '@renderer/components/TimelineForm'
import { TimelineEditor } from '@renderer/components/TimelineEditor'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The Timeline tab and its form — core CRUD that was sitting at 2–5% coverage.
 *
 * The behaviour worth pinning down is what actually reaches `saveTimelineUnit`:
 * optional fields must be *absent* rather than empty strings, or every column
 * file grows keys nobody set.
 */

const timeline: TimelineUnit[] = [
  { id: 'ch1', label: 'Chapter 1', order: 1, group: 'Act 1' },
  { id: 'ch2', label: 'Chapter 2', order: 2 }
]

const snapshot = makeSnapshot({ timeline, project: { timelineLabel: 'Chapter' } })

async function renderForm(initial: TimelineUnit | null, handlers = {}) {
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
  renderWithProviders(<TimelineForm initial={initial} onSaved={vi.fn()} {...handlers} />, {
    bootRoot: '/project'
  })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  return api
}

describe('TimelineForm — creating', () => {
  it('starts blank and cannot save without a label', async () => {
    await renderForm(null)
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('saves a new unit with only the fields that were filled in', async () => {
    const api = await renderForm(null)
    await userEvent.type(screen.getByLabelText('Label'), 'Chapter 3')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.saveTimelineUnit).toHaveBeenCalled())
    const unit = (api.saveTimelineUnit as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(unit).toEqual({ id: '', label: 'Chapter 3', order: 0 })
    // Empty optional fields must not be written as empty strings.
    expect('summary' in unit).toBe(false)
    expect('group' in unit).toBe(false)
    expect('tags' in unit).toBe(false)
  })

  it('carries summary, group and tags through when given', async () => {
    const api = await renderForm(null)
    await userEvent.type(screen.getByLabelText('Label'), 'Chapter 3')
    await userEvent.type(screen.getByLabelText('Summary'), 'The fault appears.')
    await userEvent.type(screen.getByLabelText('Group'), 'Act 2')
    await userEvent.type(screen.getByLabelText('Tags'), ' a , b ,, ')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.saveTimelineUnit).toHaveBeenCalled())
    expect((api.saveTimelineUnit as ReturnType<typeof vi.fn>).mock.calls[0][2]).toMatchObject({
      label: 'Chapter 3',
      summary: 'The fault appears.',
      group: 'Act 2',
      tags: ['a', 'b'] // trimmed, blanks dropped
    })
  })

  it('trims a whitespace-only label into "cannot save"', async () => {
    await renderForm(null)
    await userEvent.type(screen.getByLabelText('Label'), '   ')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})

describe('TimelineForm — editing', () => {
  it('populates from the unit being edited', async () => {
    await renderForm(timeline[0])
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Chapter 1')
    expect(screen.getByLabelText<HTMLInputElement>('Group').value).toBe('Act 1')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('preserves the existing order rather than resetting it', async () => {
    const api = await renderForm(timeline[1])
    await userEvent.type(screen.getByLabelText('Label'), ' revised')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveTimelineUnit).toHaveBeenCalled())
    expect((api.saveTimelineUnit as ReturnType<typeof vi.fn>).mock.calls[0][2]).toMatchObject({
      id: 'ch2',
      order: 2
    })
  })

  it('clearing an optional field removes it rather than writing an empty string', async () => {
    const api = await renderForm(timeline[0])
    await userEvent.clear(screen.getByLabelText('Group'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveTimelineUnit).toHaveBeenCalled())
    expect('group' in (api.saveTimelineUnit as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(false)
  })

  it('shows the optional actions only when their handlers are given', async () => {
    await renderForm(timeline[0])
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('wires Delete, Cancel and Open in editor when given', async () => {
    const onDelete = vi.fn()
    const onCancel = vi.fn()
    const onOpenInEditor = vi.fn()
    await renderForm(timeline[0], { onDelete, onCancel, onOpenInEditor })

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(onDelete).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
    expect(onOpenInEditor).toHaveBeenCalled()
  })
})

describe('TimelineEditor tab', () => {
  async function renderTab() {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot) })
    renderWithProviders(<TimelineEditor />, { bootRoot: '/project' })
    await waitFor(() => expect(api.openProject).toHaveBeenCalled())
    await screen.findByText('Chapter 1')
    return api
  }

  it('lists the units in order', async () => {
    await renderTab()
    const list = document.querySelector('.entity-list, ul') as HTMLElement
    expect(within(list).getByText('Chapter 1')).toBeInTheDocument()
    expect(within(list).getByText('Chapter 2')).toBeInTheDocument()
  })

  it('opens a blank form for a new unit', async () => {
    await renderTab()
    await userEvent.click(screen.getByRole('button', { name: '+ Add chapter' }))
    expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('')
  })

  it('selecting a unit loads it into the form', async () => {
    await renderTab()
    await userEvent.click(screen.getByText('Chapter 1'))
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Label').value).toBe('Chapter 1')
    )
  })

  describe('deleting', () => {
    beforeEach(() => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('confirms before deleting, then deletes', async () => {
      const api = await renderTab()
      await userEvent.click(screen.getByText('Chapter 1'))
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(api.deleteTimelineUnit).toHaveBeenCalledWith('/project', 'main', 'ch1'))
    })

    it('does nothing when the confirm is declined', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
      const api = await renderTab()
      await userEvent.click(screen.getByText('Chapter 1'))
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
      expect(api.deleteTimelineUnit).not.toHaveBeenCalled()
    })
  })
})
