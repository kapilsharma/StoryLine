---
uid: n_ec9eb9b5
title: Never raise it by hand
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
The number describes the files; changing it does not convert them. Raising it tells the app "these files are already in the new shape" and skips the migration that would have made that true.

Lowering it re-runs a migration over already-migrated files. Leave the field alone and let the app write it.
