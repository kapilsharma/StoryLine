/**
 * Read the desktop app's own settings (colours, theme, etc.) for use by
 * export-static.mts, without importing 'electron' — this script runs standalone
 * via tsx, not inside a running Electron app, so `app.getPath` isn't available.
 * Mirrors src/main/appConfig.ts's readConfig()/legacy fallback by replicating
 * Electron's default userData path for each OS.
 */
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppConfig, AppSettings } from '@shared/config'
import { DEFAULT_SETTINGS, normalizeEditorStyles } from '@shared/config'

const APP_NAME = 'ZN Story Line'
const CONFIG_FILE = 'zn-story-line-config.json'
const LEGACY_APP_NAME = 'plottr'
const LEGACY_CONFIG_FILE = 'plottr-config.json'

/** Electron's default app.getPath('userData') for `appName`, per OS. */
function userDataDir(appName: string): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', appName)
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appName)
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appName)
  }
}

function parseSettings(text: string): AppSettings {
  const parsed = JSON.parse(text) as Partial<AppConfig>
  const settings = { ...DEFAULT_SETTINGS, ...parsed.settings }
  settings.editorStyles = normalizeEditorStyles(settings.editorStyles)
  return settings
}

async function readIfExists(path: string): Promise<AppSettings | undefined> {
  try {
    return parseSettings(await fs.readFile(path, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

/**
 * `explicitPath`, if given, must point at a config JSON of the same shape the
 * desktop app writes (`{ recents, settings }`) — e.g. one copied over from
 * another machine. Otherwise, look for this machine's local config, falling
 * back to the pre-rename location so a user's real settings are picked up even
 * if they haven't touched Settings since the v0.8.0 rename.
 */
export async function readLocalSettings(explicitPath?: string): Promise<AppSettings> {
  if (explicitPath) {
    const settings = await readIfExists(explicitPath)
    if (!settings) throw new Error(`--settings file not found: ${explicitPath}`)
    return settings
  }
  return (
    (await readIfExists(join(userDataDir(APP_NAME), CONFIG_FILE))) ??
    (await readIfExists(join(userDataDir(LEGACY_APP_NAME), LEGACY_CONFIG_FILE))) ??
    { ...DEFAULT_SETTINGS }
  )
}
