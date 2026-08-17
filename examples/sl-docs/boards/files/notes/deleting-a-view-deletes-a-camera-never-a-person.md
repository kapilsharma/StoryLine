---
uid: n_dfc1d03b
title: 'Deleting a view deletes a camera, never a person'
boards:
  - files
tags:
  - files
  - family
created: '2026-08-17'
---
A view is a filter plus a layout. Removing the file removes the tree tab and nothing else — the characters, their relations and every other tree are untouched.

A view id listed in `board.json`'s `views` array with no file behind it is simply skipped.
