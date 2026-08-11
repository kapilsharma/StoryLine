# LLM wiki — read this first (for AI coding agents)

This folder is **context for AI coding agents** (Claude, or any other), not primarily for humans. It is the portable, committed replacement for an agent's private per-machine memory: clone the repo on any machine, with any LLM/account, and an agent can rebuild the project context by reading these files.

**If you are an AI agent working in this repo, read every file in this folder before making changes.**

## Golden rules (do not violate)

1. **Never run `git add`, `git commit`, or `git push`.** The maintainer reviews and commits every change by hand. Do the work in the working tree, verify it, then stop and hand off a summary + a suggested commit message. See [git-golden-rules.md](./git-golden-rules.md).
2. **`main` is protected** — all changes land via a pull request (the maintainer opens/merges it). Work on a feature branch when asked; never push to `main`.
3. **Verify before handing off** — typecheck, tests, build, and (for UI/runtime changes) boot the app. See [project-overview.md](./project-overview.md#verify-workflow).

## Index

- [project-overview.md](./project-overview.md) — what the app is, architecture, on-disk data model, key files, and the verify workflow.
- [versioning-and-schema.md](./versioning-and-schema.md) — semver policy, the on-disk `schemaVersion`, migrations, and when a change is "breaking."
- [working-on-issues.md](./working-on-issues.md) — how work is tracked (GitHub Issues) and the per-issue flow, including conventional commits and release automation.
- [git-golden-rules.md](./git-golden-rules.md) — the never-commit rule and the clean-baseline habit.
- [electron-gotchas.md](./electron-gotchas.md) — environment quirks that waste time if unknown.
- [`../workflow.md`](../workflow.md) — build/release/branch-protection details (release-please, installers, CI).

Keep these files current: when a workflow or fact here changes, update the relevant file in the same change so the next agent inherits the correction.
