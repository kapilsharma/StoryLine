# Publishing a board to the web

Export a project as a **self-contained static site** — a folder you upload
anywhere. No server, no database, no Node runtime on the host.

The published site is **read-only**: the UI stays fully interactive (you can
explore, zoom, collapse groups, open every note, even type in the editor), but
anything that would write to a file is refused with a visible notice. Nothing a
visitor does reaches your files, because the files aren't there — the whole
project is baked into one `snapshot.js`.

## Quick start

```bash
npm run export:static -- --project examples/thettana --out dist-site
```

Then open `dist-site/index.html` in a browser to check it, and upload the
**contents** of `dist-site/` to your host.

## Options

| Option | Description |
| --- | --- |
| `--project <path>` | Project folder (the one with `project.json`). Required. |
| `--out <path>` | Output folder for the site. Required. |
| `--boards a,b` | Board ids to publish, in that order. Default: every board. |
| `--skip-build` | Reuse the existing `out/web` shell instead of rebuilding it. |
| `--force` | Allow writing into a non-empty folder this tool didn't create. |

Publish a subset of boards, in a chosen order:

```bash
npm run export:static -- --project ~/novel --out dist-site --boards main,character-arcs
```

Board ids are folder names under `boards/`. A wrong id fails immediately and
lists the valid ones — it won't quietly publish an empty site.

`--out` refuses to overwrite a non-empty folder unless that folder was produced
by a previous export (it leaves a `.zn-story-line-export` marker), so a mistyped
path can't wipe something else. Re-exporting into the same folder is always fine,
and clears stale asset files rather than piling up new ones.

## What gets published

```
dist-site/
  index.html                  # the app shell
  assets/index-<hash>.js      # app + styles in one file
  snapshot.js                 # your story data
  .zn-story-line-export       # marker: what was exported, when (safe to delete)
```

Included: the selected boards, their characters, timeline units, cards, and every
note **with its full body** — plus the character/timeline markdown bodies the
editor shows.

**Not** included: your recent-projects list. It holds absolute paths from your
machine (`/Users/you/…`) and is deliberately never exported. Appearance settings
(theme, card font size, preview colours) *are* baked in, so the site opens
looking the way your app does.

## Two things worth knowing

**The export is a snapshot, not a sync.** Edit in the desktop app, then re-export
to publish the changes. The desktop app stays the single source of truth.

**A plot grid is a complete spoiler map.** For an in-progress series, consider
publishing only some boards (`--boards`), hiding rows/columns with a board preset
before exporting, password-protecting the page in your host or WordPress, or
adding `<meta name="robots" content="noindex">` to the exported `index.html` so
search engines skip it.

## Uploading

### Any static host

Upload the contents of the output folder. Asset paths are **relative**, so the
folder works at the domain root, in a subfolder (`example.com/storyline/`), or on
a subdomain — no configuration and no server rewrites needed.

Works on Netlify, Cloudflare Pages, GitHub Pages, S3, or plain shared hosting
over FTP.

### WordPress

No plugin needed. Two options:

1. **Upload and link.** Put the folder in `wp-content/uploads/storyline/` via FTP
   or your host's file manager, then link to
   `https://yoursite.com/wp-content/uploads/storyline/` from a page or menu.

2. **Embed in a page.** Upload as above, then drop a Custom HTML block into any
   page:

   ```html
   <iframe
     src="/wp-content/uploads/storyline/"
     style="width:100%;height:80vh;border:0"
     title="Story board"
   ></iframe>
   ```

   The board scrolls inside the iframe. Give it plenty of height — a grid needs
   room.

> Some hosts and security plugins block `.js` files under `uploads/`. If the page
> loads but shows "Couldn't load this story board", that's the cause — put the
> folder somewhere else (e.g. a `/storyline/` directory at the web root) instead.

## How it works

Two phases, because a packaged desktop app can't run Vite:

1. `npm run build:web` builds the **shell** — the app with no story data in it.
   Data-independent, so it's built once and reused for every export.
2. `npm run export:static` reads the project, writes `snapshot.js`, and copies the
   shell alongside it.

The renderer is unchanged between desktop and web. The only difference is which
`AppApi` implementation is installed:
[`src/preload/index.ts`](../src/preload/index.ts) talks to Electron over IPC;
[`src/web/staticApi.ts`](../src/web/staticApi.ts) serves the bundle and refuses
writes. The export itself reuses the app's own data layer — including its schema
migrations — so a published board can't disagree with what the app shows.

`snapshot.js` is a script that assigns `window.__ZN_SNAPSHOT__`, not a `.json`
file, because `fetch()` is blocked on `file://` — that's what lets you open the
exported `index.html` locally to check it before uploading.
