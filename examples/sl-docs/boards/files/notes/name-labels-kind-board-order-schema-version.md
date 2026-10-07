---
uid: n_ab5e35be
title: 'Name, labels, kind, board order, schema version'
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
```json
{
  "schemaVersion": 4,
  "name": "My Novel",
  "timelineLabel": "Chapter",
  "timelineLevelLabels": ["Part", "Chapter"],
  "rowLabel": "Character",
  "kind": "story",
  "boards": ["main", "subplot"],
  "created": "2026-01-04",
  "lastOpened": "2026-08-17",
  "families": { "Harker": "#3B6FD4" }
}
```

`timelineLevelLabels` names the column levels, outermost first; it is only written when there is more than one, and `timelineLabel` then repeats the last (deepest) one. `boards` is the tab order. `families` holds the colour assigned to each surname on the family trees, so a family's colour stays stable as people are added.
