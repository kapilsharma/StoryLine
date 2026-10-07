---
uid: n_baa2fffe
title: 'Label, order, summary, parent'
boards:
  - files
tags:
  - files
  - timeline
created: '2026-08-17'
---
```markdown
---
id: ch-4
label: "Chapter 4"
order: 4
summary: "Jonathan escapes the castle"
parent: part-one
---
The last of the Transylvanian journal.
```

`order` is an integer that places the column among its siblings — the other columns and groups with the same `parent`. `summary` is the tooltip on the column header. `parent` is the id of a group file, `colgroups/part-one.md`:

```markdown
---
id: part-one
type: colgroup
label: "Part One"
order: 1
---
What Part One is for, in your own words.
```

The group's body is its note. Renaming a group changes `label` only, so the id — and every column pointing at it — stays valid. Both kinds of file are plain Markdown and can be edited by hand.
