# Project overview

**ZN Story Line** is an Electron + React + TypeScript desktop app for visual story planning — a 2D grid of **characters × timeline** (boards), plus family trees. Built with electron-vite (Vite), npm. **Filesystem-first: a project is a folder on disk, no database.**

> History: the app was originally prototyped under the name **"Plottr"** and renamed to ZN Story Line before going public. Any remaining "Plottr" mentions in prose refer to the *separate, external* app that inspired this one — do not "fix" those.

## On-disk data model (schema v3)

`project.json` (holds `schemaVersion`) plus, per board:

```
project.json
boards/<boardId>/
  board.json            # cards, row/col order, presets, zoom
  characters/<id>.md    # one Markdown file per character (frontmatter + body)
  timeline/<id>.md      # one per timeline unit
  notes/<id>.md         # note bodies (Markdown + frontmatter)
  views/<id>.json       # family-tree views (membership, camera, overrides)
```

- **Boards are fully independent** (each owns its characters/timeline/notes) since v0.2.0.
- **Notes carry a stable `uid`** in frontmatter; cards reference `noteUid` (rename-safe, v0.3.0). `related:` links stay filename-based. Note bodies are lazy-loaded.
- **A character's markdown body is its note** (Characters tab, issue #33). An empty body — or one holding nothing but empty `## Notes` / `## Research` headings, the skeleton files were seeded with before #33 — means "no note yet"; see `src/shared/entityBody.ts`. New characters are created with no body, and a skeleton-only body is dropped the next time the file is written. Timeline units keep the seed template.
- **Migrations** live in `src/main/data/migrate.ts` (`migrateIfNeeded` runs on open and backs up to `.zn-story-line-backup-vN/` first). See [versioning-and-schema.md](./versioning-and-schema.md).
- Dates (`birthday`/`died`) are opaque partial-ISO strings (`YYYY[-MM[-DD]]`), never JS `Date` — see `src/shared/dates.ts`.

## Key files

- **Shared contract:** `src/shared/{types,config,ipc,changes,dates,graph,families,selection}.ts`.
- **Main process:** `src/main/{index,ipc,appConfig,projectService}.ts` + `src/main/data/{repository,mappers,frontmatter,fsutil,slug,uid,watcher,migrate}.ts`.
- **Renderer:** `src/renderer/src/{App,store,api}.tsx`, `components/*`, `lib/{markdown,reorder,text}.ts`; family tree under `components/tree/*` with a pure layout engine in `components/tree/layout/*`.
- **Store** = React context. Snapshot shape `{ root, project, boards: BoardData[] }`; mutations return a fresh `ProjectSnapshot`. Live-reload via a chokidar watcher — `classify` in `watcher.ts` must match the per-board paths.

## Verify workflow

Run after any change, before handing off:

1. `npm run typecheck`
2. `npm test` — Vitest. Unit tests in `tests/unit` (node env); component tests in `tests/components` need `// @vitest-environment jsdom` as the first line.
3. `npm run build`
4. Boot the app for a runtime smoke test: `env -u ELECTRON_RUN_AS_NODE npx electron .` (see [electron-gotchas.md](./electron-gotchas.md) for why the env unset matters).

E2E: `npm run test:e2e` (Playwright). To exercise data-layer TS headlessly, bundle with esbuild (`--packages=external`, alias `@shared`/`@main`) and run with `env -u ELECTRON_RUN_AS_NODE node` — output the bundle inside the repo so `node_modules` resolves.
