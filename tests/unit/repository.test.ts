import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isEmptyEntityBody } from '@shared/entityBody'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  ensureBoardDirs,
  writeCharacter,
  readCharacter,
  listCharacters,
  writeNote,
  readNote,
  writeBoard,
  readBoard,
  listBoardIds,
  readEntityBody,
  writeEntityBody
} from '@main/data/repository'

let root: string
const BID = 'main'

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-repo-'))
  await ensureBoardDirs(root, BID)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('character repository (per board)', () => {
  it('round-trips fields and custom data', async () => {
    await writeCharacter(root, BID, {
      id: 'rowan',
      type: 'character',
      name: 'Rowan',
      colour: '#E24B4A',
      age: 34,
      group: 'Humans',
      custom: { homeland: 'North' }
    })
    const { value } = await readCharacter(root, BID, 'rowan')
    expect(value.name).toBe('Rowan')
    expect(value.age).toBe(34)
    expect(value.group).toBe('Humans')
    expect(value.custom?.homeland).toBe('North')
  })

  it('preserves an externally-edited body across a frontmatter-only write', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    const path = join(root, 'boards', BID, 'characters', 'k.md')
    const raw = (await fs.readFile(path, 'utf8')) + '\n## Notes\n\nExternally authored.\n'
    await fs.writeFile(path, raw)

    const { value } = await readCharacter(root, BID, 'k')
    await writeCharacter(root, BID, { ...value, age: 40 })
    const after = await fs.readFile(path, 'utf8')
    expect(after).toContain('Externally authored.')
    expect(after).toContain('age: 40')
  })

  // Issue #33: the Characters tab reads "has a body" as "a note was written",
  // so a new character must not be seeded with one. (gray-matter always ends the
  // file with a newline, hence `isEmptyEntityBody` rather than `toBe('')`.)
  it('creates a character with no body at all', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    const body = await readEntityBody(root, BID, 'character', 'k')
    expect(body.trim()).toBe('')
    expect(isEmptyEntityBody(body)).toBe(true)
  })

  it('drops a skeleton-only body when the character is next written', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    const path = join(root, 'boards', BID, 'characters', 'k.md')
    await fs.writeFile(path, (await fs.readFile(path, 'utf8')) + '\n## Notes\n\n\n## Research\n\n')

    const { value } = await readCharacter(root, BID, 'k')
    await writeCharacter(root, BID, { ...value, age: 40 })
    const after = await fs.readFile(path, 'utf8')
    expect(after).not.toContain('## Notes')
    expect(after).toContain('age: 40')
  })

  it('does not persist a skeleton-only body written from an editor', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    await writeEntityBody(root, BID, 'character', 'k', '\n## Notes\n\n\n## Research\n\n')
    expect((await readEntityBody(root, BID, 'character', 'k')).trim()).toBe('')
  })

  // Issue #41: the board marks the rows worth clicking, so every character read
  // carries whether its file holds a note.
  it('flags whether a character has a note', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    expect((await readCharacter(root, BID, 'k')).value.hasNote).toBeUndefined()

    // The old skeleton is not a note, so it must not light the row up.
    await writeEntityBody(root, BID, 'character', 'k', '\n## Notes\n\n\n## Research\n\n')
    expect((await readCharacter(root, BID, 'k')).value.hasNote).toBeUndefined()

    await writeEntityBody(root, BID, 'character', 'k', '\n## Notes\n\nQuiet, precise.\n')
    expect((await readCharacter(root, BID, 'k')).value.hasNote).toBe(true)
  })

  it('keeps the derived hasNote flag out of the file', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'K', colour: '#000' })
    await writeEntityBody(root, BID, 'character', 'k', 'Quiet, precise.\n')
    const { value } = await readCharacter(root, BID, 'k')
    await writeCharacter(root, BID, value)
    const raw = await fs.readFile(join(root, 'boards', BID, 'characters', 'k.md'), 'utf8')
    expect(raw).not.toContain('hasNote')
    expect(raw).toContain('Quiet, precise.')
  })

  it('lists characters for the board', async () => {
    await writeCharacter(root, BID, { id: 'a', type: 'character', name: 'A', colour: '#1' })
    await writeCharacter(root, BID, { id: 'b', type: 'character', name: 'B', colour: '#2' })
    expect((await listCharacters(root, BID)).length).toBe(2)
  })

  it('edits the body via writeEntityBody while preserving frontmatter', async () => {
    await writeCharacter(root, BID, { id: 'k', type: 'character', name: 'Rowan', colour: '#E24B4A', age: 34 })
    await writeEntityBody(root, BID, 'character', 'k', '\n## Notes\n\nEdited in the dedicated editor.\n')
    expect(await readEntityBody(root, BID, 'character', 'k')).toContain('Edited in the dedicated editor.')
    // Frontmatter (form fields) untouched.
    const { value } = await readCharacter(root, BID, 'k')
    expect(value.name).toBe('Rowan')
    expect(value.age).toBe(34)
  })
})

describe('note repository (per board)', () => {
  it('round-trips uid, title, related and body', async () => {
    await writeNote(root, BID, {
      id: 'hunt',
      uid: 'n_deadbeef',
      title: 'The Hunt',
      related: [{ file: 'x.md', comment: 'see also' }],
      created: '2026-06-16',
      body: 'Wolf tracks the pigs.\n'
    })
    const { value } = await readNote(root, BID, 'hunt')
    expect(value.uid).toBe('n_deadbeef')
    expect(value.title).toBe('The Hunt')
    expect(value.related?.[0]).toEqual({ file: 'x.md', comment: 'see also' })
    expect(value.body).toContain('Wolf tracks the pigs.')
  })
})

describe('board repository', () => {
  it('round-trips a board (boards/<id>/board.json) with cards and zoom', async () => {
    await writeBoard(root, {
      id: BID,
      name: 'Main',
      cards: [{ id: 'c1', noteUid: 'n_x', rowId: 'wolf', colStart: 'ch1', colEnd: 'ch3' }],
      hiddenRows: [],
      hiddenCols: [],
      presets: [],
      rowOrder: ['wolf'],
      rowGroupOrder: [],
      colOrder: ['ch1', 'ch2', 'ch3'],
      collapsedRowGroups: [],
      collapsedColGroups: [],
      zoom: 1.5
    })
    const { value } = await readBoard(root, BID)
    expect(value.cards[0].colEnd).toBe('ch3')
    expect(value.zoom).toBe(1.5)
    expect(await listBoardIds(root)).toContain(BID)
  })

  it('backfills missing fields on an older board file', async () => {
    await fs.mkdir(join(root, 'boards', 'legacy'), { recursive: true })
    await fs.writeFile(
      join(root, 'boards', 'legacy', 'board.json'),
      JSON.stringify({ id: 'legacy', name: 'Legacy', cards: [] })
    )
    const { value } = await readBoard(root, 'legacy')
    expect(value.rowGroupOrder).toEqual([])
    expect(value.collapsedRowGroups).toEqual([])
    expect(value.zoom).toBe(1)
  })
})
