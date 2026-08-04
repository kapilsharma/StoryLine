import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The v0.8.0 rename (Issue 18) moved the app config: a new userData dir +
 * filename. readConfig must fall back to the pre-rename location
 * (`<appData>/plottr/plottr-config.json`) so recents/settings survive.
 */

const { paths } = vi.hoisted(() => ({ paths: { userData: '', appData: '' } }))

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? paths.userData : paths.appData) }
}))

import { readConfig, writeConfig } from '@main/appConfig'

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'zn-story-line-cfg-'))
  paths.appData = base
  paths.userData = join(base, 'zn-story-line')
  await fs.mkdir(paths.userData, { recursive: true })
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

const writeLegacy = async (config: unknown): Promise<void> => {
  const dir = join(base, 'plottr')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'plottr-config.json'), JSON.stringify(config))
}

describe('appConfig rename migration', () => {
  it('reads the pre-rename config when the new location is absent', async () => {
    await writeLegacy({ recents: [{ name: 'Old', path: '/x', lastOpened: '2026-01-01' }], settings: {} })
    const config = await readConfig()
    expect(config.recents.map((r) => r.name)).toEqual(['Old'])
    // Defaults are still filled in for any missing settings.
    expect(config.settings.theme).toBe('light')
  })

  it('prefers the new-location config over the legacy one', async () => {
    await writeLegacy({ recents: [{ name: 'Old', path: '/x', lastOpened: '2026-01-01' }], settings: {} })
    await writeConfig({ recents: [{ name: 'New', path: '/y', lastOpened: '2026-02-02' }], settings: (await readConfig()).settings })
    const config = await readConfig()
    expect(config.recents.map((r) => r.name)).toEqual(['New'])
  })

  it('returns defaults when neither config exists', async () => {
    const config = await readConfig()
    expect(config.recents).toEqual([])
    expect(config.settings.theme).toBe('light')
  })

  it('writeConfig lands at the new userData location', async () => {
    await writeConfig({ recents: [], settings: (await readConfig()).settings })
    await expect(fs.access(join(paths.userData, 'zn-story-line-config.json'))).resolves.toBeUndefined()
  })
})
