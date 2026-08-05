# Build & release workflow

Internal notes on how versions, releases and installers are produced.

## Overview

- **Versioning:** [release-please](https://github.com/googleapis/release-please) reads Conventional Commits on `main` and opens a *release PR*. Merging it bumps `package.json` + `CHANGELOG.md`, tags (bare `MAJOR.MINOR.PATCH`, no `v`) and creates a GitHub Release. See `CONTRIBUTING.md`.
- **Installers:** built by a **manual** GitHub Actions workflow (see below) for macOS, Windows and Linux, and uploaded to a chosen Release.
- **Signing:** installers are currently **unsigned** (see "Unsigned installs"). Code signing / notarization is a later issue (Need `$ 100` for every platform, can't afford right now).
- **Auto-update:** not yet implemented (a later issue; will use `electron-updater`).

## Local build

Produces installers for the **current OS** into `release/` (gitignored):

```bash
npm run build:app          # electron-vite build && electron-builder
```

Target installer should be build on given machine. Like macOS `.dmg` (arm64 + x64) builds on a Mac. Same for Windows/Linux. All targets are best produced by the CI workflow (We can't build a macOS `.dmg` off a Mac, and cross-building is fragile).

Icons live in `build/` (`icon.icns`, `icon.ico`, `icon.png`), generated from `ZNLogo.png`. Packaging config is `electron-builder.yml`.

## Manual installer workflow (build only when ready for new version release)

Because Actions is free on public repos but we don't need a build on every patch, installers are built **on demand**, not automatically. When we want binaries for a release:

1. Cut the release first (merge the release-please PR → tag + GitHub Release exist).
2. Actions → **build-installers** → *Run workflow* → enter the tag (e.g. `0.1.1`).
3. Each OS runner builds its installer and uploads it to that Release.

Defined in `.github/workflows/build-installers.yml`:

```yaml
name: build-installers

on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Release tag to build & attach installers to (e.g. 0.1.1)'
        required: true

permissions:
  contents: write # upload assets to the Release

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag }} # build the exact released code
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      # electron-builder builds the current runner's OS target by default and
      # uploads to the GitHub Release matching package.json's version.
      - run: npm run build:app -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- Do **not** set `ELECTRON_SKIP_BINARY_DOWNLOAD` here — packaging needs the real Electron runtime (the CI *test* workflow skips it because it only typechecks/tests/builds).
- `--publish always` uses the `publish:` block in `electron-builder.yml` and `GH_TOKEN` to attach `.dmg` / `.exe` / `.AppImage` (plus `latest*.yml` update metadata) to the Release for that version.
- The tag's `package.json` version must match the Release (release-please guarantees this).

## Unsigned installs (what users see)

Until signing is set up:

- **macOS:** right-click the app → **Open** → confirm (Gatekeeper blocks a double-click on unsigned apps).
- **Windows:** SmartScreen → **More info** → **Run anyway**.
- **Linux (AppImage):** `chmod +x` the file, then run it.
