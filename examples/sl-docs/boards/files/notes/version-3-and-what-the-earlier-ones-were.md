---
uid: n_853e2c90
title: 'Version 3, and what the earlier ones were'
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
The on-disk format is versioned separately from the app. **v1** kept characters, timeline and notes in project-wide folders. **v2** moved them inside each board, making boards fully independent. **v3** stamped a stable `uid` into every note so cards survive file renames.

A project written before the stamp existed is treated as v1.
