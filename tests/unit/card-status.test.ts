import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SCHEMA_VERSION, type Project } from '@shared/types'
import {
  DEFAULT_CARD_STATUSES,
  cardStatuses,
  finalizeCardStatuses,
  findCardStatus,
  normalizeCardStatuses
} from '@shared/cardStatus'
import { applyMeta, readMeta } from '@shared/project'
import { frontmatterToNote, noteToFrontmatter } from '@main/data/mappers'
import { readProject } from '@main/data/repository'

/**
 * Card status (Issue #108). The list is per project and optional on disk —
 * absent means the built-in set, so existing project.json files round-trip
 * unchanged. The value is a note's `status:` id.
 */

const project = (over: Partial<Project> = {}): Project => ({
  schemaVersion: SCHEMA_VERSION,
  name: 'Thettana',
  timelineLabel: 'Chapter',
  boards: ['main'],
  created: '2026-01-01',
  lastOpened: '2026-01-01',
  families: {},
  ...over
})

describe('cardStatuses', () => {
  it('is the built-in set when the project has none stored', () => {
    expect(cardStatuses(project())).toBe(DEFAULT_CARD_STATUSES)
    expect(DEFAULT_CARD_STATUSES.map((s) => s.icon)).toEqual(['💡', '⚡', '🌓', '🚩', '✅'])
  })

  it('honours an explicitly empty list', () => {
    expect(cardStatuses(project({ cardStatuses: [] }))).toEqual([])
  })
})

describe('findCardStatus', () => {
  it('finds by id, and gives nothing for none or an undefined id', () => {
    expect(findCardStatus(DEFAULT_CARD_STATUSES, 'done')?.icon).toBe('✅')
    expect(findCardStatus(DEFAULT_CARD_STATUSES, undefined)).toBeUndefined()
    expect(findCardStatus(DEFAULT_CARD_STATUSES, 'retired')).toBeUndefined()
  })
})

describe('normalizeCardStatuses', () => {
  it('is undefined for anything but an array, so the defaults apply', () => {
    expect(normalizeCardStatuses(undefined)).toBeUndefined()
    expect(normalizeCardStatuses('nope')).toBeUndefined()
  })

  it('drops entries with no id and repeated ids, and fills missing text', () => {
    expect(
      normalizeCardStatuses([
        { id: 'a', icon: '1', label: 'One' },
        { icon: '2', label: 'No id' },
        'junk',
        { id: 'a', icon: '3', label: 'Dup' },
        { id: ' b ' }
      ])
    ).toEqual([
      { id: 'a', icon: '1', label: 'One' },
      { id: 'b', icon: '', label: 'b' }
    ])
  })
})

describe('finalizeCardStatuses', () => {
  it('keeps existing ids, gives a new row a unique slug, and drops blank rows', () => {
    expect(
      finalizeCardStatuses([
        { id: 'draft', icon: ' 🌓 ', label: ' Renamed ' },
        { id: '', icon: '', label: '' },
        { id: '', icon: '📕', label: 'Draft' },
        { id: '', icon: '📗', label: 'Draft' },
        { id: '', icon: '★', label: '' }
      ])
    ).toEqual([
      { id: 'draft', icon: '🌓', label: 'Renamed' },
      { id: 'draft-2', icon: '📕', label: 'Draft' },
      { id: 'draft-3', icon: '📗', label: 'Draft' },
      { id: 'status', icon: '★', label: '' }
    ])
  })
})

describe('readMeta / applyMeta', () => {
  it('writes no key while the list is the built-in set', () => {
    const after = applyMeta(project(), readMeta(project()))
    expect(after.cardStatuses).toBeUndefined()
  })

  it('writes an edited list, and an emptied one', () => {
    const edited = applyMeta(project(), {
      ...readMeta(project()),
      cardStatuses: [{ id: '', icon: '⬜', label: 'To do' }]
    })
    expect(edited.cardStatuses).toEqual([{ id: 'to-do', icon: '⬜', label: 'To do' }])

    const none = applyMeta(project(), { ...readMeta(project()), cardStatuses: [] })
    expect(none.cardStatuses).toEqual([])
  })

  it('drops the key again when reset to the defaults', () => {
    const custom = project({ cardStatuses: [{ id: 'x', icon: 'x', label: 'x' }] })
    const after = applyMeta(custom, { ...readMeta(custom), cardStatuses: DEFAULT_CARD_STATUSES })
    expect(after.cardStatuses).toBeUndefined()
  })
})

describe('note status in frontmatter', () => {
  it('reads and writes `status:`', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T', status: ' draft ' }, 't', '')
    expect(note.status).toBe('draft')
    expect(noteToFrontmatter(note)).toMatchObject({ status: 'draft' })
  })

  it('writes no key for a note without one', () => {
    const note = frontmatterToNote({ uid: 'n_1', title: 'T' }, 't', '')
    expect(note.status).toBeUndefined()
    expect('status' in noteToFrontmatter(note)).toBe(false)
  })
})

describe('project.json', () => {
  let dir: string | null = null
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true })
    dir = null
  })

  const load = async (json: object): Promise<Project> => {
    dir = await fs.mkdtemp(join(tmpdir(), 'zn-status-'))
    await fs.writeFile(join(dir, 'project.json'), JSON.stringify(json))
    return (await readProject(dir)).value
  }

  it('leaves cardStatuses absent on a project that never set it', async () => {
    const p = await load({ name: 'P', boards: [] })
    expect('cardStatuses' in p).toBe(false)
  })

  it('reads a stored list leniently, keeping an explicit empty one', async () => {
    expect((await load({ name: 'P', cardStatuses: [] })).cardStatuses).toEqual([])
    expect(
      (await load({ name: 'P', cardStatuses: [{ id: 'a', icon: '1', label: 'One' }, { nope: 1 }] }))
        .cardStatuses
    ).toEqual([{ id: 'a', icon: '1', label: 'One' }])
  })
})
