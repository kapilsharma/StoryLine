import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StaticExportResult } from '@shared/ipc'
import { PROJECT_GROUP_SCHEMA_VERSION } from '@shared/projectGroup'

/**
 * Exercises the real `static:export` IPC handler body (Issue #101: exporting
 * every project in a `projectgroup.json` from the UI, not just the current
 * one), the same way `ipc-boards.test.ts` exercises the board handlers —
 * `electron` is mocked so `dialog`/`app` calls are captured/scripted instead
 * of hitting real native UI or a packaged app path.
 */

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  appPath: '',
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => state.handlers.set(ch, fn) },
  app: {
    getPath: () => require('os').tmpdir(),
    getAppPath: () => state.appPath,
    getVersion: () => '0.0.0-test',
    isPackaged: false
  },
  dialog: { showMessageBox: state.showMessageBox, showOpenDialog: state.showOpenDialog },
  BrowserWindow: class {
    isDestroyed(): boolean {
      return false
    }
    webContents = { send: (): void => {} }
  }
}))

import { registerIpc } from '@main/ipc'
import { createProject, currentRoot } from '@main/projectService'

const exists = (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false
  )

const invoke = (root: string): Promise<StaticExportResult | null> => {
  const fn = state.handlers.get('static:export')
  if (!fn) throw new Error('no handler registered for static:export')
  return Promise.resolve(fn({}, root) as Promise<StaticExportResult | null>)
}

/** Native folder-picker result: always "pick this exact folder". */
const pick = (dir: string): void => {
  state.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] })
}

let base: string // group root: projectgroup.json + member folders
let appDir: string // fake app install dir, holds out/web/index.html

async function writeGroupFile(overrides: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(
    join(base, 'projectgroup.json'),
    JSON.stringify({
      schemaVersion: PROJECT_GROUP_SCHEMA_VERSION,
      name: 'My Story Universe',
      projects: ['proj-a', 'proj-b'],
      ...overrides
    })
  )
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-group-export-'))
  appDir = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-app-'))
  await fs.mkdir(join(appDir, 'out', 'web'), { recursive: true })
  await fs.writeFile(join(appDir, 'out', 'web', 'index.html'), '<html><head></head><body></body></html>')
  state.appPath = appDir

  state.handlers.clear()
  state.showMessageBox.mockReset()
  state.showOpenDialog.mockReset()
  registerIpc({} as never)
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
  await fs.rm(appDir, { recursive: true, force: true })
})

describe('static:export — ungrouped project', () => {
  it('exports exactly as before: no group prompt, single project, no `projects` field', async () => {
    const root = join(base, 'solo')
    await fs.mkdir(root)
    await createProject(root)

    const outDir = join(base, 'out')
    pick(outDir)

    const result = await invoke(root)
    expect(state.showMessageBox).not.toHaveBeenCalled()
    expect(result?.outDir).toBe(outDir)
    expect(result?.projects).toBeUndefined()
    expect(await exists(join(outDir, 'snapshot.js'))).toBe(true)
  })
})

describe('static:export — grouped project, "Current project only"', () => {
  it('behaves exactly like an ungrouped export: outDir holds this project alone', async () => {
    const projA = join(base, 'proj-a')
    const projB = join(base, 'proj-b')
    await fs.mkdir(projA)
    await fs.mkdir(projB)
    await createProject(projA)
    await createProject(projB)
    await writeGroupFile()

    // Current vs All prompt: pick "Current project only" (index 1).
    state.showMessageBox.mockResolvedValueOnce({ response: 1 })
    const outDir = join(base, 'out')
    pick(outDir)

    const result = await invoke(projA)
    expect(result?.projects).toBeUndefined()
    expect(result?.outDir).toBe(outDir)
    // Written straight into outDir, not outDir/proj-a.
    expect(await exists(join(outDir, 'snapshot.js'))).toBe(true)
    expect(await exists(join(outDir, 'proj-a'))).toBe(false)
  })
})

describe('static:export — grouped project, "All projects"', () => {
  it('exports every member into its own outDir/<folder> and writes one shared group.js', async () => {
    const projA = join(base, 'proj-a')
    const projB = join(base, 'proj-b')
    await fs.mkdir(projA)
    await fs.mkdir(projB)
    await createProject(projA)
    await createProject(projB)
    await writeGroupFile()

    // Current vs All prompt: pick "All 2 projects" (index 2).
    state.showMessageBox.mockResolvedValueOnce({ response: 2 })
    const outDir = join(base, 'out')
    pick(outDir)

    const result = await invoke(projA)
    expect(result?.projects?.map((p) => p.folder).sort()).toEqual(['proj-a', 'proj-b'])
    expect(await exists(join(outDir, 'proj-a', 'snapshot.js'))).toBe(true)
    expect(await exists(join(outDir, 'proj-b', 'snapshot.js'))).toBe(true)
    // One shared dropdown manifest in the parent, not a copy per member.
    const groupJs = await fs.readFile(join(outDir, 'group.js'), 'utf8')
    expect(groupJs).toContain('proj-a')
    expect(groupJs).toContain('proj-b')
  })

  it('restores the app\'s "currently open project" bookkeeping once the whole group is done', async () => {
    const projA = join(base, 'proj-a')
    const projB = join(base, 'proj-b')
    await fs.mkdir(projA)
    await fs.mkdir(projB)
    await createProject(projA)
    await createProject(projB)
    await writeGroupFile()

    state.showMessageBox.mockResolvedValueOnce({ response: 2 })
    pick(join(base, 'out'))

    await invoke(projA)
    // Exporting proj-b last shouldn't leave the asset protocol resolving
    // against proj-b's folder instead of the project actually open.
    expect(currentRoot()).toBe(projA)
  })

  it('aborts the whole group when one member fails to build, after the other already resolved', async () => {
    const projA = join(base, 'proj-a')
    const projB = join(base, 'proj-b')
    await fs.mkdir(projA)
    await fs.mkdir(projB)
    await createProject(projA)
    await createProject(projB)
    // Corrupt proj-b's board data (not its project.json) so it fails deep in
    // `loadSnapshot`, not in `resolveProjectGroup`'s own validation (which
    // only reads each member's `name`) — exercises the loop's own
    // abort-on-failure, not the group file's pre-existing validation.
    await fs.writeFile(join(projB, 'boards', 'main', 'board.json'), 'not json')
    await writeGroupFile()

    state.showMessageBox.mockResolvedValueOnce({ response: 2 })
    pick(join(base, 'out'))

    await expect(invoke(projA)).rejects.toThrow(/proj-b/)
  })

  it('warns before migrating a sibling the user never opened, and aborts on Cancel', async () => {
    const projA = join(base, 'proj-a')
    const projB = join(base, 'proj-b')
    await fs.mkdir(projA)
    await fs.mkdir(projB)
    await createProject(projA)
    await createProject(projB)
    // Stamp proj-b as an older schema without touching its (already current) layout —
    // enough for `needsMigration` to flag it without needing a full legacy fixture.
    const projectJsonPath = join(projB, 'project.json')
    const projectJson = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'))
    await fs.writeFile(projectJsonPath, JSON.stringify({ ...projectJson, schemaVersion: 1 }))
    await writeGroupFile()

    state.showMessageBox.mockResolvedValueOnce({ response: 2 }) // All projects
    state.showMessageBox.mockResolvedValueOnce({ response: 0 }) // Cancel the migration warning

    const outDir = join(base, 'out')
    const result = await invoke(projA)

    expect(result).toBeNull()
    expect(state.showOpenDialog).not.toHaveBeenCalled() // never got to the folder picker
    expect(await exists(outDir)).toBe(false)
  })
})
