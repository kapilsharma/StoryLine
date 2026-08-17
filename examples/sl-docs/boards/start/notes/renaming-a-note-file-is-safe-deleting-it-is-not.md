---
uid: n_50a4a4b7
title: Renaming a note file is safe; deleting it is not
boards:
  - start
tags:
  - notes
  - editor
created: '2026-08-17'
---
Notes carry a stable id in their frontmatter, so renaming a file — in the app or in any external editor — never breaks the card pointing at it.

Deleting the file does break it: the card is left showing *(missing note)*.
