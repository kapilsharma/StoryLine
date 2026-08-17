---
uid: n_c34be5a8
title: Lenient by design
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
Reads are forgiving: a missing optional field takes its default, a string where a list was expected is coerced, and a malformed `related` entry is dropped rather than thrown.

The app re-emits the block when it writes the file, so quoting and key order may change. The values will not.
