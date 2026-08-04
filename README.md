# ZN Story Line

A desktop app for **visual story planning**. The core interface is a structured 2D grid — **characters × timeline** — so you can see, at a glance, what happens to whom and when. It's filesystem-first: a project is just a folder of Markdown and JSON, with no database, so your writing stays portable and editable in any tool.

> Built as a personal tool. Not affiliated with any other story-planning software.

## Features

- **Character × timeline boards** — place cards in a grid of characters (rows) and timeline units (columns); a card can span multiple columns.
- **Multiple independent boards** — each board owns its own characters, timeline and notes. Reorder boards by dragging their tabs.
- **Drag-and-drop everywhere** — reorder boards, timeline units and character rows; group rows/columns and collapse groups.
- **Dedicated Markdown editor** with a live, configurable preview — per-theme colours for headings, emphasis, code, highlights and more (separate light/dark palettes).
- **Rename-safe notes** — notes carry a stable id, so renaming a file (in the app or an external editor) never breaks a card.
- **Live reload** — external edits (e.g. from another Markdown editor) are picked up automatically.
- **Light / dark themes.**

## Tech stack

- **Electron + React + TypeScript**, bundled with [electron-vite](https://electron-vite.org/) (Vite).
- **Filesystem-first storage** — no database. A project is a folder:

  ```
  project/
    project.json                     # project metadata + schema version
    boards/<boardId>/
      board.json                     # card placement, order, presets, zoom
      characters/<id>.md             # one Markdown file per character
      timeline/<id>.md               # one Markdown file per timeline unit
      notes/<id>.md                  # note bodies (Markdown + frontmatter)
  ```

- Frontmatter is round-tripped with `gray-matter`; the on-disk schema is versioned and migrates automatically (with a backup) when you open an older project.

## Getting started

```bash
npm install      # install dependencies
npm run dev      # launch the app in development
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the app in development (hot reload). |
| `npm run build` | Type-check and build for production. |
| `npm run typecheck` | Type-check main + renderer. |
| `npm test` | Run unit + component tests (Vitest). |
| `npm run test:coverage` | Run tests with a coverage report (`coverage/`). |
| `npm run test:e2e` | Run end-to-end tests (Playwright). |

## License

[MIT](./LICENSE) © Kapil Sharma
