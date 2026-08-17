---
uid: n_acbb4f80
title: 'Images and PDFs, per board'
boards:
  - files
tags:
  - files
  - editor
created: '2026-08-17'
---
Adding a picture in the editor — toolbar button, paste or drag — copies the file into `boards/<board>/assets/` and inserts a relative link: `![](assets/portrait.png)`.

Inside the app those links are served over an internal `zn-asset://` URL scoped to the open project, so a note cannot reach outside its board's assets folder.
