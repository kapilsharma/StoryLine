# Proposed architecture

Scope, settled 2026-08-24: **static-export-time only.** The desktop app, its
project/board model, and `project.json` are entirely untouched. The only new
behavior lives in `scripts/export-static.mts` (the existing single-project
exporter — no new CLI command) and in the read-only web renderer that a
published site runs.

## Layout this assumes

```text
group-root/
  projectgroup.json
  thettana/            # a normal ZN Story Line project (has its own project.json)
  dracula/
  togaf-saga/
```

Member projects are always **direct children of the same root folder** that
holds `projectgroup.json`, referenced by relative folder name. No arbitrary
paths elsewhere on disk, no assumption about git. This replaces the earlier
"arbitrary paths anywhere" proposal — simpler, and it matches how this
maintainer's own test projects already sit side by side today (this repo's
gitignored `static/` output was built from exactly this shape).

## Schema

```json
{
  "schemaVersion": 1,
  "name": "My Story Universe",
  "projects": ["thettana", "dracula", "togaf-saga"]
}
```

- `schemaVersion` — starts at 1, same posture as `project.json`.
- `name` — the group's display name, shown as the dropdown's heading.
- `projects` — every member's folder name (relative, direct children of
  `group-root/`), **including whichever one is currently being exported.**
  The file describes the whole group from a neutral, group-level point of
  view rather than "my siblings" from one member's perspective, so there's no
  special-casing of "am I in my own list or not."

No `outputFolder` field — where each member's static output lands is decided
per export run by the existing `--out` flag, same as today. See below for how
that still lets sibling sites link to each other.

## Discovery, per export run

`export:static --project <path> --out <path>` is **unchanged as an
interface.** It gains one extra step:

1. Build the bundle for `--project` exactly as today.
2. Check `dirname(--project)` (the project's parent folder) for
   `projectgroup.json`.
   - **Not present** → export proceeds exactly as it does right now. No new
     files, no markup change, nothing. This is the existing behavior for
     every project that isn't part of a group, and for every project in the
     codebase's own `examples/` today.
   - **Present** → read it, and for every folder name in `projects` (the
     current project included) read `<group-root>/<folder>/project.json` for
     its display `name`. This is a handful of small JSON reads, not a build —
     cheap even though it touches sibling projects the export wasn't asked to
     build.
3. If found, treat `dirname(--out)` as the **shared output parent** — the
   convention is that every grouped project's `--out` is
   `<some-output-parent>/<same-folder-name-as-the-source-project>`, so
   siblings' sites end up next to each other on the output side too, the same
   shape as the input side. (A cheap sanity check: warn, don't fail, if
   `basename(--out)` doesn't match `basename(--project)` — it's a convention,
   not something enforceable without breaking flexibility over `--out`.)

## `projectgroup.json` is hand-written — validate it, don't manage it

Decided 2026-08-24: `projectgroup.json` is authored and edited **by hand**,
the same way `project.json` already can be — no in-app screen to create or
edit a group, and no code path in the main ZN Story Line app touches this
file at all. That keeps the app's surface area exactly as small as the
CLI-only scope already implies.

The tradeoff is hand-editing invites typos (a renamed folder not updated in
the list, a copy-pasted entry, a missing comma), so the export step is the
only safety net and needs to actually catch them rather than silently
producing a broken or empty dropdown. When `projectgroup.json` is found,
before writing anything, validate:

- **Valid JSON**, and an object (not an array/string/etc).
- **`schemaVersion`** is present and is a version this build understands
  (`1` today) — an unrecognized version fails rather than being guessed at,
  same posture `migrate.ts` takes for `project.json`.
- **`name`** is a non-empty string.
- **`projects`** is a non-empty array of non-empty strings, with no
  duplicate entries.
- **Every listed folder exists** as a direct child of the group root, and
  **contains a `project.json`** that itself parses — i.e. is actually a ZN
  Story Line project, not just any folder.
- **The project currently being exported is itself in the list.** If
  `--project` sits next to a `projectgroup.json` that doesn't mention it,
  that's exactly the "renamed/added a project, forgot to update the group
  file" mistake this validation exists to catch — treat it as an error, not
  a silent skip.

Any failure **aborts the export** with a specific, actionable message (which
file, which field, what was found instead) — e.g. `projectgroup.json lists
"toga-saga" but no such folder exists next to <group-root>; found: dracula,
thettana, togaf-saga`. This matches the "don't publish a silently-broken
result" posture `UnknownBoardError` already takes for a bad `--boards` id:
better to force a fix than to ship a dropdown with a dangling or missing
entry that goes unnoticed. A project that isn't part of any group is
completely unaffected — none of this runs unless `projectgroup.json` was
found in the first place.

## The dropdown data: one shared file, not N copies

Rather than baking a full copy of the sibling list into every member's own
`snapshot.js` (my first draft's proposal), write **one** shared file into the
output parent:

```text
output-parent/
  group.js            # window.__ZN_GROUP__ = { name, members: [...] }
  thettana/
    index.html         # references ../group.js when part of a group
    snapshot.js
    ...
  dracula/
    index.html         # same ../group.js
    ...
```

`group.js` is written (overwritten) on **every** grouped export run, computed
fresh from each sibling's current `project.json` `name` — so it's always
current for whichever member was just re-exported, and it is *literally the
same file*, referenced by relative path from every member, so there's no
risk of one site's dropdown drifting out of sync with another's copy. This is
the "so that it is same in all the projects" property directly, rather than
by convention.

Shape, deliberately mirroring `snapshot.js`'s own pattern:

```js
/* ZN Story Line — project group. Do not edit. */
window.__ZN_GROUP__ = {
  name: "My Story Universe",
  members: [
    { name: "Thettana — Example", folder: "thettana" },
    { name: "Dracula", folder: "dracula" },
    { name: "Togaf Saga", folder: "togaf-saga" }
  ]
}
```

A `window.<global> = {...}` assignment rather than JSON, for the same reason
`snapshot.js` is: it must also load over `file://`, where `fetch()`/XHR are
blocked by CORS but a `<script src>` is not. Each grouped member's `index.html`
gets one extra line — `<script src="../group.js"></script>` — added by the
same kind of post-processing `applyThemeToHtml` already does to the copied
shell, and only when `projectgroup.json` was found. An ungrouped export's
`index.html` is byte-for-byte what it is today.

Sibling links inside `group.js` are just `folder` names; the renderer builds
each link as `../<folder>/index.html` relative to its own page — the explicit
filename, not a bare `../<folder>/`, because a bare folder only resolves to
its index page if the host (or a local directory listing) has a
default-document rule, and plenty don't. It resolves correctly precisely
because every member's output sits beside the others under the same output
parent.

## Renderer change

One small new UI element, same family as the existing "published read-only"
banner: on mount, check `window.__ZN_GROUP__`. If absent, or it has only one
member, render nothing — an ungrouped or single-member export looks exactly
as it does today. If present with more than one member, render a dropdown
using `name` as the heading and each `members[].name` as a link to
`../<folder>/index.html`. This only exists in the static/web build path
(`src/web/staticApi.ts`'s side of the app) — the desktop app never sets
`window.__ZN_GROUP__`, so nothing changes there.

## Why not fold this into `ExportBundle` instead

`ExportBundle`/`snapshot.js` is versioned (`EXPORT_FORMAT_VERSION`) and
represents one project's own data. The group dropdown is a different concern
— it's about the *output folder's* shape, known only at export time and
shared identically across sibling sites — so keeping it in its own
`group.js`/`window.__ZN_GROUP__` avoids coupling an unrelated concept to the
export bundle's versioning, and avoids duplicating the same list into every
sibling's own bundle.

## Edge cases

- **A listed sibling folder doesn't exist, lacks `project.json`, or the
  current project isn't itself listed.** Covered by validation above — the
  export aborts with a specific message rather than shipping a dropdown with
  a dangling or missing entry.
- **Only one entry in `projects`.** `group.js` still gets written (harmless),
  but the renderer treats "1 member" the same as "no group" and shows
  nothing.
- **Re-exporting a lone member later without its siblings around.** Works
  fine — the export only reads sibling `project.json` files, it never builds
  or touches their output. `group.js` is simply refreshed with whatever
  `projects` currently lists.
- **`--skip-build`.** Unaffected — this only touches the bundle/HTML
  post-processing step, not the shell build.

## Testing shape (for the implementation pass, not now)

- `tests/unit` — `projectgroup.json` discovery (present/absent parent) and
  every validation rule (bad JSON, unrecognized `schemaVersion`, empty/
  duplicate `projects`, a listed folder missing or without `project.json`,
  the current project absent from its own group's list), plus `group.js`
  content generation, against real temp folders in the style of the existing
  `export-bundle.test.ts`.
- `tests/components` — the dropdown renders for >1 member, renders nothing
  for 0/1 members or a missing `window.__ZN_GROUP__`.
- A quick manual check worth doing once implemented: export two sibling
  fixture projects into a shared output parent and open both `index.html`
  files straight from disk (`file://`) to confirm the dropdown still works
  without a server — the whole point of the `window.__ZN_GROUP__` approach.

## What this does *not* change

- `project.json`, the desktop app's data model, recents, and board UI.
- `export:static`'s CLI interface (`--project`, `--out`, `--boards`,
  `--theme`, `--skip-build`, `--force` all mean exactly what they mean today).
- A project that isn't part of a group: output is identical to what
  `export:static` produces right now, byte for byte.
