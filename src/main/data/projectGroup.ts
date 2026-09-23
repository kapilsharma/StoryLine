import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import {
  GROUP_GLOBAL,
  PROJECT_GROUP_SCHEMA_VERSION,
  type GroupManifest,
  type ProjectGroupFile
} from '@shared/projectGroup'

/**
 * Discovers, validates and resolves `projectgroup.json` for a static export.
 * Pure Node: no Electron, so it runs from `scripts/export-static.mts` same as
 * `exportBundle.ts`. See docs/issue86/architecture.md.
 */

export const PROJECT_GROUP_FILE = 'projectgroup.json'

/** Thrown for anything wrong with a `projectgroup.json` — a hand-written file, so this is the safety net. */
export class ProjectGroupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectGroupError'
  }
}

/**
 * Thrown specifically when `projectgroup.json` is otherwise valid but doesn't
 * list the project being exported — as opposed to a malformed file or a
 * listed sibling that's missing, which stay plain {@link ProjectGroupError}s.
 * Callers that can ask ("export ungrouped anyway?") catch this one
 * separately; the CLI, which can't, lets it propagate like any other.
 */
export class ProjectNotInGroupError extends ProjectGroupError {
  constructor(
    readonly groupJsonPath: string,
    readonly currentFolder: string,
    readonly listed: string[]
  ) {
    super(
      `${groupJsonPath} doesn't list "${currentFolder}" (the project being exported). ` +
        `Add it to "projects", or export a project this group actually lists: ${listed.join(', ')}`
    )
    this.name = 'ProjectNotInGroupError'
  }
}

export interface ResolvedProjectGroup {
  /** Folder holding `projectgroup.json` and every member project. */
  groupRoot: string
  file: ProjectGroupFile
  manifest: GroupManifest
}

/** Path to `projectRoot`'s group file, if its parent folder has one — null if this project isn't grouped. */
export async function findProjectGroupFile(projectRoot: string): Promise<string | null> {
  const candidate = join(dirname(projectRoot), PROJECT_GROUP_FILE)
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    return null
  }
}

function invalid(path: string, detail: string): never {
  throw new ProjectGroupError(`Invalid ${path}: ${detail}`)
}

/** Parse and structurally validate `projectgroup.json` — doesn't touch sibling project folders yet. */
export async function parseProjectGroupFile(groupJsonPath: string): Promise<ProjectGroupFile> {
  let text: string
  try {
    text = await fs.readFile(groupJsonPath, 'utf8')
  } catch (err) {
    throw new ProjectGroupError(`Couldn't read ${groupJsonPath}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    invalid(groupJsonPath, `not valid JSON (${(err as Error).message})`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    invalid(groupJsonPath, 'expected a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  if (obj.schemaVersion !== PROJECT_GROUP_SCHEMA_VERSION) {
    invalid(
      groupJsonPath,
      `unsupported "schemaVersion" ${JSON.stringify(obj.schemaVersion)} ` +
        `(this build understands ${PROJECT_GROUP_SCHEMA_VERSION})`
    )
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    invalid(groupJsonPath, '"name" must be a non-empty string')
  }
  if (
    !Array.isArray(obj.projects) ||
    obj.projects.length === 0 ||
    !obj.projects.every((p): p is string => typeof p === 'string' && p.trim().length > 0)
  ) {
    invalid(groupJsonPath, '"projects" must be a non-empty array of non-empty folder names')
  }
  const projects = obj.projects as string[]
  const duplicates = [...new Set(projects.filter((p, i) => projects.indexOf(p) !== i))]
  if (duplicates.length > 0) {
    invalid(groupJsonPath, `"projects" lists duplicate folder(s): ${duplicates.join(', ')}`)
  }

  return { schemaVersion: obj.schemaVersion as number, name: obj.name as string, projects }
}

/** Read `<groupRoot>/<folder>/project.json`'s display name, failing loudly if it's missing or malformed. */
async function readMemberName(groupRoot: string, folder: string): Promise<string> {
  const projectJsonPath = join(groupRoot, folder, 'project.json')

  let text: string
  try {
    text = await fs.readFile(projectJsonPath, 'utf8')
  } catch {
    throw new ProjectGroupError(
      `projectgroup.json lists "${folder}" but ${projectJsonPath} doesn't exist — ` +
        `check the folder name, and that it's a ZN Story Line project.`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ProjectGroupError(`${projectJsonPath} is not valid JSON (${(err as Error).message})`)
  }

  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ProjectGroupError(`${projectJsonPath} has no "name" field`)
  }
  return name
}

/**
 * Resolve the project group `projectRoot` belongs to, if any: discover,
 * validate, and build the shared dropdown manifest.
 *
 * Returns `null` when the project's parent folder has no `projectgroup.json`
 * — the common case, meaning "export exactly as today." Throws
 * {@link ProjectGroupError} for anything wrong with a group file that *is*
 * found, naming the specific problem — a bad group export should never ship
 * a broken or dangling dropdown silently.
 */
export async function resolveProjectGroup(projectRoot: string): Promise<ResolvedProjectGroup | null> {
  const groupJsonPath = await findProjectGroupFile(projectRoot)
  if (!groupJsonPath) return null

  const groupRoot = dirname(groupJsonPath)
  const file = await parseProjectGroupFile(groupJsonPath)

  const currentFolder = basename(projectRoot)
  if (!file.projects.includes(currentFolder)) {
    throw new ProjectNotInGroupError(groupJsonPath, currentFolder, file.projects)
  }

  const members = await Promise.all(
    file.projects.map(async (folder) => ({ folder, name: await readMemberName(groupRoot, folder) }))
  )

  return { groupRoot, file, manifest: { name: file.name, members } }
}

/** Source text for the shared `group.js`, mirroring `snapshot.js`'s own `window.<global> = {…}` pattern. */
export function groupManifestSource(manifest: GroupManifest): string {
  return (
    `/* ZN Story Line — project group. Do not edit; regenerated on every grouped export. */\n` +
    `window.${GROUP_GLOBAL} = ${JSON.stringify(manifest)};\n`
  )
}

/**
 * Add the `group.js` include to an exported `index.html`. Idempotent, same
 * spirit as `applyThemeToHtml` — safe even though `index.html` is always
 * freshly copied from the shell before this runs.
 */
export function applyGroupScriptToHtml(html: string): string {
  if (/<script[^>]*src="\.\.\/group\.js"/i.test(html)) return html
  return html.replace('</head>', `    <script src="../group.js"></script>\n  </head>`)
}
