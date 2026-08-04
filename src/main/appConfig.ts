import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { AppConfig, RecentProject } from '@shared/config'
import { DEFAULT_SETTINGS, normalizeEditorStyles } from '@shared/config'

/**
 * App-level config persisted as JSON in Electron's userData dir — recents and
 * global settings live here, never inside a project folder (Requirements §12).
 */

const MAX_RECENTS = 15

const CONFIG_FILE = 'zn-story-line-config.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

/**
 * Where the config lived before the v0.8.0 rename (Issue 18): a different app
 * name meant a different userData dir (`plottr/`) and filename. Read from here
 * once so a user's recents/settings survive the rebrand; the next write lands
 * at the new {@link configPath}.
 */
function legacyConfigPath(): string {
  return join(app.getPath('appData'), 'plottr', 'plottr-config.json')
}

function parseConfig(text: string): AppConfig {
  const parsed = JSON.parse(text) as Partial<AppConfig>
  const settings = { ...DEFAULT_SETTINGS, ...parsed.settings }
  // Coerce legacy single-string preview colours into the per-theme shape (Issue 14).
  settings.editorStyles = normalizeEditorStyles(settings.editorStyles)
  return { recents: parsed.recents ?? [], settings }
}

export async function readConfig(): Promise<AppConfig> {
  try {
    return parseConfig(await fs.readFile(configPath(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  // New location absent — try the pre-rename config and migrate it forward.
  try {
    return parseConfig(await fs.readFile(legacyConfigPath(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { recents: [], settings: { ...DEFAULT_SETTINGS } }
    }
    throw err
  }
}

export async function writeConfig(config: AppConfig): Promise<AppConfig> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

/** Insert/update a recent project at the top of the list (most-recent-first). */
export async function touchRecent(entry: RecentProject): Promise<AppConfig> {
  const config = await readConfig()
  const others = config.recents.filter((r) => r.path !== entry.path)
  config.recents = [entry, ...others].slice(0, MAX_RECENTS)
  return writeConfig(config)
}

export async function removeRecent(path: string): Promise<AppConfig> {
  const config = await readConfig()
  config.recents = config.recents.filter((r) => r.path !== path)
  return writeConfig(config)
}
