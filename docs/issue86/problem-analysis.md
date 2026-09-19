# Problem analysis

## What the issue actually asks for

Stripped of the sketch, issue #86 has one concrete goal:

> When several separately-published static ZN Story Line sites are hosted
> together, a visitor on one should be able to jump to the others via a
> dropdown — without the app knowing about a "project group" at edit time.

Everything else in the issue (`projectgroup.json`, `.git` at the group root,
a project-group folder) is the *author's* sketch of how to get there, not the
requirement itself. Worth separating those two, because the sketch has real
problems.

## Problems with the issue's sketch

**1. `projects` as bare folder names forces nesting.**
The example lists `"Project 1 folder"` etc. — names, not paths — which only
resolves if every member project physically lives as a direct child of the
group folder. This was initially flagged as friction (projects today live
wherever the user put them, tracked as absolute paths in the desktop app's
recents list). **Resolved the other way, 2026-08-24:** member projects are
always direct children of the same root folder that holds
`projectgroup.json`, referenced by relative folder name — nesting is
required after all. This turned out to be the simpler design once the export
mechanism was worked out (see [architecture.md](./architecture.md)): it's
what lets sibling static sites end up in a predictable relative position to
each other on the output side too, with no extra path bookkeeping in the
schema.

**2. `.git` at the group root implies member projects share one repo.**
The issue's tree sketch shows `.git` next to `projectgroup.json` and the
project folders, i.e. the whole group is one git working copy. That's
incompatible with resolution #1 (members can live anywhere) and isn't
something the app should assume or manage — whether any of these folders are
under git, and how, is entirely the user's business today (the data layer
only ever *ignores* `.git` in the file watcher; it never creates or expects
one). The group folder doesn't need git involvement at all beyond being a
plain folder the user can put under version control if they want.

**3. The schema mixes a stray boolean flag with kebab-case keys.**
`"znstoryline-project": true` reads like a discriminant (this file is on-disk
data, so something has to identify its shape when the app or a script opens
an unknown folder), but as written it's the wrong shape for that job and its
name collides conceptually with a *project* (`project.json`), which this file
explicitly is not — grouping several projects. `output-folder` also breaks
from `project.json`'s established camelCase (`schemaVersion`, `timelineLabel`).
→ Addressed in the proposed schema in [architecture.md](./architecture.md#schema).

**4. No version field.**
Per [versioning-and-schema.md](../llmwiki/versioning-and-schema.md), any new
on-disk format needs a `schemaVersion` from day one, even at 1 — there's no
migration path to add one later without breaking early adopters silently.

**5. "Output folder... git project in itself" conflates two different things.**
The issue says the output folder should be its own git project for hosting
(e.g. GitHub Pages). That's a fine *deployment* choice, but it shouldn't be
baked into the group's on-disk format at all. **Resolved:** `projectgroup.json`
has no `outputFolder` field — where output lands stays exactly what it is
today, the existing `--out` flag on `export:static`, run once per project as
always. What the user does with that folder afterwards (git init, push, FTP)
is exactly as out of scope as it already is for a single ungrouped export.

**6. Ambiguous re-export granularity.**
The issue doesn't say what happens when only one member project changes, and
a naive "regenerate the whole group together" answer would mean introducing
a new command that rebuilds every member's site whenever any one of them
changes. **Resolved by not needing that at all:** `export:static` stays a
single-project command; when the project being exported has a
`projectgroup.json` in its parent folder, the export additionally *reads*
(never rebuilds) each sibling's `project.json` for its display name and
rewrites one small shared `group.js` manifest in the output parent folder.
Exporting project A alone still refreshes the shared dropdown data for
whichever siblings are currently listed, without touching B's or C's actual
site output. See [architecture.md](./architecture.md#discovery-per-export-run).

## Open questions still worth a decision before implementation

Everything below the fold in [architecture.md](./architecture.md) now has a
concrete design (folder-name-based linking, one shared `group.js`, discovery
via the project's parent folder). Two smaller things are still worth the
maintainer's eyes before code is written:

- **Landing page.** With N members each self-contained under
  `output-parent/<folder>/`, is there a top-level `output-parent/index.html`
  (a redirect or a picker), or does the user always link visitors straight to
  one member's URL and rely on the in-page dropdown from there? Proposed:
  no top-level index in v1 — same "you link directly to a board" model
  publishing already has — revisit if this turns out to matter.
- **`--out` basename not matching the source project's folder name.** The
  convention that makes relative sibling links work is that a grouped
  project's `--out` ends in the same folder name as its source (e.g.
  `.../thettana/` in, `.../thettana/` out). Proposed: warn, don't fail, when
  it doesn't match — it's a convention that keeps links simple, not something
  the tool can fully enforce without taking away legitimate reasons to rename
  the output folder (e.g. the same project published under two different
  group contexts with different sibling sets).
