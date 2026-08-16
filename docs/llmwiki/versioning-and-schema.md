# Versioning & schema policy

## Version format

Bare `MAJOR.MINOR.PATCH` — **no `v` prefix** (tags, `CHANGELOG.md` headers, release titles). Write `0.2.0`, not `v0.2.0`.

Releases are automated by release-please from Conventional Commits; the maintainer merges the release PR. See [../workflow.md](../workflow.md).

## What the major version means here

`0.x` meant **not yet in a usable state**. `1.0.0` marks the point where the app
is usable for real work — it is a statement about the product, not a promise of
API compatibility to anyone. There is no external consumer of the IPC layer, and
the app ships main, preload and renderer together, so an internal signature
change is not a "breaking change" in the semver sense and should not be labelled
one.

What *is* breaking is a change to the **on-disk format**, because that is the
only contract with anything outside a single build: the user's project folder.
See below.

## Semver policy

- **Pre-1.0.0:** loose — patch bumps were acceptable even for small features.
- **1.0.0 onward (current):** **major** = a change that makes an existing project
  folder load wrong (see "When is a change breaking?"), **minor** = a
  non-breaking feature, **patch** = bugfix.

Which conventional-commit type drives which bump: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major. `chore`/`docs`/`ci`/`test`/`refactor` → no release.

To release a specific version regardless of the commit types — as 1.0.0 itself
was — put `Release-As: <version>` in the commit footer.

Which conventional-commit type drives which bump: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major. `chore`/`docs`/`ci`/`test`/`refactor` → no release.

## On-disk schema

`project.json` carries a numeric `schemaVersion` (constant `SCHEMA_VERSION` in `src/shared/types.ts`, currently **3**). Old projects without the stamp are backfilled to 1 by `normalizeProject`.

Migrations run on open via `migrateIfNeeded` in `src/main/data/migrate.ts` (called from `loadSnapshot`); each step backs up first (`.zn-story-line-backup-vN/`).

- **v1→v2:** moved characters/timeline/notes from project-global folders into per-board folders — "fully independent boards."
- **v2→v3:** stamped a stable `uid` into every note and switched card links from filename (`noteFile`) to `noteUid` — rename-safe notes.

## When is a change "breaking"? (read before editing the data model)

Judge whether a change is backward-compatible with existing on-disk files:

- **Additive/optional fields → non-breaking.** Handled by lenient parsing + the `normalize*` defaults. No schema bump. (Example: `View.mode` for the timeline tree was additive — defaulted via `normalizeView`, no bump.)
- **Renaming/removing/retyping a field, or changing a structure (card/related/board/view shape) so old files load wrong → breaking.** This warrants: bump `SCHEMA_VERSION`, add the next migration step (`vN→vN+1`, backing up first), a major app-version bump (post-1.0.0), and an explicit heads-up to the maintainer.

Prefer additive changes with lenient reads; reserve migrations for genuine breaks.
