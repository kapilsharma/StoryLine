---
uid: n_0f6bd8c2
title: YAML between two --- lines
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
Every `.md` file in a project starts with a small YAML block, then the Markdown body. The app parses the block into fields and preserves the body verbatim.

Unknown keys on a character are kept as custom fields and shown in the form. Unknown keys elsewhere are ignored, not deleted.
