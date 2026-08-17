---
uid: n_1b2a02de
title: 'Invalid YAML, and tabs in particular'
boards:
  - files
tags:
  - files
created: '2026-08-17'
---
A file whose header will not parse cannot be read as a note or character. YAML forbids tab indentation — use spaces.

Colons and `#` inside an unquoted value are the other common cause. Quote any title containing punctuation.
