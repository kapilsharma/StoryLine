import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SCHEMA_VERSION } from '@shared/types'
import {
  ensureBoardDirs,
  writeBoard,
  writeCharacter,
  writeEntityBody,
  writeNote,
  writeProject,
  writeTimelineUnit
} from '@main/data/repository'
import { defaultBoard } from '@main/projectService'
import { invalidateSearchIndex, searchProject } from '@main/data/searchIndex'

/**
 * The main-process search index (Issues #59, #60).
 *
 * Exercised against a real project on disk, because the whole point of the file
 * is reading bodies that the project snapshot deliberately does not carry — a
 * test against in-memory fixtures would skip the part that can break.
 */

let root: string

async function board(id: string): Promise<void> {
  await ensureBoardDirs(root, id)
  await writeBoard(root, defaultBoard(id, id))
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'zn-search-'))
  await board('adm')
  await board('concepts')
  await writeProject(root, {
    schemaVersion: SCHEMA_VERSION,
    name: 'T',
    timelineLabel: 'Section',
    boards: ['adm', 'concepts'],
    created: '',
    lastOpened: '',
    families: {}
  })

  await writeNote(root, 'adm', {
    id: 'phase-e',
    uid: 'n_0001',
    title: 'Opportunities',
    tags: ['phase'],
    body: 'Consolidate the gap analysis into work packages.'
  })
  await writeNote(root, 'adm', {
    id: 'phase-f',
    uid: 'n_0002',
    title: 'Migration Planning',
    tags: ['phase'],
    body: 'Assign a business value to each work package.'
  })
  await writeNote(root, 'concepts', {
    id: 'gap',
    uid: 'n_0003',
    title: 'Gap',
    tags: ['definition'],
    body: 'A statement of difference between two states.'
  })

  await writeCharacter(root, 'adm', {
    id: 'preliminary',
    type: 'character',
    name: 'Preliminary Phase',
    colour: '#111',
    tags: ['row']
  })
  await writeEntityBody(root, 'adm', 'character', 'preliminary', 'Establishes the architecture capability.')

  await writeTimelineUnit(root, 'adm', { id: 'objectives', label: 'Objectives', order: 1 })
  await writeEntityBody(root, 'adm', 'timeline', 'objectives', 'What the phase must achieve.')

  invalidateSearchIndex()
})

afterEach(async () => {
  invalidateSearchIndex()
  await fs.rm(root, { recursive: true, force: true })
})

describe('searchProject', () => {
  it('finds a phrase that exists only in a note body (#59)', async () => {
    // Substring match, so the singular in one note and the plural in the other
    // both hit — and neither word is in either title.
    const hits = await searchProject(root, 'work package')
    expect(hits.map((h) => h.id).sort()).toEqual(['phase-e', 'phase-f'])
    expect(hits[0].where).toBe('body')
    expect(hits[0].snippet).toContain('work package')
  })

  it('searches every board by default (#60)', async () => {
    const hits = await searchProject(root, 'difference')
    expect(hits).toHaveLength(1)
    expect(hits[0].boardId).toBe('concepts')
  })

  it('restricts to the requested boards', async () => {
    expect(await searchProject(root, 'difference', { boardIds: ['adm'] })).toEqual([])
    expect(await searchProject(root, 'gap', { boardIds: ['adm'] })).toHaveLength(1)
  })

  it('indexes character bodies, which are notes too', async () => {
    const hits = await searchProject(root, 'architecture capability')
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('character')
    expect(hits[0].id).toBe('preliminary')
  })

  it('indexes timeline bodies', async () => {
    const hits = await searchProject(root, 'must achieve')
    expect(hits[0].kind).toBe('timeline')
    expect(hits[0].id).toBe('objectives')
  })

  it('filters by kind', async () => {
    const hits = await searchProject(root, 'phase', { kinds: ['character'] })
    expect(hits.every((h) => h.kind === 'character')).toBe(true)
  })

  it('filters by tag', async () => {
    const hits = await searchProject(root, 'gap', { tag: 'definition' })
    expect(hits.map((h) => h.id)).toEqual(['gap'])
  })

  it('returns everything for an empty query', async () => {
    // 3 notes + 1 character + 1 timeline unit.
    expect(await searchProject(root, '')).toHaveLength(5)
  })

  it('honours a limit', async () => {
    expect(await searchProject(root, '', { limit: 2 })).toHaveLength(2)
  })

  it('finds nothing for a term present nowhere', async () => {
    expect(await searchProject(root, 'zzzznotpresent')).toEqual([])
  })
})

describe('cache invalidation', () => {
  it('serves a second identical query from cache', async () => {
    const first = await searchProject(root, 'work package')
    const second = await searchProject(root, 'work package')
    expect(second).toEqual(first)
  })

  it('does NOT see a new note until the index is invalidated', async () => {
    await searchProject(root, 'newly') // warm the cache
    await writeNote(root, 'adm', {
      id: 'fresh',
      uid: 'n_0009',
      title: 'Fresh',
      body: 'A newly written note.'
    })
    // This is the contract, not a bug: the app invalidates on every write
    // (`snap`) and on every watcher event, so callers never observe this.
    expect(await searchProject(root, 'newly')).toEqual([])

    invalidateSearchIndex(root)
    expect(await searchProject(root, 'newly')).toHaveLength(1)
  })

  it('invalidating one root leaves others alone', async () => {
    // "gap" is a title on `concepts` and appears in "gap analysis" on `adm`.
    expect(await searchProject(root, 'gap')).toHaveLength(2)
    invalidateSearchIndex('/some/other/project')
    expect(await searchProject(root, 'gap')).toHaveLength(2)
  })

  it('invalidating with no argument clears everything, and the index rebuilds', async () => {
    expect(await searchProject(root, 'gap')).toHaveLength(2)
    invalidateSearchIndex()
    expect(await searchProject(root, 'gap')).toHaveLength(2)
  })
})
