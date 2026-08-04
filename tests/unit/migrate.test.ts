import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateIfNeeded } from '@main/data/migrate'
import { loadSnapshot } from '@main/projectService'

let root: string
const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true).catch(() => false)

/** Write a synthetic v1 (schema 1) project: global entity folders + flat board files. */
async function writeV1Project(): Promise<void> {
  await fs.mkdir(join(root, 'characters'), { recursive: true })
  await fs.mkdir(join(root, 'timeline'), { recursive: true })
  await fs.mkdir(join(root, 'notes'), { recursive: true })
  await fs.mkdir(join(root, 'boards'), { recursive: true })

  await fs.writeFile(join(root, 'characters', 'wolf.md'), '---\nid: wolf\nname: Wolf\ncolour: "#333"\n---\n')
  await fs.writeFile(join(root, 'characters', 'lonely.md'), '---\nid: lonely\nname: Lonely\ncolour: "#111"\n---\n')
  await fs.writeFile(join(root, 'timeline', 'ch1.md'), '---\nid: ch1\ntype: chapter\nlabel: Ch1\norder: 1\n---\n')
  await fs.writeFile(join(root, 'notes', 'hunt.md'), '---\ntitle: The Hunt\n---\n\nBody\n')

  await fs.writeFile(
    join(root, 'boards', 'main.json'),
    JSON.stringify({
      id: 'main',
      name: 'Main Board',
      cards: [{ id: 'c1', noteFile: 'notes/hunt.md', rowId: 'wolf', colStart: 'ch1', colEnd: 'ch1' }],
      rowOrder: ['wolf'],
      colOrder: ['ch1']
    })
  )
  await fs.writeFile(join(root, 'boards', 'thettana.json'), JSON.stringify({ id: 'thettana', name: 'Thettana', cards: [] }))
  await fs.writeFile(
    join(root, 'project.json'),
    JSON.stringify({ schemaVersion: 1, name: 'Story', timelineLabel: 'Chapter', boards: ['main', 'thettana'] })
  )
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-migrate-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('v1 → v2 migration', () => {
  it('moves shared entities into per-board folders and stamps v2', async () => {
    await writeV1Project()
    await migrateIfNeeded(root)

    // Board files moved into folders.
    expect(await exists(join(root, 'boards', 'main', 'board.json'))).toBe(true)
    expect(await exists(join(root, 'boards', 'thettana', 'board.json'))).toBe(true)

    // main got the entities its card references.
    expect(await exists(join(root, 'boards', 'main', 'characters', 'wolf.md'))).toBe(true)
    expect(await exists(join(root, 'boards', 'main', 'timeline', 'ch1.md'))).toBe(true)
    expect(await exists(join(root, 'boards', 'main', 'notes', 'hunt.md'))).toBe(true)

    // Unreferenced character went to the first board (main), not lost.
    expect(await exists(join(root, 'boards', 'main', 'characters', 'lonely.md'))).toBe(true)

    // Old global folders and flat board files are gone.
    expect(await exists(join(root, 'characters'))).toBe(false)
    expect(await exists(join(root, 'boards', 'main.json'))).toBe(false)

    // Backups + version stamp (chains v1→v2→v3).
    expect(await exists(join(root, '.zn-story-line-backup-v1'))).toBe(true)
    expect(await exists(join(root, '.zn-story-line-backup-v2'))).toBe(true)
    const project = JSON.parse(await fs.readFile(join(root, 'project.json'), 'utf8'))
    expect(project.schemaVersion).toBe(3)

    // v3: notes got uids and the card links by uid, not filename.
    const huntRaw = await fs.readFile(join(root, 'boards', 'main', 'notes', 'hunt.md'), 'utf8')
    const uidMatch = huntRaw.match(/uid:\s*(\S+)/)
    expect(uidMatch).not.toBeNull()
    const board = JSON.parse(await fs.readFile(join(root, 'boards', 'main', 'board.json'), 'utf8'))
    expect(board.cards[0].noteFile).toBeUndefined()
    expect(board.cards[0].noteUid).toBe(uidMatch![1])
  })

  it('is idempotent (a second run is a no-op)', async () => {
    await writeV1Project()
    await migrateIfNeeded(root)
    await migrateIfNeeded(root) // should early-return on v2
    const snap = await loadSnapshot(root)
    expect(snap.boards.map((b) => b.board.id).sort()).toEqual(['main', 'thettana'])
    const main = snap.boards.find((b) => b.board.id === 'main')!
    expect(main.characters.map((c) => c.id).sort()).toEqual(['lonely', 'wolf'])
    expect(main.board.cards).toHaveLength(1)
  })
})
