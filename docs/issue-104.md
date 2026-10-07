# Issue 104 — Entity-backed, arbitrary-depth timeline hierarchy with per-tier notes

> **Status:** **implemented** (M1–M3). The plan below is kept as the design record; the
> "As built" section right after this header lists where the implementation differs.
> Original status: implementation plan, ready for a coding agent.
> **Audience:** the agent that will build this (Sonnet). Read the whole file, then
> read every source file it names before touching anything. Follow the repo rules
> in `docs/llmwiki/` (never commit; verify before hand-off).
>
> **One issue, one PR.** The work is split into **internal milestones** (§11) so a
> long build has safe checkpoints, but it lands as a single PR that `Closes #104`.
> It changes the on-disk format (bumps `SCHEMA_VERSION` 3 → 4 with a migration),
> which is **breaking** by the repo's policy → a **major** version bump. See §10.

## As built — deviations from the plan below

- **`ColumnGroup` has no `body` field.** A group's note is its markdown body behind the
  entity-body API (`kind: 'colgroup'`), with a derived `hasNote` — exactly how
  `Character` and `TimelineUnit` already work. `TimelineUnit.hasNote` was added too, for
  the 📝 on a column header (§6.4).
- **`ProjectMeta` carries `timelineLevelLabels: string[]` instead of `timelineLabel`.**
  A single level is still written as plain `timelineLabel` (byte-identical to before);
  several levels also write `timelineLevelLabels`, with `timelineLabel` mirroring the
  deepest.
- **`deleteColumnGroup(id)` has no `cascade` flag.** It always deletes the subtree; the
  renderer always confirms first (a list of everything that goes for a non-empty group).
- **IPC names:** `saveColumnGroup`, `deleteColumnGroup`, `reorderColumns`, `moveColumn`
  (reparent + reorder), `wrapColumnInGroup` (promote-a-leaf, one atomic call).
  `reorderTimeline` was removed.
- **Tree logic is in `src/shared/columns.ts`** (pure): `buildColumnTree`, `orderedLeaves`,
  `collectColumnDescendants`, `planReorder`, `planMove`, `planDrop`, `canMoveUnder`.
  Hand-edited inconsistencies (dangling `parent`, cycles) are repaired to top level.
- **Settings:** the levels editor offers **+ Level above** and **+ Level below**.
- **The note side panel now closes when you open the fullscreen editor** (as the popup
  already did). The board stays mounted under the editor, so a panel left open came back
  showing the pre-edit body, and typing into it autosaved that stale text over the new
  one. This affected every panel kind; found by the e2e spec for this feature.
- **Not done / follow-ups:** group notes are not in full-text search (`SearchKind` is
  still note/character/timeline); the `sl-docs` Timeline-tab screenshot predates the tree.

## 1. What #104 asks, and the decisions behind this plan

The maintainer plots a story on the **Timeline** (board columns). Today a column
is a `TimelineUnit` ("scene"), and columns can be grouped by a free-text `group`
string ("chapter"). A group is **not an entity** — just a shared string — so there
is nowhere to write chapter notes. #104 asks for notes at the grouping level and a
configurable multi-level hierarchy.

**Decisions settled with the maintainer (2026-10-06):**

1. **Entity-backed, not label-keyed.** A grouping tier is a real node with a
   **stable id**, a label, a parent and its own note (its markdown body). Scenes
   point at a parent node. Chosen over the cheap label-keyed approach so that
   renaming a tier **never orphans its notes** — critical at series scale, where
   parts/chapters are renamed and reorganised constantly.
2. **Arbitrary depth, generic, per-project level count.** The column side becomes
   a **tree** of unbounded depth. The number of levels and their names are set per
   project in Settings. Not every story is a multi-novel series: one project is
   just chapters (1 level), another is Part > Chapter, another Novel > Part >
   Chapter > Scene. **An author who needs one level sees one header row — unused
   levels never take space.**
3. **Ragged depth is allowed.** Parts are optional; scenes are optional; a chapter
   can exist with no scenes under it. So a leaf column may sit at any depth (a
   "chapter with no scenes" is simply a leaf at the chapter level), beside a
   sibling branch that goes deeper.
4. **Notes at every level.** Every node carries a note (its body). The leaf
   (scene/column) already has one — the timeline-unit body — so this generalises
   it to all levels and surfaces it on the board.
5. **Deleting a non-empty tier warns, lists what will be lost, then allows it.**
   Never silent. The confirm dialog lists **every descendant** that would be
   deleted — tiers and columns — marking which carry notes (📝), so an accidental
   delete can't quietly destroy an author's work, while a deliberate one isn't
   blocked. After confirmation the delete cascades. Never silently reparent.
6. **Reparent-by-drag is in the first release** (not deferred).
7. **Promoting a leaf column into a tier is in scope** (e.g. "break this chapter
   into scenes") — implemented without card surgery (§6.5).
8. **The board is the primary surface; the other tabs exist to organise it.** An
   author spends their plotting time on the board, so every level's note must be
   openable *there*, straight from its header — exactly as a character's note
   already opens from the fixed row-header column. Heavy setup (building/reordering
   the tree) can live on the Timeline tab, but reading/opening notes is a board
   action at every level, including the leaf column.
9. **Columns only.** The **row** side (characters' `group`) is unchanged and out
   of scope.

### Vocabulary map (after this change)

| #104 word | Code after this change |
|---|---|
| scene / chapter (leaf — whatever the author plots on) | `TimelineUnit` — `boards/<id>/timeline/<id>.md`; `parent` points at its node; holds cards |
| the tiers above the leaf | `ColumnGroup` nodes — `boards/<id>/colgroups/<id>.md`; `parent` chains up; **body = that tier's note** |
| "Column label" setting | per-depth labels in `project.timelineLevelLabels` |

## 2. Guiding principles

- **The tree is the source of truth; the configured level count is a UX control.**
  The board renders whatever tree exists — a header row appears only for a depth
  that actually has nodes. `timelineLevelLabels` only decides how many levels the
  authoring UI offers and what each depth is called.
- **Labels are per depth (top → down), and apply to nodes *and* leaves.** A thing
  at depth `d` is called `timelineLevelLabels[d]`. A leaf column at depth 1 in a
  `["Part","Chapter","Scene"]` project is a "Chapter" with no scenes; a leaf at
  depth 2 is a "Scene". This is what makes ragged depth read correctly.
- **Reuse the stable-id machinery.** `ColumnGroup` mirrors `TimelineUnit`/`Note`:
  a per-board markdown file, frontmatter + body, slug id frozen at creation,
  lenient reads, a derived `hasNote` on read (never written). **Its note is its
  body**, edited through the existing entity-body path (`getEntityBody`/
  `saveEntityBody`) by adding a `'colgroup'` kind — no bespoke note API.
- **Leaves always hold the cards.** Cards sit on `TimelineUnit`s only. A
  `ColumnGroup` never holds a card — it holds children and a note.

## 3. Data model

### 3.1 New entity: `ColumnGroup` (`src/shared/types.ts`)

```ts
/** A node in a board's column hierarchy (Issue #104). One
 *  `boards/<boardId>/colgroups/<id>.md` file; its markdown body is the tier's
 *  note. Leaves (the columns that hold cards) are TimelineUnits that point here
 *  via `parent`. */
export interface ColumnGroup {
  /** Unique slug; filename stem; frozen at creation (like a character/note id). */
  id: string
  type: 'colgroup'
  label: string
  /** Parent node id; absent = top-level. Chains up to form the tree. */
  parent?: string
  /** Order among siblings sharing the same `parent`. */
  order: number
  /** The tier's note (markdown). Lazy — dropped in list/snapshot metas. */
  body: string
  /** True when `body` holds something. Derived on read; never written. */
  hasNote?: boolean
}
```

### 3.2 `TimelineUnit` change (`src/shared/types.ts`)

- **Remove** `group?: string`.
- **Add** `parent?: string` — the id of its containing `ColumnGroup`; absent =
  top-level leaf. A leaf may attach at any depth (ragged trees).
- `order` becomes **sibling-relative** (among the nodes/units sharing the same
  parent), not global. The visible column sequence is a depth-first walk (§5).

### 3.3 Per-depth labels (`src/shared/types.ts`, `src/shared/project.ts`)

Replace the single "Column label" concept with one ordered array:

```ts
/** Level labels, top → deepest, e.g. ["Novel","Part","Chapter","Scene"].
 *  Length = number of configured levels. Absent = one level named by
 *  `timelineLabel` (today's behaviour). A node/leaf at depth d is called
 *  timelineLevelLabels[d]. */
timelineLevelLabels?: string[]
```

- Keep `timelineLabel` for back-compat. `timelineLevelLabels` absent →
  `[timelineLabel]`. On save, keep `timelineLabel` mirrored to the **deepest**
  label (`timelineLevelLabels.at(-1)`) so an older reader still names the Timeline
  tab sensibly.
- Helpers in `project.ts`: `timelineLevelLabels(project): string[]` (defaulted),
  and `levelLabel(project, depth): string` returning the label at `depth` with a
  graceful fallback (deepest label, or "Level N") for a branch deeper than
  configured.
- Extend `ProjectMeta`, `readMeta`, `applyMeta` to carry `timelineLevelLabels`
  (write only when it differs from `[DEFAULT_TIMELINE_LABEL]`, per the existing
  drop-defaults convention).

### 3.4 `Board` view-state (`normalizeBoard`)
- `collapsedColGroups: string[]` keeps its name but now stores **node ids** (was
  label strings). Migration converts them (§4.2). Default stays `[]`.

### 3.5 On-disk layout
```
boards/<boardId>/colgroups/<nodeId>.md      # frontmatter {id,type,label,parent?,order} + body(note)
boards/<boardId>/timeline/<id>.md           # now carries `parent` instead of `group`
```

## 4. Main process / data layer

### 4.1 Mappers (`src/main/data/mappers.ts`)
- Add `frontmatterToColumnGroup(data, id, body)` / `columnGroupToFrontmatter(node)`
  mirroring the Note pair (write `parent` only when set; `order` always;
  `type:'colgroup'`). Set `hasNote` from the body on the list-meta read.
- `TIMELINE_KNOWN_KEYS`: replace `'group'` with `'parent'` (leave `'group'`
  commented as retired-and-ignored, like `'type'`, so a stray legacy key in an
  externally-edited file is dropped rather than kept as `custom`).
- `frontmatterToTimelineUnit`: read `parent` in place of `group`;
  `timelineUnitToFrontmatter`: write `parent` when set.

### 4.2 Migration v3 → v4 (`src/main/data/migrate.ts`)
Add `migrateV3toV4` wired into `migrateIfNeeded` (`if (version < 4) …`), backing
up to `.zn-story-line-backup-v3` once (existing pattern). Per board:
1. Read `timeline/*.md` with their current global `order`.
2. Reproduce today's grouping to preserve order exactly: walk units by `order`;
   build the top-level block sequence (a group-node per distinct non-empty `group`
   by first appearance; a solo leaf per ungrouped unit). This mirrors
   `gatherBlocks` so the migrated tree renders identically.
3. Create `colgroups/<slug>.md` per distinct group label
   (`{id:uniqueSlug(label), type:'colgroup', label, order:blockIndex}`, empty
   body). Keep a `label → nodeId` map.
4. Rewrite each unit: drop `group`; set `parent = nodeId` (omit if it was
   ungrouped); set sibling-relative `order`.
5. Convert the board's `collapsedColGroups` labels → node ids (drop unmatched).
6. Set `project.timelineLevelLabels = ["Group", timelineLabel]` **when the board
   had any grouping** (so the two migrated depths are named; the user renames them
   in Settings), else leave absent. Stamp `schemaVersion = 4`.
7. Idempotent and safe to re-run (guard on already-converted files).

**Migrate committed projects/fixtures in this PR** so a fresh clone opens clean:
`examples/dracula`, `examples/sl-docs`, `tests/fixtures/*` with any `group:` on a
timeline unit. Open each in a dev build to run the migration, delete the generated
`.zn-story-line-backup-v3/`, commit the result, and fix any test asserting on
`group`.

### 4.3 Repository (`src/main/data/repository.ts`)
- `normalizeProject`: backfill `timelineLevelLabels` (string array, else absent),
  mirroring the `rowLabel` pattern.
- New `colgroups/` CRUD mirroring timeline/notes: `listColumnGroupIds`,
  `readColumnGroup` (sets `hasNote`), `listColumnGroups` (sorted by `order`),
  `listColumnGroupMetas` (body dropped, `hasNote` kept — for the snapshot),
  `writeColumnGroup` (preserve body on update, `mkdir -p`), `deleteColumnGroup`,
  `renameColumnGroupFile` (ids frozen; only an explicit rename-file action moves
  it — **label edits never do**, which is the orphan-proof property).
- Entity-body plumbing: extend `BodyKind`
  (`'character' | 'timeline' | 'colgroup'`) and `entityPath` so
  `readEntityBody`/`writeEntityBody` handle colgroup notes with **no new note
  API** (treat like the timeline branch — no character-style skeleton stripping).
- `ensureBoardDirs`: add `colgroups` (harmless, consistent).

### 4.4 IPC contract (`src/shared/ipc.ts` + main `ipc.ts` + preload + renderer `api`/`store`)
- `EntityBodyKind`: add `'colgroup'` → note read/write for panel/popup/editor free.
- `BoardData`: add `colGroups: ColumnGroup[]` (metas — `body` dropped, `hasNote`
  set). Populate where `notes`/`views` are assembled (`src/main/projectService.ts`
  → `loadSnapshot`).
- New node mutators (each returns a fresh `ProjectSnapshot`):
  - `saveColumnGroup(root, boardId, node)` — create/update label, parent, order.
    **A label edit here keeps the id/file/note intact.**
  - `deleteColumnGroup(root, boardId, id)` — delete the node and **all descendant
    nodes and units** (and their cards). The renderer always calls this *after* a
    confirm dialog; when the node is non-empty the dialog lists what will go
    (§6.5). An empty node deletes with a light confirm. (Also add a **pure**
    `collectColumnDescendants(colGroups, timeline, nodeId)` helper in shared/grid
    utils so the dialog can enumerate descendants — tiers and columns, each with
    its `hasNote` — from the snapshot without a round-trip.)
  - `reorderColumnGroups(root, boardId, parentId: string|null, orderedIds)` —
    persist sibling order under one parent (ids may be a mix of nodes and units,
    since both share the order space at a level — or split into node/unit reorders
    if cleaner; keep one visible order per level either way).
  - `reparentColumn(root, boardId, kind: 'node'|'unit', id, newParentId: string|null, order)`
    — move a node or a leaf under a new parent at a position (for drag reparent,
    §6.5). Reject a move that would make a node its own ancestor.

### 4.5 Live reload
- `src/shared/changes.ts`: add `'colgroup'` to `EntityKind`.
- `src/main/data/watcher.ts` `classify`: `boards/<id>/colgroups/<file>.md`
  (`parts.length === 4 && sub === 'colgroups'`) →
  `{ kind:'colgroup', id: basename(file,'.md'), type }`.
- Renderer change handler (`store.tsx`): treat `'colgroup'` like other per-board
  kinds and reload the affected board.

## 5. Layout engine — `src/renderer/src/components/board/grid-utils.ts`

Replace the string-based column grouping with a **tree traversal**. (The **row**
side keeps `gatherBlocks`/`buildRowLayout` unchanged.)

### 5.1 Target shapes
```ts
export type ColSlot =
  | { kind: 'col'; index: number; unit: TimelineUnit; depth: number; path: string[] }   // path = ancestor node ids
  | { kind: 'colGroup'; index: number; node: ColumnGroup; members: TimelineUnit[] }      // a collapsed subtree

export interface ColHeaderCell { node: ColumnGroup; depth: number; startIndex: number; span: number; collapsed: boolean }

export interface ColumnLayout {
  slots: ColSlot[]
  /** Header cells by depth (0 = topmost). headersByDepth.length = tiers present. */
  headersByDepth: ColHeaderCell[][]
  slotOfUnit: Map<string, number>
  /** Number of grouping-tier rows present (0 = flat). */
  depth: number
}
```

### 5.2 Algorithm
1. Children index: for each parent id (and `null` = top), the ordered list of child
   **nodes and units**, sorted by `order` (they interleave in one order space).
2. Drop hidden leaves (`board.hiddenCols`); a node with no visible leaf descendant
   produces no slot and no header.
3. Depth-first from the top in sibling order:
   - **Unit (leaf):** push a `col` slot with its `depth` and ancestor `path`; map
     `slotOfUnit`.
   - **Node collapsed** (`board.collapsedColGroups.includes(node.id)`): push one
     `colGroup` slot covering all visible descendant leaves; map each to it; push a
     header cell at the node's depth, `span:1, collapsed:true`; don't descend.
   - **Node expanded:** recurse, then push a header cell at the node's depth
     spanning all slots emitted for the subtree.
4. `depth` = max header depth + 1 (0 when no nodes).

**Edge cases (each gets a unit test):** flat board == today; ragged depth (a
chapter-leaf at depth 1 beside a Part>Chapter>Scene branch); same label under two
parents stays two nodes (ids differ); collapsing an upper tier collapses its whole
subtree; a node whose leaves are all hidden disappears.

### 5.3 `buildBoardLayout`
A card maps to a **marker** when its slot is a `colGroup` (collapsed subtree) —
generalise the existing `collapsedColSlot` check. Rows/stacking unchanged.

## 6. Renderer UI

### 6.1 `BoardGrid.tsx` — N header rows
- `headerRows = cols.depth + 1`. `gridTemplateRows`: `cols.depth × GROUP_H`, then
  `COLHEAD_H`, then `rowTracks`. `colHeadRow = headerRows`;
  `dataRowBase = headerRows + 1`.
- Render `cols.headersByDepth[d]` on grid row `d+1`, cells by `startIndex`/`span`,
  styled like `.col-group-head` (give upper tiers a progressively stronger style
  so Novel reads above Part above Chapter).
- Header interaction (mirror the row header's swatch-vs-name split): **chevron** →
  `toggleColGroup(node.id)`; **label** → `openPanel({ kind:'colgroup', id:node.id })`;
  **📝** when `node.hasNote`.
- Collapsed-subtree unit-header placeholder (`slot.kind === 'colGroup'`) shows the
  leaf count and expands on click, like today's collapsed-group slot.

### 6.2 `BoardUiContext.tsx`
```ts
export type PanelTarget =
  | { kind: 'note'; id: string }
  | { kind: 'character'; id: string }
  | { kind: 'timeline'; id: string }     // scene/column note (§6.4)
  | { kind: 'colgroup'; id: string }     // tier note
```

### 6.3 Note editing surfaces
Generalise the panel/popup/editor's non-`note` branch from "character only" to
**any `EntityBodyKind`**: `NoteSidePanel.tsx`, `NotePopup`, `EditorPage`/
`openEditor` load with `getEntityBody(kind, id)` and autosave with
`saveEntityBody(kind, id, body)` — the character branch already does exactly this.
Title = the node/unit label from the snapshot; file-path hint `colgroups/<id>.md`.
Key the panel on `kind + id`.

### 6.4 Scene/column note on the board (board-first principle)
The board is where the author plots, so a column's note opens *from the board*,
mirroring how a character's note opens from the fixed row-header column. Add a 📝
on the unit header (`col-head`) when the unit has a body, opening
`{ kind:'timeline', id }` — the exact pattern `RowHeadName` uses for a character's
📝. Combined with the 📝 on every tier header (§6.1), **every level of the
hierarchy is readable straight from the board**, which is the whole point of the
feature.

### 6.5 Timeline tab — node-management UI (`TimelineEditor.tsx`, `TimelineForm.tsx`)
The **largest new UI**. The Timeline tab becomes a **tree**:
- Show the hierarchy (nodes with their columns nested).
- **Add** a node (child of root or of a selected node) and **add** a column (leaf)
  under a node or at top level. The "add" controls and form field names use
  `levelLabel(project, depth)` for the target depth.
- **Rename** a node's label (label-only — id/file/note untouched; the orphan-proof
  property in action).
- **Edit** a node's note (open in panel / fullscreen editor).
- **Delete** a node: always via a confirm dialog — never silent. For a non-empty
  node the dialog **lists every descendant that will be deleted** (from
  `collectColumnDescendants`), tiers and columns, marking those with notes (📝) and
  showing the count, then calls `deleteColumnGroup(id)` on confirmation. An empty
  node gets a light confirm. The warning must make the stakes obvious ("3 columns,
  2 with notes, will be permanently deleted") so hard-won work is never lost by
  accident — while a deliberate delete still goes through in one extra click.
- **Reorder** siblings and **reparent by drag** (first-class, via
  `reorderColumnGroups` / `reparentColumn`), including dragging a column under a
  node or out to the top level. Guard against dropping a node into its own subtree.
- **Promote a leaf column into a tier** ("break this chapter into scenes"):
  implement as **"insert a parent tier"** — create a new `ColumnGroup` and reparent
  the existing column under it (via `saveColumnGroup` + `reparentColumn`). The
  column keeps its id, cards and note (no card repointing), so it simply becomes
  the first child; offer to move the column's note up to the new tier. This reuses
  the mutators already specified — a thin convenience action, not a conversion.
- `TimelineForm`: replace the free-text **Group** input with a **parent picker**
  (`<select>` of eligible parent nodes + "Top level"); add `parent` to
  `FormState`/`toForm`/the saved unit.

### 6.6 `Settings.tsx` — levels editor
Replace the single "Column label" row with a **levels editor** bound to
`timelineLevelLabels`: an ordered list you can **add a level**, **remove a level**,
and **rename** each (top → deepest). "Number of levels" = list length. Keep helper
text (e.g. "Novel › Part › Chapter › Scene — deepest is what you plot on"). Wire
into `ProjectMeta`/`projectDirty`/`saveProjectMeta`. Guard against removing the
last level (minimum 1).

### 6.7 CSS
Styles for the per-depth header rows and the 📝-on-header affordance, mirroring
`.col-group-head` (grep the renderer stylesheet).

## 7. Tests (coverage is a ratchet — see `docs/llmwiki/project-overview.md`)

- **`tests/unit/`**: `migrate` v3→v4 (nodes + `parent`, order preserved, collapse
  ids, labels set, backup, idempotent); `grid-utils` tree layout (all §5.2 cases,
  ragged depth, collapse per depth, markers); `mappers`/`repository`
  (`ColumnGroup` round-trip + `hasNote`, entity-body `'colgroup'`, node CRUD incl.
  cascade delete + reparent cycle-guard); `project` (`timelineLevelLabels`
  round-trip/defaults, `levelLabel` fallback).
- **`tests/components/`**: `TimelineEditor` (add/rename/delete-guard/reorder/
  reparent, parent picker); `Settings` (levels add/remove/rename); `BoardGrid`
  (N header rows for a deep tree, chevron collapse, header label opens colgroup
  panel, 📝 shows); panel editing a colgroup note. **Update
  `tests/components/test-utils.tsx`**: add `colGroups` to `makeBoardData` and stub
  the new API methods + entity-body `'colgroup'` (the `test` tsconfig will fail
  otherwise).
- **`tests/e2e/`** (optional): create a tier, write its note, reload; rename the
  tier and confirm the note survives; drag-reparent a column.

## 8. Docs & examples (same change)
- `docs/llmwiki/project-overview.md`: the `ColumnGroup` entity, `colgroups/`
  folder, the tree model, `timeline.parent`, per-depth labels.
- `docs/llmwiki/versioning-and-schema.md`: add the **v3→v4** migration; record it
  as a genuine breaking change → major bump.
- `examples/sl-docs` manual: update the column-label / grouping notes (grep
  `sl-docs` boards for "Column label" / "group", e.g.
  `settings-column-label-row-label-project-kind.md`,
  `columns-group-the-same-way.md`) to document levels, the hierarchy, and notes.
- Migrate `examples/dracula`, `examples/sl-docs`, `tests/fixtures/*` to v4 (§4.2).

## 9. Verify before hand-off (`docs/llmwiki/project-overview.md` §verify)
1. `npm run typecheck` (node + web + **test**).
2. `npm test` + `npm run test:coverage` (raise thresholds if coverage rises;
   never lower silently).
3. `npm run build`.
4. Boot (`env -u ELECTRON_RUN_AS_NODE npx electron .`): **open an existing v3
   project and confirm the migration preserves the board exactly** and wrote a
   backup. Then build a 2–4 level hierarchy (and a ragged one — a chapter with no
   scenes beside one with scenes), write notes at each level, **rename a tier and
   confirm its note survives**, drag-reparent a column, collapse/expand upper
   tiers, delete a non-empty tier (confirm the guard/cascade), and reload.

## 10. Hand-off (never commit — `docs/llmwiki/git-golden-rules.md`)
This retypes `timeline.group` → `timeline.parent` and bumps the on-disk schema, so
by `docs/llmwiki/versioning-and-schema.md` it is **breaking → major**. Suggested
commit subject:

```
feat(#104)!: entity-backed arbitrary-depth timeline hierarchy with per-level notes
```

Add a `BREAKING CHANGE:` footer describing the v3→v4 migration, `Closes #104` in
the PR body, and bump `SCHEMA_VERSION` to 4. Summarise: new `ColumnGroup` entity +
`colgroups/` folder, `timeline.group` → `timeline.parent`, per-depth labels,
migration + backup, and that renaming a tier no longer orphans its note. (If the
maintainer judges the safe forward-migration non-breaking under the "no external
consumer" clause, it drops to a minor bump — their call per policy.)

## 11. Internal milestones (checkpoints within the one PR)
Build in order so a long effort has safe, reviewable checkpoints:
- **M1 — data + migration + read path.** `ColumnGroup`, mappers, repository CRUD +
  entity-body `'colgroup'`, `BoardData.colGroups`, watcher, `TimelineUnit.parent`,
  `timelineLevelLabels`, the v3→v4 migration, migrated fixtures, and all unit
  tests. Verifiable by tests + opening a migrated project (no UI yet).
- **M2 — board rendering + notes.** Tree layout in `grid-utils`, N-row headers in
  `BoardGrid`, per-level note open (panel/popup/editor), 📝 markers, the Settings
  levels editor.
- **M3 — tree management UX.** Full `TimelineEditor` tree: add/rename/reorder/
  **reparent-by-drag**, the delete-with-descendant-list confirm, **promote-leaf-to-
  tier**, and the `TimelineForm` parent picker.

## 12. Resolved scoping decisions (2026-10-06)
All earlier open questions are settled and folded into the plan above:
- Column (scene/leaf) notes **open from the board**, mirroring the character
  row-header 📝 — the board is the primary surface (§1.8, §6.4).
- **Promote-leaf-to-tier is in scope**, as an "insert a parent" action with no card
  surgery (§6.5, M3).
- **Delete warns + lists every descendant (marking notes) + confirms, then forces**
  the cascade — accidental loss is guarded, deliberate deletion isn't blocked
  (§1.5, §4.4, §6.5).
