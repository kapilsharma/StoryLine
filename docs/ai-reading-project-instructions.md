# Reading a ZN Story Line project — instructions for AI

> **Who this is for:** any AI assistant (Claude, ChatGPT, Gemini, a local model…)
> that has been given access to a folder created by **ZN Story Line**, a desktop
> app for plotting stories on a board. Load this file into your context, then
> read the project folder. You need no other documentation: everything the app
> stores is plain JSON and Markdown, described below.
>
> **Companion file:** to *create* a new project from scratch, see
> [`ai-creating-project-instructions.md`](./ai-creating-project-instructions.md).

## How an author uses this

A typical setup: the author plots the novel in ZN Story Line, and keeps research,
worldbuilding and drafts in a separate notes vault (Obsidian or similar). When
they work with you, they point you at both. Treat them like this:

- **The ZN Story Line project is the plot** — who does what, in which chapter or
  scene, in what order, and how far along each scene is.
- **The vault is everything else** — lore, research, prose drafts. When the two
  disagree about *structure or order of events*, the board is the author's
  current intent; ask before "fixing" either one.

Suggested line for the vault's AI instructions file (`CLAUDE.md`, `AGENTS.md`,
a custom prompt…):

```text
The plot of this novel lives in the ZN Story Line project at <path>.
Read <path-to>/ai-reading-project-instructions.md to learn its format,
then read the project before answering questions about the plot.
```

---

## 1. The mental model in 30 seconds

A project is a set of **boards**. Each board is a grid:

- **Columns** are the timeline — chapters, scenes, parts. They can be nested
  (Novel → Part → Chapter → Scene), but **cards only sit on the deepest columns**.
- **Rows** are characters (or, in a non-fiction project, topics/phases).
- **Cards** sit at a row × column cell and may span several consecutive columns.
  A card is *"what this character does in this chapter"*.
- Every card points at a **note**: a Markdown file whose title is the card text
  and whose body is the scene's detail.
- Characters, columns and column groups each also carry their **own note** as
  the Markdown body of their file.

Read a board **column by column** to get the story in order; read it **row by
row** to get each character's arc.

## 2. Folder layout

```
<project>/
  project.json                     ← project settings, list of boards
  boards/
    <boardId>/
      board.json                   ← the grid: cards, rows, presets, view state
      characters/<characterId>.md  ← one per row (frontmatter + note body)
      timeline/<unitId>.md         ← one per column that cards sit on (leaf)
      colgroups/<groupId>.md       ← one per column group: Part, Act, Novel…
      notes/<noteId>.md            ← card content (frontmatter + body)
      views/<viewId>.json          ← family-tree layouts (rarely plot-relevant)
      assets/                      ← images referenced from Markdown
  .zn-story-line-backup-v*/        ← automatic backups — ignore, never edit
```

- The **filename stem is the id**: `characters/mina-harker.md` has id
  `mina-harker`. Ids are lowercase-kebab slugs.
- Every board is **fully independent**: it has its own characters, columns and
  notes. The same person on two boards is two separate files.
- Any folder may be missing (e.g. no `colgroups/` on a flat board) — treat a
  missing folder as empty.
- Markdown files are **YAML frontmatter between `---` lines, then a Markdown
  body**.

## 3. `project.json`

```json
{
  "schemaVersion": 4,
  "name": "Dracula — Bram Stoker (1897)",
  "timelineLabel": "Chapter",
  "timelineLevelLabels": ["Part", "Chapter"],
  "rowLabel": "Character",
  "kind": "story",
  "boards": ["dracula"],
  "created": "2026-08-16",
  "lastOpened": "2026-09-21",
  "families": { "Harker": "#3B6FD4" },
  "cardStatuses": [{ "id": "idea", "icon": "💡", "label": "High-level idea done" }]
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Format version. **This document describes version 4.** If it is lower, ask the author to open the project in the app once — it upgrades the files automatically (with a backup). |
| `name` | Project title. |
| `timelineLevelLabels` | What each column depth is called, outermost first: `["Novel","Part","Chapter","Scene"]`. A column at depth `d` is a `timelineLevelLabels[d]`. Absent = one flat level named `timelineLabel`. |
| `timelineLabel` | Name of the deepest column level ("Chapter", "Scene"). Mirrors the last level label. |
| `rowLabel` | What a row is. Absent = `"Character"`. |
| `kind` | `"story"` (default when absent) or `"general"` — rows are topics, not people; family fields don't apply. |
| `boards` | Board ids in display (tab) order. A board folder on disk that is missing here still exists — it comes after the listed ones. |
| `families` | Family name → colour for the family tree. Not plot. |
| `cardStatuses` | The status list for cards (see §8). **Absent = the five built-in statuses.** `[]` = statuses turned off. |

## 4. `board.json`

```json
{
  "id": "dracula",
  "name": "Dracula",
  "cards": [
    {
      "id": "card-8daafb04",
      "noteUid": "n_2874d8de",
      "rowId": "jonathan-harker",
      "colStart": "ch01-the-borgo-pass",
      "colEnd": "ch01-the-borgo-pass"
    }
  ],
  "members": ["jonathan-harker", "mina-harker"],
  "rowOrder": ["jonathan-harker", "mina-harker"],
  "rowGroupOrder": ["The Hunters", "Whitby"],
  "hiddenRows": [],
  "hiddenCols": [],
  "presets": [{ "name": "Castle only", "hiddenRows": [], "hiddenCols": [] }],
  "colOrder": [],
  "collapsedRowGroups": [],
  "collapsedColGroups": [],
  "zoom": 1,
  "views": ["the-two-families"]
}
```

| Field | Meaning |
|---|---|
| `cards[]` | Every card on the board. See §6. |
| `members` | Character ids that are **rows** on this board. A character file can exist without being a row (e.g. a relative kept only for the family tree). **`null` means every character file is a row** (older boards). |
| `rowOrder` | Row order. Members not listed come after, sorted by name. |
| `rowGroupOrder` | Order of row *blocks*: a group label (see character `group`), or a character id for an ungrouped row. |
| `hiddenRows`, `hiddenCols`, `presets`, `collapsed*`, `zoom`, `rowHeaderWidth` | **View state only.** Hidden or collapsed things are still part of the story — never treat them as deleted. |
| `colOrder` | Legacy, ignore it. Column order comes from the column tree (§5). |
| `views` | Family-tree tab order. |

## 5. Columns: `timeline/` and `colgroups/`

### Timeline unit — a leaf column, the only thing cards sit on

```markdown
---
id: ch01-the-borgo-pass
label: 1 — The Borgo Pass
order: 1
summary: '3–5 May · Bistritz, and a coach that comes at midnight'
parent: part-one-castle-dracula
tags:
  - transylvania
---

Harker travels Munich → Vienna → Klausenburg → Bistritz, noting recipes
and train times like a man on an ordinary business trip.
```

- `label` — column title. `summary` — one-line subtitle (often in-world date/place).
- `parent` — id of the column group it sits under; **absent = top level**.
- `order` — position **among its siblings** (things with the same `parent`), not
  a global position.
- Body — the column's note (chapter synopsis, intent…). A body that is empty or
  holds only empty `## Notes` / `## Research` headings means **no note**.
- Any other frontmatter key is the author's own custom field — keep it.

### Column group — a Part, Act, Novel, or a Chapter that has scenes under it

```markdown
---
id: part-one-castle-dracula
type: colgroup
label: 'Part One: Castle Dracula'
parent: book-one
order: 1
---

Optional note about this part.
```

Same `parent` / `order` rules. Groups can nest to any depth. A group never holds
cards — it holds children and a note.

### Reconstructing the column sequence

Columns form a **tree**. To get the left-to-right order of the board:

1. Take the top-level items: every group and unit with no `parent`.
2. Sort siblings by `order`; on a tie, groups before units, then by `label`, then by `id`.
3. Walk depth-first: emit a unit when you meet it; for a group, recurse into its
   children (items whose `parent` is that group's id).

The resulting **sequence of units** is the board's timeline. A `parent` naming a
group that doesn't exist (or a loop of groups pointing at each other) is treated
by the app as top level.

Depth gives the level name: a top-level item is `timelineLevelLabels[0]`, its
children `[1]`, and so on. A leaf may sit at any depth (a chapter with no scenes
can sit beside a part that has them).

> Columns are usually **narrative order** (the order the reader meets things).
> The `summary` or note often carries in-world dates if the story isn't linear.

## 6. Cards and notes

### Card (in `board.json`)

| Field | Meaning |
|---|---|
| `id` | `card-` + 8 hex. Only identifies the card. |
| `noteUid` | Links to the note whose frontmatter **`uid`** equals this — **not** the filename. |
| `rowId` | Character id (the row). |
| `colStart`, `colEnd` | Timeline **unit** ids. The card covers every unit from `colStart` to `colEnd` in the column sequence (equal = one column). |

Several cards may share one cell.

### Note (`notes/<noteId>.md`)

```markdown
---
uid: n_fbd5ace2
title: Climbs down the castle wall
status: draft
tags:
  - jonathan-harker
boards:
  - dracula
related:
  - file: lucy-dies.md
    comment: mirrors this escape
created: '2026-08-16'
---

Having watched the Count crawl face-down over the stones like a lizard, he
takes the same route in the opposite direction.
```

| Field | Meaning |
|---|---|
| `uid` | Stable identity, `n_` + 8 hex. Cards point here. Never changes. |
| `title` | The text shown on the card — the one-line beat. |
| `status` | Id of a card status (§8). Absent = no status. |
| `tags` | Free tags. |
| `boards` | Board ids the note belongs to. |
| `related` | Links to other notes **by filename** (`x.md`), with an optional comment. |
| `created` | ISO date. |
| Body | The scene in detail: beats, intent, dialogue sketches, research. |

A note with **no card pointing at it** is a loose note on that board — research
or a cut scene. Read it, but don't place it in the timeline.

### Links and images inside Markdown bodies

- `[[note-id]]` or `[[note-id|label]]` — wiki-link to another **note on the same
  board**, by filename stem.
- `![caption](assets/map.png)` — an image in that board's `assets/` folder.
- Otherwise ordinary Markdown (headings, lists, tables, footnotes).

## 7. Characters (rows)

```markdown
---
id: mina-harker
type: character
name: Mina Harker
colour: '#1F9D8F'
role: Assistant schoolmistress
group: The Hunters
age: 24
species: human
tags:
  - narrator
family: Harker
gender: female
birthday: '1870-03'
died: '1950'
maidenName: Murray
father: some-character-id
mother: some-character-id
spouse:
  - jonathan-harker
---

Character note: who she is, her arc, voice, secrets…
```

- Only `id`, `type`, `name`, `colour` are always there; everything else is optional.
- `group` — rows with the same group are drawn together under that label.
- Family fields (`family`, `gender`, `birthday`, `died`, `maidenName`, `father`,
  `mother`, `spouse`) feed the family tree. `father`/`mother`/`spouse` hold
  **character ids on the same board**. Dates are partial ISO strings:
  `"1870"`, `"1870-03"`, `"1870-03-12"`. No `died` = alive.
- Any other frontmatter key is the author's custom field.
- The body is the character's note. Empty, or only empty `## Notes` /
  `## Research` headings = no note.

## 8. Card status — how far along each scene is

`project.json` → `cardStatuses` is an ordered list of `{ id, icon, label }`.
A note's `status:` holds one of those ids. If `cardStatuses` is absent, the
built-in set applies:

| id | icon | label |
|---|---|---|
| `idea` | 💡 | High-level idea done |
| `doc` | ⚡ | Doc created, not started |
| `draft` | 🌓 | Draft started |
| `stuck` | 🚩 | Stuck, or needs a rewrite |
| `done` | ✅ | Draft done |

A `status` id that is not in the list is kept but shows no icon — treat it as
"unknown status", not an error. Use statuses to answer *"what should I work on
next?"* or *"how much is drafted?"*.

## 9. Family-tree views (`views/*.json`)

Saved family-tree layouts: which characters are drawn, camera position, manual
node positions. **Not plot.** Read `name` and `members` if asked about family
trees; otherwise skip.

---

## 10. Recipe: understand the plot

1. Read `project.json`: title, level names, board order, status list.
2. For each board (in order), read `board.json`, then **every** file in
   `characters/`, `timeline/`, `colgroups/` and `notes/`. Index notes by `uid`.
3. Build the column sequence (§5) and the row list: `members` (or all
   characters if `null`), ordered by `rowOrder`, then grouped by `group` in
   `rowGroupOrder`.
4. For each card resolve: note (by `noteUid` → `uid`), character (by `rowId`),
   and the span of units from `colStart` to `colEnd`.
5. Produce the story **in column order**. For each column: its level path
   (e.g. *Part One › Chapter 3*), `label`, `summary`, column note, then each card
   in it, in row order: *character — card title (status)*, plus the note body.
   A spanning card belongs to every column it covers; mention it once, at its
   start, with "through <end column>".
6. Then, per character: their note, and their cards in column order — that's
   their arc. **Gaps** (columns with no card for a character) are often
   deliberate; say so rather than "filling them in".
7. List loose notes (no card) separately.

A compact digest is a good thing to produce first and keep in your context, e.g.

```text
PART ONE: CASTLE DRACULA
  Ch 1 — The Borgo Pass  (3–5 May · Bistritz)
    Jonathan Harker: Travels to the castle [✅]
    Count Dracula: Drives the calèche himself [🌓]
```

When answering questions, cite things by their **label/name/title**, not ids.

## 11. Making small edits safely

You may make small edits when the author asks. The app re-reads files on disk
when they change, so edits show up even while it is open. Still, ask the author
to **not edit the same card in the app at the same time** — or close the app.

**Always:**

- Keep the file format: YAML frontmatter between `---` lines, then the body;
  JSON with 2-space indent and a trailing newline.
- **Quote** YAML strings that start with `#` (colours — otherwise YAML reads
  them as a comment), that look like dates or numbers (`'2026-08-16'`,
  `'1870'`), or that contain `: ` (`'Part One: Castle'`).
- Leave unknown frontmatter keys on characters and timeline units in place.
- Keep ids, filenames and `uid`s as they are. Ids are what everything points at.
- Re-read a file right before you change it; change only what you were asked to.

**Never:**

- Change or duplicate a note's `uid`, or a card's `noteUid`, unless you are
  creating a new card.
- Rename a file. Cards are safe (they use `uid`), but `[[wiki-links]]`,
  `related:`, `rowId`, `parent`, `father`/`mother`/`spouse`, `members`,
  `rowOrder`, and presets all use ids or filenames and will break.
- Add custom frontmatter keys to **notes** or **column groups**: the app drops
  them the next time it saves that file. (Put extra info in the body instead.)
- Touch `.zn-story-line-backup-*` folders, or change `schemaVersion`.
- Put a card on a column group id — only timeline unit ids are valid columns.

### Common edits

| Task | What to change |
|---|---|
| Rewrite a scene / card text | Note's body, and/or `title` (keep it one short line — it is the card). |
| Set a scene's progress | Note's `status:` to an id from §8. Remove the line for "no status". |
| Move a card | In `board.json`, change its `rowId` and/or `colStart`/`colEnd`. `colStart` must not come after `colEnd` in the column sequence; `rowId` must be in `members`. |
| Delete a card | Remove it from `cards[]`. Leave the note file unless asked to delete it too. |
| **Add a card** | (1) Create `notes/<slug-of-title>.md` (if the name is taken, add `-2`, `-3`…) with a **new** `uid` `n_` + 8 random lowercase hex digits, unique on the board, `title`, `boards: [<boardId>]`, `created: '<today>'`. (2) Append `{ "id": "card-<8 random hex>", "noteUid": "<that uid>", "rowId": …, "colStart": …, "colEnd": … }` to `cards[]`. |
| Edit a chapter/scene note | Body of `timeline/<id>.md` or `colgroups/<id>.md`. |
| Rename a chapter | Its `label` (keep the `id` and filename). |
| Add a column | New `timeline/<slug>.md` with `id` (= filename stem), `label`, `order`, optional `parent`. To insert between siblings, renumber the siblings' `order` (1, 2, 3…). |
| Add a character | New `characters/<slug>.md` with `id`, `type: character`, `name`, `colour: '#RRGGBB'`; then add the id to `members` and `rowOrder` in `board.json` (unless `members` is `null`). |

After any edit, re-check: every card's `noteUid` matches exactly one note `uid`;
every `rowId` is a character in `members` (or any character if `members` is
`null`); every `colStart`/`colEnd` is a timeline unit id on the same board.
