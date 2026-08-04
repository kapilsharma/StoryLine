import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SCHEMA_VERSION } from '@shared/types'
import { createProject, loadSnapshot } from '@main/projectService'
import { isProject, writeCharacter } from '@main/data/repository'

let base: string
let root: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-proj-'))
  root = join(base, 'my-novel')
  await fs.mkdir(root)
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('createProject', () => {
  it('scaffolds a main board with its own entity folders', async () => {
    const snap = await createProject(root)
    expect(snap.project.name).toBe('my-novel')
    expect(snap.project.timelineLabel).toBe('Chapter')
    expect(snap.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(snap.boards).toHaveLength(1)
    expect(snap.boards[0].board.id).toBe('main')
    for (const dir of ['characters', 'timeline', 'notes']) {
      expect(await fs.stat(join(root, 'boards', 'main', dir)).then(() => true)).toBe(true)
    }
  })

  it('refuses to scaffold over an existing project', async () => {
    await createProject(root)
    await expect(createProject(root)).rejects.toThrow(/already contains/i)
  })
})

describe('loadSnapshot', () => {
  it('throws for a non-project folder', async () => {
    await expect(loadSnapshot(root)).rejects.toThrow(/not a ZN Story Line project/i)
  })

  it('reflects entities written to a board', async () => {
    await createProject(root)
    await writeCharacter(root, 'main', { id: 'wolf', type: 'character', name: 'Wolf', colour: '#E24B4A' })
    const snap = await loadSnapshot(root)
    const main = snap.boards.find((b) => b.board.id === 'main')!
    expect(main.characters.map((c) => c.id)).toContain('wolf')
    expect(await isProject(root)).toBe(true)
  })
})
