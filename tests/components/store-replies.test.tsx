// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { SnapshotReply } from '@shared/ipc'
import { useStore } from '@renderer/store'
import { makeApi, makeSnapshot, renderWithProviders, wholeReply } from './test-utils'

/**
 * How the store takes replies from the main process (#188): whole snapshots
 * replace, patches apply onto the version they were made from, and a patch it
 * can't place makes it read the project again rather than guess.
 */

const base = makeSnapshot({ board: { id: 'main' }, notes: [{ id: 'a', uid: 'n_a', title: 'A', body: '' }] })
const opened = { ...wholeReply(base), version: 10 } as SnapshotReply
const addNote = (id: string, from: number, version: number): SnapshotReply => ({
  kind: 'patch',
  root: base.root,
  from,
  version,
  patch: { ops: [{ target: 'note', boardId: 'main', id, value: { id, uid: `n_${id}`, title: id.toUpperCase(), body: '' } }] }
})

let store: ReturnType<typeof useStore>
function Grab(): null {
  store = useStore()
  return null
}

async function boot(api: ReturnType<typeof makeApi>): Promise<void> {
  renderWithProviders(<Grab />, { bootRoot: base.root })
  await waitFor(() => expect(store.snapshot).not.toBeNull())
  expect(api.openProject).toHaveBeenCalled()
  // Board edits go to the active board, which the store picks once it has rendered.
  await waitFor(() => expect(store.activeBoard?.board.id).toBe('main'))
}

const titles = (): string[] => store.snapshot!.boards[0].notes.map((n) => n.title)

describe('store replies', () => {
  it('applies a patch made from the version it holds', async () => {
    const api = makeApi({ openProject: vi.fn().mockResolvedValue(opened), saveNote: vi.fn().mockResolvedValue(addNote('b', 10, 11)) })
    await boot(api)
    await store.saveNote({ id: 'b', title: 'B', body: '' })
    await waitFor(() => expect(titles()).toEqual(['A', 'B']))
    expect(api.reloadProject).not.toHaveBeenCalled()
  })

  it('applies two quick patches in order, even before a re-render', async () => {
    const api = makeApi({
      openProject: vi.fn().mockResolvedValue(opened),
      saveNote: vi.fn().mockResolvedValueOnce(addNote('b', 10, 11)).mockResolvedValueOnce(addNote('c', 11, 12))
    })
    await boot(api)
    await Promise.all([store.saveNote({ id: 'b', title: 'B', body: '' }), store.saveNote({ id: 'c', title: 'C', body: '' })])
    await waitFor(() => expect(titles()).toEqual(['A', 'B', 'C']))
    expect(api.reloadProject).not.toHaveBeenCalled()
  })

  it('reads the project again when a patch does not follow the version it holds', async () => {
    const fresh = makeSnapshot({ board: { id: 'main' }, notes: [{ id: 'z', uid: 'n_z', title: 'Fresh', body: '' }] })
    const api = makeApi({
      openProject: vi.fn().mockResolvedValue(opened),
      saveNote: vi.fn().mockResolvedValue(addNote('b', 99, 100)),
      reloadProject: vi.fn().mockResolvedValue({ ...wholeReply(fresh), version: 100 })
    })
    await boot(api)
    await store.saveNote({ id: 'b', title: 'B', body: '' })
    expect(api.reloadProject).toHaveBeenCalledWith(base.root)
    await waitFor(() => expect(titles()).toEqual(['Fresh']))
  })
})
