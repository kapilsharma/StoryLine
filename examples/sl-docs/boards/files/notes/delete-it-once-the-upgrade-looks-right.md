---
uid: n_e3d37865
title: Delete it once the upgrade looks right
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
Open the project, check a few boards, then remove the backup folder if you want the space back. Nothing depends on it.

The app skips the copy if a backup for that version already exists, so a second upgrade attempt cannot overwrite your original.
