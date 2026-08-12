/**
 * Export a project as a self-contained static site.
 *
 *   npm run export:static -- --project examples/thettana --out dist-site
 *   npm run export:static -- --project ~/novel --out dist-site --boards main,arcs
 *
 * Produces an uploadable folder: the prebuilt web shell plus a `snapshot.js`
 * holding the story data. Read-only by construction — see `src/web/staticApi.ts`.
 *
 * Colours/styles are read from this machine's own ZN Story Line settings (see
 * `appSettingsPath.mts`), so the published site matches what you see in the
 * desktop app — override with `--settings <path>` (e.g. in CI).
 *
 * Run via tsx so it can import the app's own data layer (and therefore its
 * schema migrations) rather than reimplementing any of it:
 *   tsx --tsconfig tsconfig.node.json scripts/export-static.mts
 */
import { promises as fs } from 'fs'
import { basename, isAbsolute, join, resolve } from 'path'
import { spawn } from 'child_process'
import { SNAPSHOT_GLOBAL } from '@shared/export'
import type { Theme } from '@shared/config'
import { applyThemeToHtml, buildExportBundle, UnknownBoardError } from '../src/main/data/exportBundle'
import { readLocalSettings } from './appSettingsPath'

/** Written into the output folder so a re-export knows it may clean it. */
const MARKER = '.zn-story-line-export'
const SHELL_DIR = resolve('out/web')

interface Args {
  project: string
  out: string
  boards: string[]
  theme: Theme
  settingsPath?: string
  skipBuild: boolean
  force: boolean
}

const USAGE = `
Export a ZN Story Line project as a static site.

  npm run export:static -- --project <folder> --out <folder> [options]

Options
  --project <path>   Project folder (the one containing project.json). Required.
  --out <path>       Output folder for the site. Required.
  --boards a,b       Board ids to publish, in that order. Default: all boards.
  --theme dark|light Theme the published site opens in. Default: dark.
  --settings <path>  Config JSON to read colours/styles from (same shape as the
                      desktop app's own config file). Default: read this
                      machine's local ZN Story Line settings automatically.
  --skip-build       Reuse the existing out/web shell instead of rebuilding it.
  --force            Allow writing into a non-empty folder this tool didn't create.
  --help             Show this message.
`.trim()

function parseArgs(argv: string[]): Args {
  // Dark by default: a published board is read on a website, where dark reads
  // better than the desktop app's light default.
  const args: Args = { project: '', out: '', boards: [], theme: 'dark', skipBuild: false, force: false }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = (): string => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
      return v
    }
    switch (flag) {
      case '--project':
        args.project = value()
        break
      case '--out':
        args.out = value()
        break
      case '--boards':
        args.boards = value()
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean)
        break
      case '--theme': {
        const theme = value()
        if (theme !== 'dark' && theme !== 'light') {
          throw new Error(`--theme must be "dark" or "light", got "${theme}"`)
        }
        args.theme = theme
        break
      }
      case '--settings':
        args.settingsPath = value()
        break
      case '--skip-build':
        args.skipBuild = true
        break
      case '--force':
        args.force = true
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }

  if (!args.project) throw new Error('--project is required (see --help)')
  if (!args.out) throw new Error('--out is required (see --help)')
  return args
}

/** Build the web shell via the project's own npm script. */
function buildShell(): Promise<void> {
  return new Promise((done, fail) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(npm, ['run', 'build:web'], { stdio: 'inherit', shell: false })
    child.on('error', fail)
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`build:web failed with exit code ${code}`))
    )
  })
}

/**
 * Make `dir` an empty, writable output folder.
 *
 * Refuses to clean a non-empty folder it didn't create, so a mistyped `--out`
 * can't wipe something else. `--force` overrides.
 */
async function prepareOutDir(dir: string, force: boolean): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await fs.mkdir(dir, { recursive: true })
    return
  }

  if (entries.length === 0) return

  const ours = entries.includes(MARKER)
  if (!ours && !force) {
    throw new Error(
      `Refusing to overwrite ${dir}: it is not empty and wasn't created by this exporter.\n` +
        `Choose an empty folder, or pass --force if you're sure.`
    )
  }
  // Clean stale hashed assets from the previous export rather than layering on top.
  await Promise.all(entries.map((e) => fs.rm(join(dir, e), { recursive: true, force: true })))
}

/** Total bytes and file count under a folder, for the summary line. */
async function measure(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await measure(path)
      files += sub.files
      bytes += sub.bytes
    } else {
      files++
      bytes += (await fs.stat(path)).size
    }
  }
  return { files, bytes }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const projectRoot = isAbsolute(args.project) ? args.project : resolve(args.project)
  const outDir = isAbsolute(args.out) ? args.out : resolve(args.out)

  if (outDir === projectRoot) throw new Error('--out must not be the project folder itself')

  const pkg = JSON.parse(await fs.readFile(resolve('package.json'), 'utf8')) as { version: string }

  // Read the project first: a bad path or board id should fail before spending a
  // minute on a Vite build.
  console.log(`Reading project  ${projectRoot}`)
  const localSettings = await readLocalSettings(args.settingsPath)
  const bundle = await buildExportBundle(projectRoot, {
    boards: args.boards,
    settings: { ...localSettings, theme: args.theme },
    appVersion: pkg.version,
    generatedAt: new Date().toISOString()
  })

  const noteCount = bundle.boards.reduce((n, bd) => n + bd.notes.length, 0)
  console.log(
    `  ${bundle.project.name} — ${bundle.boards.length} board(s), ` +
      `${noteCount} note(s): ${bundle.project.boards.join(', ')}`
  )
  console.log(`  theme: ${args.theme}`)

  if (args.skipBuild) {
    await fs.access(join(SHELL_DIR, 'index.html')).catch(() => {
      throw new Error(`--skip-build was passed but no shell found at ${SHELL_DIR}. Run without it once.`)
    })
    console.log(`Reusing shell    ${SHELL_DIR}`)
  } else {
    console.log('Building shell   npm run build:web')
    await buildShell()
  }

  await prepareOutDir(outDir, args.force)
  await fs.cp(SHELL_DIR, outDir, { recursive: true })

  // Stamp the theme into the copied html, not the shell, so the shell stays
  // data-independent and reusable across exports with different themes.
  const indexPath = join(outDir, 'index.html')
  await fs.writeFile(
    indexPath,
    applyThemeToHtml(await fs.readFile(indexPath, 'utf8'), args.theme),
    'utf8'
  )

  // A script assignment rather than JSON, so the folder also opens over file://.
  const snapshot =
    `/* ZN Story Line ${bundle.appVersion} — generated ${bundle.generatedAt}. Do not edit. */\n` +
    `window.${SNAPSHOT_GLOBAL} = ${JSON.stringify(bundle)};\n`
  await fs.writeFile(join(outDir, 'snapshot.js'), snapshot, 'utf8')

  await fs.writeFile(
    join(outDir, MARKER),
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

  const { files, bytes } = await measure(outDir)
  console.log(`\nExported to      ${outDir}`)
  console.log(`  ${files} files, ${(bytes / 1024).toFixed(0)} KB`)
  console.log(`\nUpload the contents of ${basename(outDir)}/ to your web host.`)
  console.log(`Or open ${join(outDir, 'index.html')} in a browser to check it first.`)
}

main().catch((error: unknown) => {
  if (error instanceof UnknownBoardError) console.error(`\n${error.message}`)
  else console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
