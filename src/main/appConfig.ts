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

/**
 * Written to a temp file and renamed over the real one, so a read never sees
 * the file half-written. A plain `writeFile` truncates first: a read landing in
 * that gap got an empty file and "Unexpected end of JSON input".
 */
export async function writeConfig(config: AppConfig): Promise<AppConfig> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  const text = JSON.stringify(config, null, 2) + '\n'
  const tmp = `${configPath()}.${process.pid}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  try {
    await fs.rename(tmp, configPath())
  } catch {
    // Windows can refuse the rename while something (an AV scan) holds the
    // target. Fall back to a direct write rather than lose the change.
    await fs.writeFile(configPath(), text, 'utf8')
    await fs.rm(tmp, { force: true })
  }
  return config
}

/** Tail of the queue every read-modify-write of the config goes through. */
let pending: Promise<unknown> = Promise.resolve()

/**
 * Read the config, change it, write it back — one call at a time. Saves can
 * arrive back to back (a slider drag; StrictMode running an updater twice), and
 * two overlapping read-modify-writes would each drop the other's change.
 */
export function updateConfig(change: (config: AppConfig) => AppConfig): Promise<AppConfig> {
  const next = pending.then(async () => writeConfig(change(await readConfig())))
  pending = next.catch(() => undefined)
  return next
}

/** Insert/update a recent project at the top of the list (most-recent-first). */
export function touchRecent(entry: RecentProject): Promise<AppConfig> {
  return updateConfig((config) => {
    const others = config.recents.filter((r) => r.path !== entry.path)
    return { ...config, recents: [entry, ...others].slice(0, MAX_RECENTS) }
  })
}

export function removeRecent(path: string): Promise<AppConfig> {
  return updateConfig((config) => ({
    ...config,
    recents: config.recents.filter((r) => r.path !== path)
  }))
}
