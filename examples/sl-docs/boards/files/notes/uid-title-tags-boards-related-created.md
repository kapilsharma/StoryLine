---
uid: n_1925e1a4
title: 'uid, title, tags, boards, related, created'
boards:
  - files
tags:
  - files
  - notes
created: '2026-08-17'
---
```markdown
---
uid: n_9f8e7d6c
title: "She reads the journal at last"
status: draft
hover: "Turning point — Mina sees the whole pattern."
tags: [turning-point]
boards: [main]
related:
  - file: the-journal.md
    comment: "where it was sealed"
created: '2026-01-04'
---
Mina types up every account and finds the shape nobody saw.
```

`title` is what the card shows. `status` is the id of one of the project's card statuses (see `cardStatuses` in `project.json`) and puts its icon at the left of the card; leave it out for none. `hover` is the card's hover text — a short reminder shown when the mouse rests on the card on the board; leave it out for none. `related` links to other notes by filename, with an optional comment, and puts a 🔗 on the card.
