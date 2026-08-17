---
uid: n_c897d33b
title: '--boards, --theme, --skip-build, --force'
boards:
  - reference
tags:
  - publishing
created: '2026-08-17'
---
`--boards a,b` publishes a subset in that order. `--theme light` overrides the dark default. `--skip-build` reuses the existing web shell.

`--out` refuses to write into a non-empty folder it did not create, unless you pass `--force`.
