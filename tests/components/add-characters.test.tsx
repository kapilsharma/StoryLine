// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharacterEditor } from '@renderer/components/CharacterEditor'
import { makeApi, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * "Add multiple characters" (Issue #175), from the Characters tab: paste CSV,
 * see what each column became, and add only when every row is good.
 */

const snapshot = makeSnapshot({
  characters: [{ id: 'aria', type: 'character', name: 'Aria', colour: '#22c55e' }]
})

async function openDialog() {
  const api = makeApi({
    openProject: vi.fn().mockResolvedValue(snapshot),
    addCharacters: vi.fn().mockResolvedValue(snapshot)
  })
  renderWithProviders(<CharacterEditor />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  await userEvent.click(await screen.findByRole('button', { name: '+ Add multiple' }))
  const dialog = screen.getByRole('heading', { name: 'Add multiple characters' }).parentElement!
  return { api, dialog }
}

async function paste(dialog: HTMLElement, text: string) {
  await userEvent.click(within(dialog).getByLabelText('Characters'))
  await userEvent.paste(text)
}

describe('Add multiple characters', () => {
  it('adds the issue’s example in one call, showing what each column became', async () => {
    const { api, dialog } = await openDialog()
    const add = within(dialog).getByRole('button', { name: 'Add characters' })
    expect(add).toBeDisabled()

    await paste(
      dialog,
      'name, sepcies, Group, Family\nGriffith (Army) Devoras, Mage, Council, Devoras\nThaddeus (RGuard) Stantorn, Mage, Council, Stantorn'
    )
    const columns = within(dialog).getByLabelText('Columns')
    expect(columns).toHaveTextContent('name → Name')
    expect(columns).toHaveTextContent('sepcies → custom field')
    expect(within(dialog).getByText('Will add 2 characters to this board.')).toBeInTheDocument()

    await userEvent.click(add)
    await waitFor(() => expect(api.addCharacters).toHaveBeenCalledTimes(1))
    const chars = (api.addCharacters as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(chars.map((c: { name: string }) => c.name)).toEqual([
      'Griffith (Army) Devoras',
      'Thaddeus (RGuard) Stantorn'
    ])
    expect(screen.queryByRole('heading', { name: 'Add multiple characters' })).not.toBeInTheDocument()
  })

  it('names the bad rows and adds nothing while any remain', async () => {
    const { api, dialog } = await openDialog()
    await paste(dialog, 'Name,Age\nNew One,30\naria,12\nOld,ancient')
    const problems = within(dialog).getByRole('alert')
    expect(problems).toHaveTextContent(/Line 3: "aria" already exists — remove this row/)
    expect(problems).toHaveTextContent(/Line 4: Age "ancient" must be a whole number/)
    expect(within(dialog).getByRole('button', { name: 'Add characters' })).toBeDisabled()
    expect(api.addCharacters).not.toHaveBeenCalled()
  })
})
