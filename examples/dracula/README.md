# Dracula — Bram Stoker (1897)

A ZN Story Line project built from a novel most people already know, so you can
judge the board against the story rather than having to learn both at once.

**To open it:** launch ZN Story Line → **Open project** → choose this
`examples/dracula` folder.

> If you plan to edit it, copy the folder somewhere outside the repo first —
> otherwise your changes show up as modifications to the repository.

## What is in it

| | |
|---|---|
| Board | `dracula` — one board covering the whole novel |
| Columns | 28 — the 27 chapters plus the closing *Note*, grouped into six parts |
| Rows | 12 characters in four groups |
| Cards | 107 |
| Notes | 107 — one per card |
| Family trees | 1 — *Harkers & Westenras* |
| Presets | 3 saved show/hide configurations |

## How the novel was mapped

**Columns are chapters.** *Dracula* is epistolary, and almost every entry is
dated, so the chapters already form a clean chronological spine — which is the
main reason this novel makes a good demo of the timeline. The `summary` field on
each chapter carries its date range (*"3–5 May · Bistritz, and a coach that comes
at midnight"*), so the calendar is visible without opening anything.

The columns are grouped into six parts (*Castle Dracula*, *The Voyage*, *Lucy*,
*The Un-Dead*, *The Hunt in London*, *The Pursuit East*). Collapse a group to see
the shape of the book in one screen.

**Rows are characters**, grouped as *The Hunters*, *Whitby*, *The Un-Dead* and
*Carfax Asylum*.

**Cards are what that character does in that chapter.** At most one card per
cell, so a row reads as a single thread. A few cards span more than one column
where an event runs across chapters — Dracula's arrival at Whitby spans chapters
7–8, and his siege of the asylum spans 19–21.

### Things worth looking at

- **Harker's gap.** His row is the only one on the board for chapters 1–4, then
  goes nearly silent for the whole Whitby section. The empty stretch is the
  point — that is the reader waiting alongside Mina.
- **Dracula's row is mostly gaps.** He is a much smaller presence than memory
  suggests. After chapter 23 he is a shipping manifest rather than a character.
- **Lucy's row does not stop when she dies** in chapter 12. Chapters 13–16 are
  the Un-Dead Lucy, kept on the same row deliberately.
- **Renfield's row tracks Dracula's** several chapters before anyone in the book
  connects them.
- **Quincey Harker is not on the board.** He appears in one paragraph of the
  closing Note, so he has no thread to draw — but he exists as a character file
  so the Family tab has a second generation. That is the distinction between a
  board's *cast* and its *members*: a character can live in the folder for
  family context without being a row on the grid.

## The Family tab

*Dracula* is thin on family relationships, which makes it a small tree rather
than no tree: Mrs Westenra and Lucy, and Jonathan and Mina with their son. The
**Harkers & Westenras** view shows both.

Lucy's father is never mentioned in the novel and Arthur never marries her, so
neither appears on the tree — an honest reflection of what the book actually
supplies.

## A note on dates

The novel gives days and months but never a year. The dates in this project use
**1893**, the year most commonly reconstructed from the days-of-the-week in the
text; other editors argue for 1887 or 1890. Only the `birthday` and `died` fields
on the character files carry a year at all, and they exist so the family tree has
something to place people by.

## Licence

*Dracula* was published in 1897 and is in the **public domain** worldwide.

The prose in this project — the chapter summaries, character sketches and card
notes — is original commentary written for this example, not extracted from
Stoker's text. It is released under the same MIT licence as the rest of the
repository, so unlike the `thettana` example you are free to copy and adapt it.
