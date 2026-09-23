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
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { spawn } from 'child_process'
import type { Theme } from '@shared/config'
import { assembleStaticSite, buildExportBundle, UnknownBoardError } from '../src/main/data/exportBundle'
import { resolveProjectGroup } from '../src/main/data/projectGroup'
import { readLocalSettings } from './appSettingsPath'

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const projectRoot = isAbsolute(args.project) ? args.project : resolve(args.project)
  const outDir = isAbsolute(args.out) ? args.out : resolve(args.out)

  if (outDir === projectRoot) throw new Error('--out must not be the project folder itself')

  const pkg = JSON.parse(await fs.readFile(resolve('package.json'), 'utf8')) as { version: string }

  // Resolve a project group before spending time on a build — a bad
  // projectgroup.json (issue #86) should fail exactly as fast as a bad
  // --project/--boards. Absent parent folder file: this project just isn't
  // grouped, and nothing below behaves any differently than it does today.
  const group = await resolveProjectGroup(projectRoot)
  if (group) {
    console.log(
      `Project group    ${group.manifest.name} — ${group.manifest.members.length} member(s): ` +
        `${group.manifest.members.map((m) => m.folder).join(', ')}`
    )
    if (basename(outDir) !== basename(projectRoot)) {
      console.warn(
        `  warning: --out folder "${basename(outDir)}" doesn't match the project folder name ` +
          `"${basename(projectRoot)}" — sibling dropdown links assume every member's output ` +
          `lands under one shared parent, using the same folder name as its source project.`
      )
    }
  }

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

  const result = await assembleStaticSite({
    bundle,
    projectRoot,
    shellDir: SHELL_DIR,
    outDir,
    theme: args.theme,
    force: args.force,
    group
  })

  if (result.assetCount > 0) console.log(`  copied ${result.assetCount} asset(s)`)
  if (result.group) console.log(`  wrote group.js   ${join(dirname(outDir), 'group.js')}`)

  console.log(`\nExported to      ${outDir}`)
  console.log(`  ${result.files} files, ${(result.bytes / 1024).toFixed(0)} KB`)
  console.log(`\nUpload the contents of ${basename(outDir)}/ to your web host.`)
  console.log(`Or open ${join(outDir, 'index.html')} in a browser to check it first.`)
}

main().catch((error: unknown) => {
  if (error instanceof UnknownBoardError) console.error(`\n${error.message}`)
  else console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
