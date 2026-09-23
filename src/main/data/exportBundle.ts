import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { EXPORT_FORMAT_VERSION, SNAPSHOT_GLOBAL, entityBodyKey, type ExportBundle } from '@shared/export'
import { DEFAULT_SETTINGS, type AppSettings, type Theme } from '@shared/config'
import { ASSETS_DIR } from '@shared/assets'
import type { BoardData } from '@shared/ipc'
import { loadSnapshot } from '../projectService'
import { listNotes, readEntityBody } from './repository'
import {
  applyGroupScriptToHtml,
  groupManifestSource,
  resolveProjectGroup,
  type ResolvedProjectGroup
} from './projectGroup'

/**
 * Builds the {@link ExportBundle} for a static export.
 *
 * Deliberately reuses `loadSnapshot` — including its schema migration — so an
 * export can never disagree with what the desktop app would show. Two things it
 * adds on top of a live snapshot: full note bodies (a static site has no lazy
 * loader) and the character/timeline markdown bodies the editor reads.
 *
 * Pure Node: no Electron, so it runs from a plain script.
 */

export interface ExportOptions {
  /** Board ids to include, in the order given. Omit/empty for every board. */
  boards?: string[]
  /** Appearance settings to bake in. Defaults to {@link DEFAULT_SETTINGS}. */
  settings?: AppSettings
  /** Stamped into the bundle as the producing app version. */
  appVersion: string
  /** ISO timestamp; injected so tests and reproducible builds can pin it. */
  generatedAt: string
}

/**
 * Page background per theme, mirroring `--bg` in `src/renderer/src/index.css`.
 * Duplicated deliberately: see {@link applyThemeToHtml}.
 */
const THEME_BG: Record<Theme, string> = { light: '#ffffff', dark: '#1b1c1f' }

/**
 * Stamp the exported theme into `index.html`.
 *
 * The web build inlines its CSS into the (deferred) JS bundle, so nothing is
 * styled until that whole file has parsed — which means a dark board would flash
 * white first. Setting `data-theme` up front, plus a one-line inline background,
 * paints the right colour immediately. It has to be a `<style>` rather than a
 * script because the page's CSP allows inline styles but not inline scripts.
 *
 * Safe to re-apply to already-stamped html.
 */
export function applyThemeToHtml(html: string, theme: Theme): string {
  const stamped = html.replace(/<html([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s*data-theme="[^"]*"/gi, '')
    return `<html${cleaned} data-theme="${theme}">`
  })
  const style = `<style id="zn-theme-bg">html{background:${THEME_BG[theme]}}</style>`
  return /<style id="zn-theme-bg">[^<]*<\/style>/i.test(stamped)
    ? stamped.replace(/<style id="zn-theme-bg">[^<]*<\/style>/i, style)
    : stamped.replace('</head>', `  ${style}\n  </head>`)
}

/** Thrown when `--boards` names something the project doesn't have. */
export class UnknownBoardError extends Error {
  constructor(
    readonly requested: string[],
    readonly available: string[]
  ) {
    super(
      `Unknown board id(s): ${requested.join(', ')}. ` +
        `Available: ${available.join(', ') || '(none)'}`
    )
    this.name = 'UnknownBoardError'
  }
}

export async function buildExportBundle(root: string, options: ExportOptions): Promise<ExportBundle> {
  const snapshot = await loadSnapshot(root)
  const available = snapshot.boards.map((bd) => bd.board.id)

  const requested = options.boards?.filter((id) => id.length > 0) ?? []
  if (requested.length > 0) {
    const missing = requested.filter((id) => !available.includes(id))
    if (missing.length > 0) throw new UnknownBoardError(missing, available)
  }
  // Selection order wins when given, so `--boards b,a` publishes tabs in that order.
  const selected = requested.length > 0 ? requested : available

  const boards: BoardData[] = []
  const entityBodies: Record<string, string> = {}

  for (const boardId of selected) {
    const boardData = snapshot.boards.find((bd) => bd.board.id === boardId)
    if (!boardData) continue

    // Snapshot notes are metadata-only (bodies are lazy in the app); the export
    // needs them in full.
    const notes = await listNotes(root, boardId)
    boards.push({ ...boardData, notes })

    for (const character of boardData.characters) {
      entityBodies[entityBodyKey(boardId, 'character', character.id)] = await readEntityBody(
        root,
        boardId,
        'character',
        character.id
      )
    }
    for (const unit of boardData.timeline) {
      entityBodies[entityBodyKey(boardId, 'timeline', unit.id)] = await readEntityBody(
        root,
        boardId,
        'timeline',
        unit.id
      )
    }
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: options.generatedAt,
    appVersion: options.appVersion,
    project: { ...snapshot.project, boards: selected },
    boards,
    entityBodies,
    settings: options.settings ?? { ...DEFAULT_SETTINGS }
  }
}

/** Written into the output folder so a re-export knows it may clean it. */
const EXPORT_MARKER = '.zn-story-line-export'

/**
 * Make `dir` an empty, writable output folder.
 *
 * Refuses to clean a non-empty folder it didn't create, so a mistyped output
 * path can't wipe something else. `force` overrides.
 */
async function prepareExportOutDir(dir: string, force: boolean): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await fs.mkdir(dir, { recursive: true })
    return
  }

  if (entries.length === 0) return

  const ours = entries.includes(EXPORT_MARKER)
  if (!ours && !force) {
    throw new Error(
      `Refusing to overwrite ${dir}: it is not empty and wasn't created by this exporter.\n` +
        `Choose an empty folder, or pass --force if you're sure.`
    )
  }
  // Clean stale hashed assets from the previous export rather than layering on top.
  await Promise.all(entries.map((e) => fs.rm(join(dir, e), { recursive: true, force: true })))
}

/**
 * Copy each exported board's `assets/` folder into `<out>/assets/<boardId>/`,
 * the layout `staticAssetResolver` expects. Returns how many files were copied.
 */
async function copyExportAssets(projectRoot: string, outDir: string, boardIds: string[]): Promise<number> {
  let copied = 0
  for (const boardId of boardIds) {
    const from = join(projectRoot, 'boards', boardId, ASSETS_DIR)
    let names: string[]
    try {
      names = await fs.readdir(from)
    } catch {
      continue // no assets on this board
    }
    const to = join(outDir, ASSETS_DIR, boardId)
    await fs.mkdir(to, { recursive: true })
    for (const name of names.filter((n) => !n.startsWith('.'))) {
      await fs.cp(join(from, name), join(to, name), { recursive: true })
      copied++
    }
  }
  return copied
}

/** Total bytes and file count under a folder, for the summary line. */
async function measureExportDir(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await measureExportDir(path)
      files += sub.files
      bytes += sub.bytes
    } else {
      files++
      bytes += (await fs.stat(path)).size
    }
  }
  return { files, bytes }
}

export interface AssembleSiteOptions {
  bundle: ExportBundle
  /** The project folder the bundle was built from (for assets + group lookup). */
  projectRoot: string
  /** The prebuilt, data-independent web shell to copy from (`out/web`). */
  shellDir: string
  outDir: string
  theme: Theme
  /** Allow writing into a non-empty folder this tool didn't create. */
  force?: boolean
  /**
   * Already-resolved project group, when the caller needs it for its own
   * purposes too (the CLI logs member names before assembling). Resolved
   * internally when omitted.
   */
  group?: ResolvedProjectGroup | null
}

export interface AssembleSiteResult {
  files: number
  bytes: number
  assetCount: number
  group: ResolvedProjectGroup | null
}

/**
 * Assemble a static site into `outDir`: copy the prebuilt shell, stamp the
 * theme, write the story data as `snapshot.js`, copy referenced assets, and
 * link a sibling project group's dropdown if one applies.
 *
 * Shared by `scripts/export-static.mts` (which builds `shellDir` itself via
 * `npm run build:web`) and the in-app "Export static site" action (which reads
 * a shell already bundled with the packaged app) — the two differ only in
 * where the shell comes from.
 */
export async function assembleStaticSite(options: AssembleSiteOptions): Promise<AssembleSiteResult> {
  const { bundle, projectRoot, shellDir, outDir, theme, force = false } = options

  await prepareExportOutDir(outDir, force)
  await fs.cp(shellDir, outDir, { recursive: true })

  // Stamp the theme into the copied html, not the shell, so the shell stays
  // data-independent and reusable across exports with different themes.
  const indexPath = join(outDir, 'index.html')
  await fs.writeFile(indexPath, applyThemeToHtml(await fs.readFile(indexPath, 'utf8'), theme), 'utf8')

  // A script assignment rather than JSON, so the folder also opens over file://.
  const snapshotJs =
    `/* ZN Story Line ${bundle.appVersion} — generated ${bundle.generatedAt}. Do not edit. */\n` +
    `window.${SNAPSHOT_GLOBAL} = ${JSON.stringify(bundle)};\n`
  await fs.writeFile(join(outDir, 'snapshot.js'), snapshotJs, 'utf8')

  // Images and other files a note references (Issue #61). They are copied rather
  // than inlined so the page stays small and the CSP's `img-src 'self'` is
  // satisfied by a plain relative URL — which is exactly what
  // `staticAssetResolver` produces.
  const assetCount = await copyExportAssets(projectRoot, outDir, bundle.project.boards)

  const group = options.group !== undefined ? options.group : await resolveProjectGroup(projectRoot)
  if (group) {
    // One shared file in the output parent, not a copy per member (issue #86)
    // — every grouped sibling's page links to the same ../group.js, so the
    // dropdown can never drift out of sync between them.
    const groupJsPath = join(dirname(outDir), 'group.js')
    await fs.writeFile(groupJsPath, groupManifestSource(group.manifest), 'utf8')
    await fs.writeFile(indexPath, applyGroupScriptToHtml(await fs.readFile(indexPath, 'utf8')), 'utf8')
  }

  await fs.writeFile(
    join(outDir, EXPORT_MARKER),
    JSON.stringify(
      {
        generatedAt: bundle.generatedAt,
        appVersion: bundle.appVersion,
        project: bundle.project.name,
        boards: bundle.project.boards
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  const { files, bytes } = await measureExportDir(outDir)
  return { files, bytes, assetCount, group }
}
