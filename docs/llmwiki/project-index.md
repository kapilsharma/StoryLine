# Project index — how edits stay O(changed files) (for AI agents)

Status: **built** on branch `issue-184-project-index` (epic #184, sub-issues #185–#190). Read this before touching `src/main/projectIndex.ts`, `src/main/data/journal.ts`, `src/main/data/watcher.ts`, `src/main/data/ownWrites.ts`, `applyProjectPatch`/`applyReply` in `src/shared/patch.ts`, or the store's `receive`.

## The problem it solved

Board *rendering* was already O(visible) (#150 columns, #157 rows). **Edits** were O(project): every mutating IPC handler wrote its file, then `snap()` → `loadSnapshot()` re-read every file in the project; `note:save`, `note:rename` and `card:create` also listed every note first just to pick a unique id. The renderer then replaced its whole snapshot. Autosave (`note:save` after 900 ms of quiet typing) was on that path. On Google Drive each file read is ~20× slower than local disk.

## Measurements

`npm run bench:index` (#185) drives the real IPC handlers over a project padded to N cards plus 40 chapter notes of ~10k words. It always works on a temp copy (`BENCH_PROJECT`); see the header of `tests/bench/project-index.bench.ts` for options, including `BENCH_PROFILE` (V8 CPU profile of the timed edits). Below: Zoey Nyxx copy, local SSD, medians.

| Cards | | autosave | card move | card create | files read / autosave | reply to renderer | watcher ready |
|---|---|---|---|---|---|---|---|
| 429 | before | 479 ms | 319 ms | 456 ms | 1,110 | 181 KB | 1.4 s |
| | after | **9 ms** | 12 ms | 21 ms | **1** | **0.5 KB** | = open |
| 1,040 | before | 1,360 ms | 734 ms | 1,228 ms | 2,332 | 368 KB | 2.3 s |
| | after | **10 ms** | 15 ms | 26 ms | 1 | 0.4 KB | = open |
| 3,040 | before | 3,301 ms | 1,823 ms | 3,181 ms | 6,332 | 983 KB | 5.8 s |
| | after | **6 ms** | 18 ms | 30 ms | 1 | 0.4 KB | = open |

Card move/create stay slightly size-dependent because `board.json` holds every card and is rewritten and re-read whole — a file-format cost, not an index one. A card-op reply carries the whole board object for the same reason.

Google Drive: a plain read of Zoey Nyxx's 640 files took ~650 ms vs ~27 ms locally; the "before" column multiplies accordingly there.

Bench safety: never open a live project — `BENCH_PROJECT` is copied first. The maintainer's real projects live in a private git repo (`C:\Users\kapil\dev\git\kapilsharma\znsl-projects`), so a throwaway branch there is also fine for experiments; leave the tree as you found it.

## How it works

### 1. The index — `src/main/projectIndex.ts`

Holds the open project's `ProjectSnapshot` (note bodies excluded, as always), built once by `loadSnapshot` on `project:open`. **Invariant: it deep-equals what `loadSnapshot(root)` would read now.** `tests/unit/project-index.test.ts` drives ~40 different handler calls and checks every reply against a fresh `loadSnapshot`; keep that test growing with new handlers.

All index work runs through one promise queue (`serial`), so two handlers flushing at once can't hand the renderer states out of order.

A handler for a root other than the held one rebuilds the index for that root. `project:reload` always rebuilds from disk — it is the backstop.

### 2. Write-through via the journal — `src/main/data/journal.ts`

Handlers were **not** taught to patch the index one by one. Instead the writers report: `writeTextGuarded` (every project file write), and the repository's `removeFile`/`moveFile` (deletes, renames) and `deleteBoard` record touched paths. On the next `indexReply`/`indexSnapshot` the index drains the journal, maps paths to entities with the watcher's `classify`, re-reads just those through `loadChanges` (#131's focused reader) and merges with `applyProjectPatch`. A new handler is covered automatically **as long as it writes through those helpers** — never write a project file with raw `fs` in a handler.

`planReload` decides patch vs rebuild: a board appearing or vanishing (incl. `deleteBoard`, recorded as its `board.json` unlinked) rebuilds.

Ids: `noteKeys` gives note ids/uids from the index; `freeNoteId` in `ipc.ts` also checks the disk, because the index can lag an external add by the watcher's settle time and a new note must never overwrite a file.

### 3. Canonical order — `applyProjectPatch`

For the invariant to hold, a patched list must be ordered exactly as the loader orders it: characters and notes by id (code-unit order, like `Array.prototype.sort()`); timeline units and column groups by `order`, ties by id; views in `board.views` order, then the rest by id. `upsert` inserts new entities in place; views are re-ordered after any view or board op.

### 4. Replies are patches — #188

A mutation's reply is a `SnapshotReply` (`src/shared/ipc.ts`): `{ kind: 'snapshot', version, snapshot }` or `{ kind: 'patch', root, from, version, patch }`. Main numbers every index state (`lastVersion` never resets), logs each version's ops (last 200), and remembers what it last `sent`; a reply is the concatenated ops since then, or the whole snapshot when it can't be (first reply, rebuild, other root, log too short).

The renderer's `receive` (`src/renderer/src/store.tsx`) applies with the pure `applyReply`: a patch only onto the exact version it names, otherwise (a gap) it calls `reloadProject`. It moves `snapshotRef`/`versionRef` synchronously so two replies arriving before a re-render chain correctly. Both sides run the same `applyProjectPatch` on the same base, so they agree.

Why patches: at 3,000 cards the whole snapshot was ~1 MB, ~22 ms to structured-clone on *each* side of the IPC (with `contextIsolation`, the preload can't rebuild it for free), and a fresh identity for every object the board memoises on. Untouched boards now keep their identity.

The static web build (`src/web/staticApi.ts`) always replies with a whole snapshot.

Tests: `tests/replies.ts` → `replyReader()` follows replies like the store does, so handler tests keep asserting on full snapshots; `makeApi` in `tests/components/test-utils.tsx` wraps plain mocked snapshots as whole replies (`wholeReply`).

### 5. The watcher — `src/main/data/watcher.ts` (#190)

Found by profiling the benchmark: chokidar opened one `fs.watch` handle **per file** on Windows (~6 s of main-process CPU to open 3,000 cards, blocking every handler meanwhile) and re-listed folders after changes, saturating libuv's I/O pool. Replaced with one native `fs.watch(root, { recursive: true })`; `chokidar` is no longer a dependency.

Native events only say "this path changed", so each path is reported once quiet for 200 ms (like chokidar's `awaitWriteFinish`), with a `stat` choosing add/change/unlink. A change to a board folder or an entity folder as a whole is reported as that board's `board.json` unlinked, so `planReload` does a full reload.

Own writes (#130, `ownWrites.ts`) are claimed by path **and the mtime our write left**: a quiet period can cover our write and an external edit just after it, and only the mtime tells them apart (`tests/e2e/live-reload.spec.ts` catches the regression).

External edits: watcher → renderer (150 ms debounce) → `project:reloadChanges` → `applyChanges` patches the index and replies like a mutation. A file found **empty** whose entity the index already holds is skipped (Drive/editors truncate before writing, #137) — the next event brings the real content.

## Out of scope (later)

1. **Incremental search index** — `snap` still drops the whole search index on every write; the next search re-reads every body.
2. **Persisted index cache** in userData (not the project folder), keyed by mtime+size, for a faster cold open.
3. **Link index → backlinks**: parse `[[wiki-links]]` and `related:` into the index; "Linked from" in the note panel; graph view later.
4. **Optimistic UI** for card move/resize — far less needed now that a move round-trips in ~15–20 ms.
5. **`board.json` size**: every card lives in it, so card ops are O(cards) in bytes. Splitting cards out is a schema change (see `versioning-and-schema.md`).

Long-form writing note (chapters ≤ ~10k words per note): `LiveMarkdownEditor` keys rendered blocks by source offset, so each keystroke remounts every block below the caret, and the fullscreen `EditorPage` re-renders the whole preview per keystroke. Fine for a chapter; fix before an editor upgrade for long writing.
