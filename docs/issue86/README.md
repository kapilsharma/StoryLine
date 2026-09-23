# Issue #86 — Project groups

Planning workspace for [issue #86](https://github.com/kapilsharma/StoryLine/issues/86)
("Story Project group"). These docs record the design as it was settled and
first implemented — some of the framing below (points 1 and 4 in particular)
has since been superseded by issue #101, noted where it applies.

> **Update (issue #101):** points 1 and 4 below said the desktop app would
> never read `projectgroup.json` beyond the single-project export path. That
> changed: the in-app "Export static site" button (issue #48) now offers
> "export every project in the group" when one is found, looping the same
> `buildExportBundle`/`assembleStaticSite` pipeline over every member listed
> in `projects` — see `ipcMain.handle('static:export', …)` in
> [../../src/main/ipc.ts](../../src/main/ipc.ts). `projectgroup.json` is still
> hand-written and still only *read* (never created or edited) by the app;
> what changed is how many projects one export run can build from it.

- [problem-analysis.md](./problem-analysis.md) — what the issue asks for, what's
  underspecified or risky in its sketch, and the decisions made so far.
- [architecture.md](./architecture.md) — the proposed on-disk schema, CLI shape,
  export pipeline changes, and renderer changes.

## Where this stands

The design settled on, as of 2026-08-24:

1. **Static-export-time only, no new CLI command.** The desktop app,
   `project.json`, and the recents/board UI are entirely untouched. The
   existing single-project `export:static --project <path> --out <path>`
   gains one extra step, and the published site gains one small UI element
   (the dropdown) — that's the entire surface of the change.
2. **Member projects are always direct children of one root folder** that
   holds `projectgroup.json`, referenced by relative folder name — not
   arbitrary paths, not required to share a git repo.
3. **Discovery is implicit.** Exporting a project checks *its own parent
   folder* for `projectgroup.json`. Absent → export exactly as today, no
   changes at all. Present → read every sibling's `project.json` for its
   display name and (re)write one shared `group.js` manifest in the output
   parent folder, which every grouped member's page links to — one file,
   not a duplicated copy per site, so the dropdown is always identical
   across siblings.
4. **`projectgroup.json` is hand-written, not app-managed.** No in-app screen
   creates or edits it, and the main app never reads it — the only code that
   touches it is the export step, and its whole job there is to validate it
   (bad JSON, wrong `schemaVersion`, a listed folder that doesn't exist or
   isn't a project, the current project missing from its own group) and
   abort with a specific error rather than let a typo ship a broken
   dropdown.

See [architecture.md](./architecture.md) for the full design and
[problem-analysis.md](./problem-analysis.md) for the two smaller points
(landing page, `--out` naming convention) still worth a look before coding.

## Source material

- Issue #86 body (see `gh issue view 86`).
- [docs/publishing.md](../publishing.md) — the existing single-project static
  export this feature extends.
- [docs/llmwiki/project-overview.md](../llmwiki/project-overview.md) — data
  model and file layout conventions a new on-disk format should follow.
