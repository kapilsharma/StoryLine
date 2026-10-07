---
id: schema
type: character
name: schemaVersion & migrations
colour: '#C2413B'
group: Project level
tags:
  - files
---
The number in `project.json` that says which on-disk format the project is written in. Currently **4**. Version 4 turned a column's `group` text into real group files (`colgroups/<id>.md`) that columns point at with `parent` — see *Columns can be grouped*. Opening an older project upgrades it automatically and keeps a backup beside it.
