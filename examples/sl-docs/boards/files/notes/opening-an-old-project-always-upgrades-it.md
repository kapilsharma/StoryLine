---
uid: n_9ffa29b8
title: Opening an old project always upgrades it
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
Migration runs on open, in order, and each step backs the project up first. There is no way to open an old project read-only, and no downgrade path.

So if a project must stay readable by an older build of the app, copy it before opening it in a newer one.
