---
uid: n_811f069a
title: A slug and its frontmatter id disagreeing
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
For characters and timeline units the filename stem and the `id` field must be the same string. Renaming the file without the field (or the reverse) produces a row that exists in the folder but matches no card.

The app generates slugs from names and de-duplicates them, so two characters called "Anna" get distinct files.
