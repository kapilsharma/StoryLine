---
uid: n_4a11ccec
title: 'related is filename-based, so renaming can break it'
boards:
  - reference
tags:
  - notes
created: '2026-08-17'
---
Cards follow a note's permanent uid, but `related` entries and wiki-links point at filenames. Rename a note and its inbound links need updating.

They fail visibly — broken style, or *(missing)* — rather than quietly.
