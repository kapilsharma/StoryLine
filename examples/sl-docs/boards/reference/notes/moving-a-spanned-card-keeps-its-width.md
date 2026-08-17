---
uid: n_cfc90f3a
title: Moving a spanned card keeps its width
boards:
  - reference
tags:
  - board
created: '2026-08-17'
---
Drag a three-column card to a new cell and it stays three columns wide, clipped at the end of the board if it would overrun.

A span is stored as `colStart` and `colEnd`, so it survives reordering the columns between them.
