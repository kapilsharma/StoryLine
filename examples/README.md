# Example projects

Sample ZN Story Line projects you can open to explore the app.

## `dracula/`

Bram Stoker's **Dracula** (1897), mapped onto a single board: 28 columns (the 27
chapters plus the closing *Note*, grouped into six parts), 12 characters, 107
cards, a family tree and three saved presets.

Start here if you want to see what a full novel looks like in the app. Because
the book is one most people already know — and because its chapters are dated,
so the timeline needs no interpretation — you can judge the board against the
story instead of learning both at once.

**To open it:** launch ZN Story Line → **Open project** → choose the
`examples/dracula` folder. See [`dracula/README.md`](dracula/README.md) for how
the novel was mapped and what to look at first.

## `thettana/`

A small project from the **Zoey Nyxx** universe — the *Thettana* board (4 characters, 6 timeline scenes, 8 notes). Open it in the app to see how characters, a timeline, cards and notes fit together on a board.

**To open it:** launch ZN Story Line → **Open project** → choose this `examples/thettana` folder. It's an ordinary project folder, so feel free to poke around the `boards/thettana/` Markdown and JSON files too.

> Tip: if you plan to edit it, copy the folder somewhere outside the repo first — otherwise your changes will show up as modifications to the repository.

## Trying the Family tab

There is no example project for the **Family** tab, because a meaningful one is
somebody's actual family. Add a few characters to any project, fill in `father`,
`mother` and `spouse` on the Characters tab, then open **Family** and create a tree.

If you want a ready-made one to poke at, the test fixture at
[`tests/fixtures/ashvale-family/`](../tests/fixtures/ashvale-family) is an ordinary
project folder — 21 invented people across three generations and three families, with
four saved trees. Copy it somewhere outside the repo first: the test suite reads it,
so edits in place will show up as failures.

## Content license

The examples here are **not** all under the same terms — check which one you are looking at.

### `dracula/` — MIT, like the rest of the repository

*Dracula* was published in 1897 and is in the **public domain** worldwide. The prose in that project — chapter summaries, character sketches and card notes — is original commentary written for this example rather than extracted from Stoker's text, and is released under the repository's MIT license. Copy and adapt it freely.

### `thettana/` — all rights reserved

**The story content in this example project is not covered by the repository's MIT license.**

The creative content under `examples/thettana/` — character names, plot, notes and the *Zoey Nyxx* / *Thettana* setting — is **© Kapil Sharma (pen name Zoey Nyxx), all rights reserved**. It is included **for demonstration purposes only**. You may read it and use these files to try out the app, but you may **not** copy, adapt, redistribute or build upon the story content.

The MIT license in the repository root applies to the **application's source code**, not to this example content.
