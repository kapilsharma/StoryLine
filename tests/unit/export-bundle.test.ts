import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { entityBodyKey, EXPORT_FORMAT_VERSION } from '@shared/export'
import { DEFAULT_SETTINGS } from '@shared/config'
import { createProject } from '@main/projectService'
import { applyThemeToHtml, buildExportBundle, UnknownBoardError } from '@main/data/exportBundle'
import {
  ensureBoardDirs,
  readProject,
  writeBoard,
  writeCharacter,
  writeEntityBody,
  writeNote,
  writeProject,
  writeTimelineUnit
} from '@main/data/repository'

let base: string
let root: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-export-'))
  root = join(base, 'my-novel')
  await fs.mkdir(root)
  await createProject(root)
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

const options = { appVersion: '9.9.9', generatedAt: '2026-08-10T00:00:00.000Z' }

/** Populate the scaffolded `main` board with one of each entity. */
async function seedMain(): Promise<void> {
  await writeCharacter(root, 'main', {
    id: 'aeri',
    type: 'character',
    name: 'Aeri',
    colour: '#22c55e'
  })
  await writeTimelineUnit(root, 'main', { id: 'ch1', label: 'Chapter 1', order: 1 })
  await writeNote(root, 'main', {
    id: 'the-discovery',
    uid: 'n_abc12345',
    title: 'The discovery',
    body: '\nAeri finds the fault in the numbers.\n'
  })
  await writeEntityBody(root, 'main', 'character', 'aeri', '\n## Notes\n\nQuiet, precise.\n')
  await writeEntityBody(root, 'main', 'timeline', 'ch1', '\n## Notes\n\nOpens on the observatory.\n')
}

/** Add a second board so board selection can be exercised. */
async function addBoard(id: string, name: string): Promise<void> {
  await ensureBoardDirs(root, id)
  await writeBoard(root, {
    id,
    name,
    cards: [],
    hiddenRows: [],
    hiddenCols: [],
    presets: [],
    rowOrder: [],
    rowGroupOrder: [],
    colOrder: [],
    collapsedRowGroups: [],
    collapsedColGroups: [],
    zoom: 1
  })
  const { value: project, mtimeMs } = await readProject(root)
  await writeProject(root, { ...project, boards: [...project.boards, id] }, mtimeMs)
}

describe('buildExportBundle', () => {
  it('stamps the format version and the supplied provenance', async () => {
    const bundle = await buildExportBundle(root, options)
    expect(bundle.formatVersion).toBe(EXPORT_FORMAT_VERSION)
    expect(bundle.appVersion).toBe('9.9.9')
    expect(bundle.generatedAt).toBe('2026-08-10T00:00:00.000Z')
  })

  it('includes full note bodies, unlike a live snapshot', async () => {
    await seedMain()
    const bundle = await buildExportBundle(root, options)
    const note = bundle.boards[0].notes.find((n) => n.id === 'the-discovery')
    expect(note?.body).toContain('Aeri finds the fault in the numbers.')
    expect(note?.uid).toBe('n_abc12345')
  })

  it('includes character and timeline markdown bodies', async () => {
    await seedMain()
    const bundle = await buildExportBundle(root, options)
    expect(bundle.entityBodies[entityBodyKey('main', 'character', 'aeri')]).toContain('Quiet, precise.')
    expect(bundle.entityBodies[entityBodyKey('main', 'timeline', 'ch1')]).toContain(
      'Opens on the observatory.'
    )
  })

  it('exports every board when no selection is given', async () => {
    await addBoard('arcs', 'Character Arcs')
    const bundle = await buildExportBundle(root, options)
    expect(bundle.boards.map((bd) => bd.board.id)).toEqual(['main', 'arcs'])
    expect(bundle.project.boards).toEqual(['main', 'arcs'])
  })

  it('exports only the selected boards, and drops the rest from project.boards', async () => {
    await addBoard('arcs', 'Character Arcs')
    const bundle = await buildExportBundle(root, { ...options, boards: ['arcs'] })
    expect(bundle.boards.map((bd) => bd.board.id)).toEqual(['arcs'])
    // Otherwise the web shell would render a tab for a board with no data.
    expect(bundle.project.boards).toEqual(['arcs'])
  })

  it('publishes boards in the order requested', async () => {
    await addBoard('arcs', 'Character Arcs')
    const bundle = await buildExportBundle(root, { ...options, boards: ['arcs', 'main'] })
    expect(bundle.boards.map((bd) => bd.board.id)).toEqual(['arcs', 'main'])
  })

  it('rejects unknown board ids rather than silently exporting nothing', async () => {
    await expect(buildExportBundle(root, { ...options, boards: ['nope'] })).rejects.toBeInstanceOf(
      UnknownBoardError
    )
    await expect(buildExportBundle(root, { ...options, boards: ['nope'] })).rejects.toThrow(/nope/)
  })

  it('never carries recents into the bundle — they hold local absolute paths', async () => {
    const bundle = await buildExportBundle(root, options)
    expect(bundle.settings).toEqual(DEFAULT_SETTINGS)
    expect(JSON.stringify(bundle)).not.toContain('recents')
  })

  it('fails loudly for a folder that is not a project', async () => {
    const empty = join(base, 'not-a-project')
    await fs.mkdir(empty)
    await expect(buildExportBundle(empty, options)).rejects.toThrow(/not a ZN Story Line project/i)
  })
})

describe('theme', () => {
  it('bakes the requested theme into the bundle settings', async () => {
    const dark = await buildExportBundle(root, {
      ...options,
      settings: { ...DEFAULT_SETTINGS, theme: 'dark' }
    })
    expect(dark.settings.theme).toBe('dark')
  })
})

describe('applyThemeToHtml', () => {
  const html = '<!doctype html>\n<html lang="en">\n  <head>\n    <title>x</title>\n  </head>\n</html>'

  it('stamps data-theme on <html>, keeping existing attributes', () => {
    const out = applyThemeToHtml(html, 'dark')
    expect(out).toContain('<html lang="en" data-theme="dark">')
  })

  it('adds a pre-paint background so a dark board does not flash white', () => {
    expect(applyThemeToHtml(html, 'dark')).toContain('<style id="zn-theme-bg">html{background:#1b1c1f}</style>')
    expect(applyThemeToHtml(html, 'light')).toContain('html{background:#ffffff}')
  })

  it('is idempotent — re-applying replaces rather than duplicating', () => {
    const once = applyThemeToHtml(html, 'dark')
    const twice = applyThemeToHtml(once, 'light')
    expect(twice.match(/data-theme=/g)).toHaveLength(1)
    expect(twice.match(/id="zn-theme-bg"/g)).toHaveLength(1)
    expect(twice).toContain('data-theme="light"')
    expect(twice).toContain('html{background:#ffffff}')
  })
})
