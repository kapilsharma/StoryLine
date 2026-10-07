# Project overview

**ZN Story Line** is an Electron + React + TypeScript desktop app for visual story planning — a 2D grid of **characters × timeline** (boards), plus family trees. Built with electron-vite (Vite), npm. **Filesystem-first: a project is a folder on disk, no database.**

> History: the app was originally prototyped under the name **"Plottr"** and renamed to ZN Story Line before going public. Any remaining "Plottr" mentions in prose refer to the *separate, external* app that inspired this one — do not "fix" those.

## On-disk data model (schema v4)

`project.json` (holds `schemaVersion`) plus, per board:

```
project.json
boards/<boardId>/
  board.json            # cards, row/col order, presets, zoom
  characters/<id>.md    # one Markdown file per character (frontmatter + body)
  timeline/<id>.md      # one per timeline unit — a column, the only thing a card sits on
  colgroups/<id>.md     # one per column group (a Part, a Novel…); body = that group's note
  notes/<id>.md         # note bodies (Markdown + frontmatter)
  views/<id>.json       # family-tree views (membership, camera, overrides)
```

- **Boards are fully independent** (each owns its characters/timeline/notes) since v0.2.0.
- **Notes carry a stable `uid`** in frontmatter; cards reference `noteUid` (rename-safe, v0.3.0). `related:` links stay filename-based. Note bodies are lazy-loaded — `listNoteMetas` drops the body but sets the derived `Note.hasBody`, which is what puts a 📝 on a board card that holds more than its title (issue #46). Never written to disk.
- **Card status** (issue #108): the list is per project (`project.cardStatuses`: `{ id, icon, label }[]`, array order = dropdown order); the value is per note (`status: <id>` in the note's frontmatter). Absent list = the built-in five (`DEFAULT_CARD_STATUSES`), written only once it differs; `[]` = none. Ids are frozen, so editing an icon/label never touches notes; a note whose id is no longer defined keeps it and just shows no icon. All helpers in `src/shared/cardStatus.ts`. The icon renders leftmost on the card (before 📝); `CardStatusSelect` is the dropdown, shared by `NotePopup` (saves at once, from the *full* note — the popup's prop is a body-less meta) and `NoteSidePanel`. Additive — no schema bump.
- **A character's markdown body is its note** (Characters tab, issue #33). An empty body — or one holding nothing but empty `## Notes` / `## Research` headings, the skeleton files were seeded with before #33 — means "no note yet"; see `src/shared/entityBody.ts`. New characters are created with no body, and a skeleton-only body is dropped the next time the file is written. Timeline units keep the seed template. The board marks the rows whose character has one and previews it read-only on click (issue #41) — `Character.hasNote` is derived when the file is read and never written to disk.
- **Columns form a tree** (issue #104, schema v4). A `TimelineUnit` is the leaf; `ColumnGroup`s (`colgroups/<id>.md`) are the nodes above it, to any depth. Both carry `parent` (a group id; absent = top level) and a **sibling-relative** `order` — the board's column sequence is a depth-first walk, not a sort on one number. All the tree logic is pure and lives in `src/shared/columns.ts` (`buildColumnTree`, `orderedLeaves`, `planMove`, `planDrop`, `collectColumnDescendants`…); `grid-utils.ts` (`buildColumnLayout`), the IPC handlers and the delete dialog all use it. A hand-edited file with a dangling `parent` or a cycle is **repaired to top level**, never hidden. A group has an id, a label and a note, so **renaming it never detaches the note** — that is why it is an entity and not the old `group` string. A group's note is its markdown body, reached through the entity-body API as `kind: 'colgroup'` (so panel, popup and fullscreen editor need no group-specific code), with `ColumnGroup.hasNote` / `TimelineUnit.hasNote` derived on read and never written — which is what puts a 📝 on a board header. Cards still sit only on units; deleting a group deletes everything under it (the UI lists it first). Board view-state `collapsedColGroups` holds group **ids**.
- **Column levels** are `project.timelineLevelLabels` (outermost first; absent = one level named by `timelineLabel`, which mirrors the deepest). A thing at depth `d` is called `levels[d]`, group or leaf alike. The count of levels is only an authoring control — the board draws whatever tree exists, one header row per depth in use, so a one-level project has none.
- **Migrations** live in `src/main/data/migrate.ts` (`migrateIfNeeded` runs on open and backs up to `.zn-story-line-backup-vN/` first). See [versioning-and-schema.md](./versioning-and-schema.md).
- Dates (`birthday`/`died`) are opaque partial-ISO strings (`YYYY[-MM[-DD]]`), never JS `Date` — see `src/shared/dates.ts`.

## Key files

- **Shared contract:** `src/shared/{types,config,ipc,changes,dates,graph,families,selection,columns,project}.ts`.
- **Main process:** `src/main/{index,ipc,appConfig,projectService}.ts` + `src/main/data/{repository,mappers,frontmatter,fsutil,slug,uid,watcher,migrate}.ts`.
- **Renderer:** `src/renderer/src/{App,store,api}.tsx`, `components/*`, `lib/{markdown,mdFormat,mdBlocks,reorder,text}.ts`; family tree under `components/tree/*` with a pure layout engine in `components/tree/layout/*`.
- **Three ways a note is shown, and the two the board offers are a setting.** `boardNoteView` in `AppSettings` (issue #83) decides what a click on a card or row header opens: `popup` — the default, and what the app has always done — is the read-only `NotePopup`/`CharacterNotePopup` modal whose **Edit** goes to the fullscreen `EditorPage` (source textarea beside a preview); `panel` is `components/board/NoteSidePanel.tsx`, a resizable share of the boards page (`notePanelFraction`) that is edited in place. Both are rendered by `BoardsView` off one piece of state (`panel` in `BoardUiContext`), so the grid just says "open this note" and does not care which view wins. Keep both working: neither is deprecated.
- **The live-preview editor** (`LiveMarkdownEditor.tsx`) is the panel's Obsidian-style surface: each block renders through the same `renderMarkdown` as every other preview, and the clicked block is swapped for its source. Block boundaries and the click→caret mapping are pure functions in `lib/mdBlocks.ts` — put logic there, not in the component.
- **Store** = React context. Snapshot shape `{ root, project, boards: BoardData[] }`; mutations return a fresh `ProjectSnapshot`. Live-reload via a chokidar watcher — `classify` in `watcher.ts` must match the per-board paths.

## User-facing docs live in `examples/sl-docs`

The end-user manual is a ZN Story Line project (`examples/sl-docs`, 4 boards, 288
notes) rather than Markdown in `docs/`. Its notes describe real UI strings —
button labels, menu items, confirmation text — so **a change to the interface or
to the on-disk format needs the matching note updated in the same change**, the
same way this wiki does. The boards are `start`, `reference`, `howto` and `files`;
find the affected note under `boards/<board>/notes/` (searching for the button
label is usually quickest) and edit it as an ordinary Markdown file.

`docs/` stays developer-facing: publishing, build/release workflow, and this wiki.

## The on-disk format is documented for outside AIs too

`docs/ai-reading-project-instructions.md` (issue #105) and
`docs/ai-creating-project-instructions.md` (issue #98) teach *any* AI — not one
working in this repo — to read, lightly edit, or generate a project folder. They
describe every file and field in plain terms, with no reference to the source.
**A change to the on-disk format (a new field, a changed default, a new folder)
must update both files in the same change**, or authors' assistants will write
projects the app reads wrong. The minimal example at the end of the creating doc
should still load cleanly through `loadSnapshot`.

## Verify workflow

Run after any change, before handing off:

1. `npm run typecheck` — three projects: `node`, `web` **and `test`**. The test
   project covers `tests/**`, so a fixture that drifts from `Project`/`Board`, or
   a stub that misses a new `AppApi` method, fails here rather than at runtime.
2. `npm test` — Vitest. Unit tests in `tests/unit` (node env); component tests in `tests/components` need `// @vitest-environment jsdom` as the first line.
3. `npm run build`
4. Boot the app for a runtime smoke test: `env -u ELECTRON_RUN_AS_NODE npx electron .` (see [electron-gotchas.md](./electron-gotchas.md) for why the env unset matters).

E2E: `npm run test:e2e` (Playwright) — run `npm run build` first, the specs launch `out/main/index.js`. To exercise data-layer TS headlessly, bundle with esbuild (`--packages=external`, alias `@shared`/`@main`) and run with `env -u ELECTRON_RUN_AS_NODE node` — output the bundle inside the repo so `node_modules` resolves.

## Test coverage

`npm run test:coverage`. Thresholds in `vitest.config.ts` are a **ratchet** set
just under what the suite reaches — adding untested code fails the run rather
than quietly lowering the bar. Raise them when coverage rises; don't lower them
without saying why. The pure layers (`src/shared`, `src/main/data`,
`src/renderer/src/lib`) are held far higher than the UI.

Where to put a test:

- **`tests/unit`** — anything pure, plus the data layer against a real temp
  project (`fs.mkdtemp`). Prefer this: it is the fastest and least brittle layer.
- **`tests/components`** — React behaviour, via `renderWithProviders` and the
  `makeApi` / `makeSnapshot` / `makeBoardData` helpers in
  `tests/components/test-utils.tsx`. Build fixtures with those helpers rather
  than by hand, so a change to `Board`/`Project` is fixed in one place.
- **`tests/e2e`** — only what crosses a boundary jsdom fakes: real geometry, the
  filesystem watcher, custom protocols (`zn-asset://`), Electron dialogs.

Two gotchas worth knowing:

- A component whose effect reads the store's refs (e.g. `EditorPage` calling
  `getNote`) must be mounted **a render after** the project opens. Child effects
  run before the provider's, so mounting in the same commit sees null refs.
- jsdom implements neither `DataTransfer` nor `File.arrayBuffer`; fake the shape
  the handler reads and dispatch with `fireEvent`.
