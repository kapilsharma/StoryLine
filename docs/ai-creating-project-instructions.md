# Creating a ZN Story Line project — instructions for AI

> **Who this is for:** any AI assistant asked to *generate* a new project for
> **ZN Story Line**, a desktop app for plotting stories (or any topic × timeline
> plan) on a board. Follow this file and the folder you write will open in the
> app with no further steps. A project is only JSON and Markdown files — no
> database, no app needed to make one.
>
> **Companion file:** [`ai-reading-project-instructions.md`](./ai-reading-project-instructions.md)
> explains every field in detail, how to read an existing project, and how to
> make small edits safely. Read it too if you can. This file is self-contained
> for creating one.

Example request this file is meant for:

```text
Read ai-creating-project-instructions.md, then create a ZN Story Line project
in ./my-thriller for a three-act heist novel with five main characters.
```

## 1. What you are building

A project has one or more **boards**. Each board is a grid:

- **Columns** — the timeline (chapters, scenes…), optionally grouped into
  parts/acts/books, nested to any depth. **Cards sit only on the deepest
  columns** ("timeline units").
- **Rows** — characters (story) or topics/phases (non-fiction).
- **Cards** — one beat: *what this row does in this column*. A card can span
  consecutive columns. Each card has a **note** (Markdown) holding its detail.

Plan first: decide the column hierarchy, the rows, and the beats (row ×
column), then write the files.

## 2. Folder layout to produce

```
<project>/
  project.json
  boards/
    <boardId>/
      board.json
      characters/<characterId>.md   ← one per row
      timeline/<unitId>.md          ← one per leaf column
      colgroups/<groupId>.md        ← one per column group (omit folder if none)
      notes/<noteId>.md             ← one per card
```

**Ids** are lowercase-kebab slugs (`a-z`, `0-9`, `-`) made from the name/title:
`"Part One: The Job"` → `part-one-the-job`. On a clash within the same folder,
add `-2`, `-3`… **The filename stem must equal the id.**

## 3. `project.json`

```json
{
  "schemaVersion": 4,
  "name": "The Glass Vault",
  "timelineLabel": "Chapter",
  "timelineLevelLabels": ["Act", "Chapter"],
  "boards": ["main"],
  "created": "2026-10-07",
  "lastOpened": "2026-10-07",
  "families": {}
}
```

- `schemaVersion` — **must be `4`**.
- `timelineLevelLabels` — names of the column levels, outermost first. Its
  **last entry must equal `timelineLabel`**. For a flat board (no groups), omit
  `timelineLevelLabels` and just set `timelineLabel`.
- `boards` — every board id, in tab order.
- `created` / `lastOpened` — today's date, `YYYY-MM-DD`.
- Optional:
  - `"rowLabel": "Topic"` — when rows aren't characters (default `"Character"`).
  - `"kind": "general"` — for non-fiction / study / project plans: hides the
    family-tree features. Omit for a story.
  - `"cardStatuses"` — omit to get the built-in set (`idea` 💡, `doc` ⚡,
    `draft` 🌓, `stuck` 🚩, `done` ✅). Or supply your own list:
    `[{ "id": "todo", "icon": "⬜", "label": "To do" }, …]`.

## 4. `boards/<boardId>/board.json`

Write **all** of these keys:

```json
{
  "id": "main",
  "name": "The Glass Vault",
  "cards": [
    {
      "id": "card-3f9a1c02",
      "noteUid": "n_7b2e94d1",
      "rowId": "nadia-voss",
      "colStart": "ch01-the-offer",
      "colEnd": "ch01-the-offer"
    }
  ],
  "hiddenRows": [],
  "hiddenCols": [],
  "presets": [],
  "members": ["nadia-voss", "eli-marsh"],
  "rowOrder": ["nadia-voss", "eli-marsh"],
  "rowGroupOrder": ["The Crew", "The Law"],
  "colOrder": [],
  "collapsedRowGroups": [],
  "collapsedColGroups": [],
  "zoom": 1,
  "views": []
}
```

- `id` — same as the folder name.
- `members` — **every character id that should appear as a row.** A character
  file not listed here exists but is not on the grid. An empty list = an empty
  board.
- `rowOrder` — the same ids, top to bottom.
- `rowGroupOrder` — order of row blocks: each character `group` label used, plus
  the id of any character that has no `group`. May be `[]`.
- `cards` — see §7. Leave the other keys exactly as shown.

## 5. Columns

### Leaf columns — `timeline/<unitId>.md`

```markdown
---
id: ch01-the-offer
label: 1 — The Offer
order: 1
summary: 'Monday night · Lisbon'
parent: act-one-the-setup
---

Synopsis of the chapter, its purpose in the story, open questions.
```

- `label` — shown as the column title. `summary` — optional subtitle.
- `parent` — the column group it belongs to. **Omit for a top-level column.**
- `order` — 1, 2, 3… **among siblings** (items sharing the same `parent`),
  restarting at 1 under each parent. Don't number globally.
- Body — the column's note. May be empty.
- A leaf can sit at any depth (e.g. a prologue at top level beside acts).

### Column groups — `colgroups/<groupId>.md`

```markdown
---
id: act-one-the-setup
type: colgroup
label: 'Act One: The Setup'
order: 1
---

What this act has to achieve.
```

- `type: colgroup` is required. Same `parent` / `order` rules as leaves — set
  `parent` to nest a group inside another group.
- A group must contain at least one column somewhere beneath it, or it doesn't
  show.
- Use as many levels as `timelineLevelLabels` names: with
  `["Book","Part","Chapter"]`, books are top-level groups, parts are groups whose
  `parent` is a book, and chapters are leaf units whose `parent` is a part.

## 6. Rows — `characters/<characterId>.md`

```markdown
---
id: nadia-voss
type: character
name: Nadia Voss
colour: '#3B6FD4'
role: Safecracker
group: The Crew
---

Who she is, what she wants, what she hides, how she changes.
```

- Required: `id`, `type: character`, `name`, `colour` (hex, **quoted**).
- Give each row a distinct colour. A palette that reads well:
  `#E24B4A #3B6FD4 #1F9D8F #D98E04 #8E5BD9 #C2413B #2E9E4F #D4589A #5A7184 #B07A3B`.
- Optional: `role`, `group` (rows sharing a group are drawn together),
  `age` (number), `species`, `tags` (list).
- `rowKind: plot` turns a row into a high-level **planning thread** (e.g. a
  transformation arc, the stakes) instead of a person. Plot rows always sort
  above the character rows and stay off the family tree — give them only
  `id`/`type`/`name`/`colour` (and maybe `group`/`tags`), no family fields. Omit
  the key for an ordinary character.
- Family (story projects only; all optional): `family` (surname), `gender`
  (`male` / `female` / `other` / `unknown`), `birthday` / `died` (quoted partial
  dates: `'1984'`, `'1984-06'`, `'1984-06-12'`), `maidenName`, `father`,
  `mother` (character ids), `spouse` (list of character ids — **write it on both
  spouses**).
- Body — the character note. Leave empty if you have nothing to say; don't
  write empty `## Notes` headings.
- For a `general` project the row is a topic: use the same file format with
  `type: character`, a `name` and a `colour`; skip the family fields.

## 7. Cards and notes

Each card is **two things**: an entry in `board.json` → `cards`, and a note file.

### Note — `notes/<noteId>.md`

```markdown
---
uid: n_7b2e94d1
title: Turns down the job, then takes the envelope
status: idea
boards:
  - main
created: '2026-10-07'
---

The beat in detail: what happens, why it matters, what changes.
```

- `noteId` (filename) — slug of the title; add `-2`, `-3` on a clash.
- `uid` — `n_` + **8 random lowercase hex digits**, unique on the board. Never
  reuse one.
- `title` — the card text: one short line, ideally under 60 characters.
- `status` — optional; an id from the project's card statuses (built-in: `idea`,
  `doc`, `draft`, `stuck`, `done`). For a freshly plotted story, `idea` is apt.
- `boards` — `[<boardId>]`. `created` — today, quoted.
- Optional: `tags` (list), `related` (list of `{ file: other-note.md, comment: … }`),
  `hover` (plain text, a sentence or two — shown as a tooltip when the mouse rests
  on the card; good for a one-line reminder of what the scene is for).
- Body — the detail. `[[other-note-id]]` links to another note on the same board.
- **Only use the keys above** — the app drops unknown note keys when it saves.

### Card — entry in `board.json` → `cards`

```json
{ "id": "card-3f9a1c02", "noteUid": "n_7b2e94d1", "rowId": "nadia-voss",
  "colStart": "ch01-the-offer", "colEnd": "ch01-the-offer" }
```

- `id` — `card-` + 8 random lowercase hex digits, unique on the board.
- `noteUid` — the note's `uid`.
- `rowId` — a character id in `members`.
- `colStart`, `colEnd` — **timeline unit ids** (never group ids). Same id for a
  one-column card; for a span, `colEnd` must come after `colStart` in reading
  order.

Typically one card per row per column where that character matters; leave gaps
where they are absent — gaps are meaningful.

## 8. YAML and JSON rules

- Frontmatter goes between two `---` lines at the very top, then a blank line,
  then the body.
- **Quote** any YAML value that starts with `#` (colours), looks like a date or
  number (`'2026-10-07'`, `'1984'`), or contains `: ` (`'Act One: The Setup'`).
  Single quotes are fine; double a `'` inside: `'Nadia''s plan'`.
- Lists in YAML: one `  - item` per line.
- JSON: valid, 2-space indent, newline at end of file. No comments.
- UTF-8. Emoji are fine.

## 9. Multiple boards

Use a second board for a separate storyline, a prequel, or a different book.
Each board is **fully independent**: its own `characters/`, `timeline/`,
`colgroups/`, `notes/`. A character on two boards needs a file on each. Add
every board id to `project.json` → `boards`.

## 10. Final checklist

Before you finish, verify:

- [ ] `project.json` has `schemaVersion: 4`, and `boards` lists every folder under `boards/`.
- [ ] Each board folder has `board.json` with `id` equal to the folder name and every key from §4.
- [ ] Every filename stem equals the `id` in its frontmatter.
- [ ] Every `parent` names an existing `colgroups/` file on the same board.
- [ ] Sibling `order`s are 1, 2, 3… under each parent.
- [ ] `timelineLevelLabels` has one entry per nesting depth, and its last entry equals `timelineLabel`.
- [ ] Every row character is in `members` and `rowOrder`.
- [ ] Every card: `noteUid` matches exactly one note `uid`; `rowId` is in `members`; `colStart`/`colEnd` are timeline unit ids.
- [ ] Every note has a card (unless deliberately loose), and all `uid`s and card ids are unique.
- [ ] Colours and dates are quoted in YAML.

Then tell the author: in ZN Story Line choose **Open project** and pick the
project folder.

## 11. Minimal complete example

A one-act, two-chapter, two-character project in `./demo`:

`demo/project.json`

```json
{
  "schemaVersion": 4,
  "name": "Demo",
  "timelineLabel": "Chapter",
  "timelineLevelLabels": ["Act", "Chapter"],
  "boards": ["main"],
  "created": "2026-10-07",
  "lastOpened": "2026-10-07",
  "families": {}
}
```

`demo/boards/main/board.json`

```json
{
  "id": "main",
  "name": "Demo",
  "cards": [
    { "id": "card-a1b2c3d4", "noteUid": "n_0a1b2c3d", "rowId": "ana", "colStart": "ch1", "colEnd": "ch1" },
    { "id": "card-e5f60718", "noteUid": "n_4e5f6a7b", "rowId": "ben", "colStart": "ch1", "colEnd": "ch2" }
  ],
  "hiddenRows": [],
  "hiddenCols": [],
  "presets": [],
  "members": ["ana", "ben"],
  "rowOrder": ["ana", "ben"],
  "rowGroupOrder": [],
  "colOrder": [],
  "collapsedRowGroups": [],
  "collapsedColGroups": [],
  "zoom": 1,
  "views": []
}
```

`demo/boards/main/colgroups/act-one.md`

```markdown
---
id: act-one
type: colgroup
label: Act One
order: 1
---
```

`demo/boards/main/timeline/ch1.md` (and `ch2.md` alike, with `order: 2`)

```markdown
---
id: ch1
label: Chapter 1
order: 1
parent: act-one
---

Ana finds the letter.
```

`demo/boards/main/characters/ana.md` (and `ben.md` alike)

```markdown
---
id: ana
type: character
name: Ana
colour: '#E24B4A'
---
```

`demo/boards/main/notes/finds-the-letter.md` (and `follows-her.md` with uid `n_4e5f6a7b`)

```markdown
---
uid: n_0a1b2c3d
title: Finds the letter
status: idea
boards:
  - main
created: '2026-10-07'
---

Hidden in her late mother's piano.
```
