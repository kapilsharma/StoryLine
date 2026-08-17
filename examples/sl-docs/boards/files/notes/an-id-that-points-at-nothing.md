---
uid: n_de576ec2
title: An id that points at nothing
boards:
  - files
tags:
  - files
  - board
created: '2026-08-17'
---
Every id here refers to a file: `rowId` to `characters/<id>.md`, `colStart`/`colEnd` to `timeline/<id>.md`, `noteUid` to the `uid` in a note's frontmatter.

A card whose note is gone renders as *(missing note)*. A card on a row or column that no longer exists simply does not appear. Invalid JSON stops the board loading altogether.
