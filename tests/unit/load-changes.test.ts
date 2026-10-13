import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createProject, loadChanges } from '@main/projectService'
import { writeCharacter, writeNote } from '@main/data/repository'
import type { ProjectChange } from '@shared/changes'

let base: string
let root: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-changes-'))
  root = join(base, 'my-novel')
  await fs.mkdir(root)
  await createProject(root)
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

const c = (over: Partial<ProjectChange> & Pick<ProjectChange, 'kind' | 'id'>): ProjectChange => ({
  type: 'change',
  ...over
})

describe('loadChanges (focused reload loader, #131)', () => {
  it('reads a changed note as a body-less meta with hasBody set', async () => {
    await writeNote(root, 'main', { id: 'intro', uid: 'n_00000001', title: 'Intro', body: 'Real body text.' })
    const { ops } = await loadChanges(root, [c({ kind: 'note', id: 'intro', boardId: 'main' })])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ target: 'note', boardId: 'main', id: 'intro' })
    const op = ops[0] as Extract<(typeof ops)[number], { target: 'note' }>
    expect(op.value).toMatchObject({ title: 'Intro', hasBody: true })
    expect(op.value?.body).toBe('') // body dropped, like listNoteMetas
  })

  it('reads a changed character with its hasNote flag', async () => {
    await writeCharacter(root, 'main', { id: 'wolf', type: 'character', name: 'Wolf', colour: '#E24B4A' })
    const { ops } = await loadChanges(root, [c({ kind: 'character', id: 'wolf', boardId: 'main' })])
    expect(ops[0]).toMatchObject({ target: 'character', id: 'wolf', value: { name: 'Wolf' } })
  })

  it('turns an unlink into a null-value removal op without reading', async () => {
    const { ops } = await loadChanges(root, [
      c({ kind: 'note', id: 'gone', boardId: 'main', type: 'unlink' })
    ])
    expect(ops).toEqual([{ target: 'note', boardId: 'main', id: 'gone', value: null }])
  })

  it('treats an add/change for a file that is already gone as a removal', async () => {
    const { ops } = await loadChanges(root, [
      c({ kind: 'note', id: 'never-existed', boardId: 'main', type: 'add' })
    ])
    expect(ops).toEqual([{ target: 'note', boardId: 'main', id: 'never-existed', value: null }])
  })

  it('collapses repeated events for one file into a single read (last wins)', async () => {
    await writeNote(root, 'main', { id: 'intro', uid: 'n_00000001', title: 'Intro', body: 'x' })
    const { ops } = await loadChanges(root, [
      c({ kind: 'note', id: 'intro', boardId: 'main', type: 'add' }),
      c({ kind: 'note', id: 'intro', boardId: 'main', type: 'change' })
    ])
    expect(ops).toHaveLength(1)
  })

  it('reads project.json and a board file', async () => {
    const { ops } = await loadChanges(root, [
      c({ kind: 'project', id: 'project' }),
      c({ kind: 'board', id: 'main', boardId: 'main' })
    ])
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ target: 'project' })
    expect(ops[1]).toMatchObject({ target: 'board', boardId: 'main' })
  })
})
