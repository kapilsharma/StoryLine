# SL-Docs — the ZN Story Line manual

The user manual for ZN Story Line, written **as a ZN Story Line project**.

Everything the app can do is on one of four boards below. Open it in the app
(**Open project** → choose this folder) and you are reading the documentation in
the thing it documents — which is also the fastest way to learn the interface,
because every feature described here is being used by the board describing it.

Written against **version 1.1.0**.

## The four boards

| Board | Grid | Notes | Read it when |
| --- | --- | --- | --- |
| **Start here** | 13 steps × *do this / why it matters / watch out* | 39 | Your first hour |
| **Feature reference** | 32 features × *what / how / options / watch out* | 128 | You want the detail on one thing |
| **How do I…?** | 23 tasks × 4 steps | 88 | You know what you want, not where it is |
| **Your files on disk** | 11 file kinds × *what's in it / hand-edit? / what breaks it* | 33 | Before you touch the folder yourself |

**Start here** is the walkthrough: install, make a project, add rows and columns,
place cards, write notes, shape the board, keep it safe. Read the first column
straight down for the tour; the third column is where the mistakes live.

**Feature reference** is the encyclopedia — every tab, every button, every
setting, grouped by where it lives in the app. The **Watch out** column is the
one worth reading first when something is behaving oddly.

**How do I…?** is task-shaped rather than feature-shaped: *…make a card cover
several chapters?*, *…take someone off a board without deleting them?*, *…publish
it to the web?* Each row reads left to right as steps.

**Your files on disk** is for the filesystem-first half of the app. It explains
every file a project contains, whether you can safely edit it by hand, and what
happens when it goes wrong.

## Using it

- **Presets** (the dropdown at the top left of each board) narrow a board to one
  column: *① Just the steps*, *② Gotchas only*, *③ Troubleshooting*. Start there
  rather than reading every cell.
- **Expand all (⤢)** in the toolbar shows every card title in full. The boards
  are written to be scanned collapsed and read expanded.
- **Click any card** to read the note behind it — that is where the actual
  explanation is. The card is only the headline.
- **Search** (Notes tab) covers every note body. Switch the scope to *All
  boards*, and use the tag chips — `board`, `notes`, `editor`, `family`,
  `publishing`, `files`, `settings` — as an index.
- **Revision mode (🎓)** masks card titles until you click them. Not the point
  here, but the *Feature reference* board is a fair way to test whether you have
  actually read it.

## Why the manual is a project

Three reasons, in increasing order of usefulness:

1. It proves the app on a non-fiction project — 79 rows, 288 notes, groups,
   spanning cards, presets, screenshots — which is a heavier load than most
   novels put on it.
2. It cannot drift from the interface without someone noticing, because keeping
   it current means opening the app.
3. It publishes. `npm run export:static -- --project examples/sl-docs --out
   dist-docs` turns this folder into the help website, with no second toolchain
   and no second copy of the text.

The project is `kind: general` — its rows are topics, not people — so the Family
tab is hidden here. To see a family tree, open
[`examples/dracula`](../dracula) instead; the Family rows of the reference board
say the same thing.

## Screenshots

The screenshots in `boards/*/assets/` are of this project and of the
[`dracula`](../dracula) example, both of which are MIT-licensed content. Recapture
them by driving the app the way `tests/e2e` does, or simply replace the files —
they are referenced by name from the notes.

## Licence

MIT, like the application's source code. This is documentation of the app rather
than story content, so — unlike [`examples/thettana`](../thettana) — you may copy,
adapt and redistribute it freely.
