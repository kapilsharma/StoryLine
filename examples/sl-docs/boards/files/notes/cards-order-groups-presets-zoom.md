---
uid: n_63c3b9c5
title: 'Cards, order, groups, presets, zoom'
boards:
  - files
tags:
  - files
  - board
created: '2026-08-17'
---
```json
{
  "id": "main",
  "name": "Main Board",
  "cards": [
    { "id": "card-1a2b3c4d", "noteUid": "n_9f8e7d6c",
      "rowId": "mina", "colStart": "ch-4", "colEnd": "ch-6" }
  ],
  "members": ["mina", "jonathan"],
  "rowOrder": ["mina", "jonathan"],
  "rowGroupOrder": ["The Harkers", "renfield"],
  "colOrder": ["ch-1", "ch-2"],
  "hiddenRows": [], "hiddenCols": [],
  "presets": [{ "name": "Act 1", "hiddenRows": [], "hiddenCols": ["ch-9"] }],
  "collapsedRowGroups": [], "collapsedColGroups": [],
  "zoom": 1, "views": []
}
```

`members` is the board's cast — who is a row. `rowGroupOrder` sequences group labels and ungrouped row ids together; `rowOrder` sequences rows inside a group. A card spanning one column has `colStart` equal to `colEnd`.
