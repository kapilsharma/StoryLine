import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateIfNeeded } from '@main/data/migrate'
import { loadSnapshot } from '@main/projectService'
import { orderedLeaves } from '@shared/columns'
import { SCHEMA_VERSION } from '@shared/types'

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

    // Backups + version stamp (chains v1→v2→v3→v4).
    expect(await exists(join(root, '.zn-story-line-backup-v1'))).toBe(true)
    expect(await exists(join(root, '.zn-story-line-backup-v2'))).toBe(true)
    expect(await exists(join(root, '.zn-story-line-backup-v3'))).toBe(true)
    const project = JSON.parse(await fs.readFile(join(root, 'project.json'), 'utf8'))
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)

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

// ── v3 → v4: groups become entities (Issue #104) ───────────────────────────────

/** A unit file as schema v3 wrote it: a `group` string, a *global* `order`. */
const v3Unit = (id: string, order: number, group?: string, body = '\n## Notes\n\n\n## Research\n\n'): string =>
  `---\nid: ${id}\nlabel: ${id.toUpperCase()}\norder: ${order}\n${group ? `group: ${group}\n` : ''}---\n${body}`

async function writeV3Project(opts: {
  units: Array<[id: string, order: number, group?: string, body?: string]>
  collapsed?: string[]
  extraProject?: Record<string, unknown>
}): Promise<void> {
  const boardDir = join(root, 'boards', 'main')
  await fs.mkdir(join(boardDir, 'timeline'), { recursive: true })
  for (const [id, order, group, body] of opts.units) {
    await fs.writeFile(join(boardDir, 'timeline', `${id}.md`), v3Unit(id, order, group, body))
  }
  await fs.writeFile(
    join(boardDir, 'board.json'),
    JSON.stringify({ id: 'main', name: 'Main', cards: [], collapsedColGroups: opts.collapsed ?? [] })
  )
  await fs.writeFile(
    join(root, 'project.json'),
    JSON.stringify({
      schemaVersion: 3,
      name: 'Story',
      timelineLabel: 'Chapter',
      boards: ['main'],
      ...opts.extraProject
    })
  )
}

const readProject = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(join(root, 'project.json'), 'utf8'))

describe('v3 → v4 migration', () => {
  it('turns each distinct group label into a group entity with an empty note', async () => {
    await writeV3Project({
      units: [['s1', 1, 'Act 1'], ['s2', 2, 'Act 1'], ['s3', 3, 'Act 2']]
    })
    await migrateIfNeeded(root)

    const snap = await loadSnapshot(root)
    const main = snap.boards[0]
    expect(main.colGroups.map((g) => [g.id, g.label])).toEqual([
      ['act-1', 'Act 1'],
      ['act-2', 'Act 2']
    ])
    expect(main.colGroups.every((g) => !g.hasNote)).toBe(true)
    expect(main.timeline.find((t) => t.id === 's1')?.parent).toBe('act-1')
    expect(main.timeline.find((t) => t.id === 's3')?.parent).toBe('act-2')
  })

  it('removes `group` from every unit file and keeps the rest of it (body included)', async () => {
    await writeV3Project({ units: [['s1', 1, 'Act 1', '\nWhat happens here.\n']] })
    await migrateIfNeeded(root)

    const raw = await fs.readFile(join(root, 'boards', 'main', 'timeline', 's1.md'), 'utf8')
    expect(raw).not.toMatch(/^group:/m)
    expect(raw).toMatch(/^parent: act-1$/m)
    expect(raw).toContain('What happens here.')
    expect(raw).toMatch(/^label: S1$/m)
  })

  it('draws the same columns in the same order as the old layout did', async () => {
    // The old layout gathered every unit sharing a label into one block, at the
    // position of the first — so "Act 1" below pulls s4 up beside s1 and s2.
    await writeV3Project({
      units: [
        ['s1', 1, 'Act 1'],
        ['s2', 2],
        ['s3', 3, 'Act 2'],
        ['s4', 4, 'Act 1'],
        ['s5', 5]
      ]
    })
    await migrateIfNeeded(root)

    const main = (await loadSnapshot(root)).boards[0]
    expect(orderedLeaves(main.colGroups, main.timeline).map((u) => u.id)).toEqual([
      's1',
      's4', // gathered into Act 1
      's2',
      's3',
      's5'
    ])
  })

  it('numbers `order` among siblings rather than globally', async () => {
    await writeV3Project({ units: [['s1', 10, 'A'], ['s2', 20, 'A'], ['s3', 30]] })
    await migrateIfNeeded(root)

    const main = (await loadSnapshot(root)).boards[0]
    const order = Object.fromEntries(main.timeline.map((t) => [t.id, t.order]))
    expect(order).toMatchObject({ s1: 1, s2: 2 }) // within the group
    expect(order.s3).toBe(2) // after the group, which is 1st at the top
    expect(main.colGroups[0].order).toBe(1)
  })

  it('carries collapsed groups from labels to ids, dropping labels that match nothing', async () => {
    await writeV3Project({
      units: [['s1', 1, 'Act 1']],
      collapsed: ['Act 1', 'No Such Group']
    })
    await migrateIfNeeded(root)

    const board = JSON.parse(await fs.readFile(join(root, 'boards', 'main', 'board.json'), 'utf8'))
    expect(board.collapsedColGroups).toEqual(['act-1'])
  })

  it('names the two levels it produced, keeping the existing label for the deepest', async () => {
    await writeV3Project({ units: [['s1', 1, 'Act 1']], extraProject: { timelineLabel: 'Scene' } })
    await migrateIfNeeded(root)

    const project = await readProject()
    expect(project.timelineLevelLabels).toEqual(['Group', 'Scene'])
    expect(project.timelineLabel).toBe('Scene')
    expect(project.schemaVersion).toBe(4)
  })

  it('leaves a project that never used groups flat — no levels, no group files', async () => {
    await writeV3Project({ units: [['s1', 1], ['s2', 2]] })
    await migrateIfNeeded(root)

    expect((await readProject()).timelineLevelLabels).toBeUndefined()
    expect(await exists(join(root, 'boards', 'main', 'colgroups'))).toBe(false)
    const main = (await loadSnapshot(root)).boards[0]
    expect(main.colGroups).toEqual([])
    expect(main.timeline.every((t) => t.parent === undefined)).toBe(true)
  })

  it('does not overwrite level labels that already exist', async () => {
    await writeV3Project({
      units: [['s1', 1, 'Act 1']],
      extraProject: { timelineLevelLabels: ['Part', 'Chapter'] }
    })
    await migrateIfNeeded(root)
    expect((await readProject()).timelineLevelLabels).toEqual(['Part', 'Chapter'])
  })

  it('backs the project up first', async () => {
    await writeV3Project({ units: [['s1', 1, 'Act 1']] })
    await migrateIfNeeded(root)

    const backed = await fs.readFile(join(root, '.zn-story-line-backup-v3', 'boards', 'main', 'timeline', 's1.md'), 'utf8')
    expect(backed).toMatch(/^group: Act 1$/m) // the original, untouched
    const oldProject = JSON.parse(await fs.readFile(join(root, '.zn-story-line-backup-v3', 'project.json'), 'utf8'))
    expect(oldProject.schemaVersion).toBe(3)
  })

  it('is a no-op the second time', async () => {
    await writeV3Project({ units: [['s1', 1, 'Act 1'], ['s2', 2]] })
    await migrateIfNeeded(root)
    const first = await loadSnapshot(root)
    await migrateIfNeeded(root)
    const second = await loadSnapshot(root)
    expect(second.boards[0].colGroups).toEqual(first.boards[0].colGroups)
    expect(second.boards[0].timeline).toEqual(first.boards[0].timeline)
  })

  it('migrates every board of a project, each with its own groups', async () => {
    await writeV3Project({ units: [['s1', 1, 'Act 1']] })
    const second = join(root, 'boards', 'second')
    await fs.mkdir(join(second, 'timeline'), { recursive: true })
    await fs.writeFile(join(second, 'timeline', 'x1.md'), v3Unit('x1', 1, 'Act 1'))
    await fs.writeFile(join(second, 'board.json'), JSON.stringify({ id: 'second', name: 'Second', cards: [] }))
    await migrateIfNeeded(root)

    const snap = await loadSnapshot(root)
    expect(snap.boards.map((b) => b.colGroups.map((g) => g.id))).toEqual([['act-1'], ['act-1']])
  })
})
