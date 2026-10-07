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
  "families": { "Harker": "#3B6FD4" },
  "cardStatuses": [
    { "id": "idea", "icon": "💡", "label": "High-level idea done" },
    { "id": "draft", "icon": "🌓", "label": "Draft started" },
    { "id": "done", "icon": "✅", "label": "Draft done" }
  ]
}
```

`timelineLevelLabels` names the column levels, outermost first; it is only written when there is more than one, and `timelineLabel` then repeats the last (deepest) one. `boards` is the tab order. `families` holds the colour assigned to each surname on the family trees, so a family's colour stays stable as people are added. `cardStatuses` is the status list, in dropdown order; a note's `status:` holds an `id` from it. It is only written once it differs from the built-in five (💡 ⚡ 🌓 🚩 ✅); `[]` means no statuses at all.
