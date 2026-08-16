// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SearchHit, SearchScope } from '@shared/search'
import { NotesBrowser } from '@renderer/components/NotesBrowser'
import { makeApi, makeBoardData, makeSnapshot, renderWithProviders } from './test-utils'

/**
 * The Notes tab (Issues #59, #60).
 *
 * The point of these tests is that the tab delegates to `api.searchNotes` with
 * the right scope, rather than filtering the snapshot — the snapshot has no note
 * bodies, so a component that filtered locally would silently only ever match
 * titles, which is the bug #59 was raised for.
 */

const snapshot = makeSnapshot({
  boards: [
    makeBoardData('adm', {
      name: 'ADM',
      notes: [
        { id: 'phase-e', uid: 'n_1', title: 'Opportunities', tags: ['phase'], body: '', hasBody: true },
        { id: 'phase-f', uid: 'n_2', title: 'Migration', tags: ['phase'], body: '' }
      ]
    }),
    makeBoardData('concepts', {
      name: 'Concepts',
      notes: [{ id: 'gap', uid: 'n_3', title: 'Gap', tags: ['definition'], body: '' }]
    })
  ]
})

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  boardId: 'adm',
  kind: 'note',
  id: 'phase-e',
  title: 'Opportunities',
  tags: ['phase'],
  where: 'body',
  snippet: 'Consolidate the gap analysis into work packages.',
  score: 10,
  ...over
})

/** Render the tab with a project open, and return the search spy. */
async function setup(hits: SearchHit[] = []) {
  const searchNotes = vi.fn().mockResolvedValue(hits)
  const api = makeApi({ openProject: vi.fn().mockResolvedValue(snapshot), searchNotes })
  renderWithProviders(<NotesBrowser />, { bootRoot: '/project' })
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  await waitFor(() => expect(searchNotes).toHaveBeenCalled())
  return { searchNotes }
}

/** The scope object from the most recent searchNotes call. */
const lastScope = (spy: ReturnType<typeof vi.fn>): SearchScope => spy.mock.calls.at(-1)![2]
const lastQuery = (spy: ReturnType<typeof vi.fn>): string => spy.mock.calls.at(-1)![1]

describe('NotesBrowser search', () => {
  it('asks the main process rather than filtering the snapshot', async () => {
    const { searchNotes } = await setup([hit()])
    expect(await screen.findByText('Opportunities')).toBeInTheDocument()
    expect(searchNotes).toHaveBeenCalledWith('/project', '', expect.any(Object))
  })

  it('sends the typed query through', async () => {
    const { searchNotes } = await setup([hit()])
    await userEvent.type(screen.getByPlaceholderText(/Search this board/), 'gap')
    await waitFor(() => expect(lastQuery(searchNotes as never)).toBe('gap'))
  })

  it('scopes to the active board by default (#60)', async () => {
    const { searchNotes } = await setup()
    expect(lastScope(searchNotes as never).boardIds).toEqual(['adm'])
  })

  it('searches every board once the scope is switched (#60)', async () => {
    const { searchNotes } = await setup()
    await userEvent.click(screen.getByRole('button', { name: 'All boards' }))
    // An empty boardIds list means "everywhere" in the search contract.
    await waitFor(() => expect(lastScope(searchNotes as never).boardIds).toEqual([]))
  })

  it('changes the placeholder to match the scope', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'All boards' }))
    expect(await screen.findByPlaceholderText(/Search every board/)).toBeInTheDocument()
  })

  it('passes a kind filter, and clears it when clicked again', async () => {
    const { searchNotes } = await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Rows' }))
    await waitFor(() => expect(lastScope(searchNotes as never).kinds).toEqual(['character']))
    await userEvent.click(screen.getByRole('button', { name: 'Rows' }))
    await waitFor(() => expect(lastScope(searchNotes as never).kinds).toBeUndefined())
  })

  it('passes a tag filter', async () => {
    const { searchNotes } = await setup()
    await userEvent.click(await screen.findByRole('button', { name: 'phase' }))
    await waitFor(() => expect(lastScope(searchNotes as never).tag).toBe('phase'))
  })

  it('offers tags from the active board only, until the scope widens', async () => {
    await setup()
    expect(screen.queryByRole('button', { name: 'definition' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'All boards' }))
    expect(await screen.findByRole('button', { name: 'definition' })).toBeInTheDocument()
  })
})

describe('NotesBrowser results', () => {
  it('shows the body snippet a title-only search could never produce (#59)', async () => {
    await setup([hit()])
    expect(await screen.findByText(/Consolidate the gap analysis/)).toBeInTheDocument()
  })

  it('highlights the matched term inside the result', async () => {
    await setup([hit()])
    await userEvent.type(screen.getByPlaceholderText(/Search this board/), 'gap')
    await waitFor(() => {
      const marks = document.querySelectorAll('.note-card-main mark')
      expect(marks.length).toBeGreaterThan(0)
      expect([...marks].some((m) => m.textContent?.toLowerCase() === 'gap')).toBe(true)
    })
  })

  it('labels which board a hit came from when searching everywhere', async () => {
    await setup([hit({ boardId: 'concepts', id: 'gap', title: 'Gap' })])
    await userEvent.click(screen.getByRole('button', { name: 'All boards' }))
    // Scoped to the result card — "Concepts" is also a board tab in the picker.
    await waitFor(() =>
      expect(document.querySelector('.note-card-tags .tag.board')?.textContent).toBe('Concepts')
    )
  })

  it('marks a row or column hit with its kind', async () => {
    await setup([hit({ kind: 'character', id: 'aeri', title: 'Aeri' })])
    expect(await screen.findByText('Row')).toBeInTheDocument()
  })

  it('reports the result count', async () => {
    await setup([hit(), hit({ id: 'phase-f', title: 'Migration' })])
    expect(await screen.findByText(/2 results/)).toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    await setup([])
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument()
  })

  it('opens a note hit in the popup', async () => {
    const api = makeApi({
      openProject: vi.fn().mockResolvedValue(snapshot),
      searchNotes: vi.fn().mockResolvedValue([hit()]),
      getNote: vi.fn().mockResolvedValue({ id: 'phase-e', title: 'Opportunities', body: 'Body text.' })
    })
    renderWithProviders(<NotesBrowser />, { bootRoot: '/project' })
    await userEvent.click(await screen.findByText('Opportunities'))
    await waitFor(() => expect(api.getNote).toHaveBeenCalledWith('/project', 'adm', 'phase-e'))
  })
})
