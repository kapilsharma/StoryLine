# Contributing

## Branch & PR flow

`main` is protected — no direct pushes. All changes go through a pull request:

```bash
git switch -c feat/short-description   # or fix/…, chore/…, docs/…
# …make changes…
git commit -m "feat(#12): add a thing"
git push -u origin HEAD
gh pr create --fill
```

A PR must pass **CI** (typecheck + tests + build) before it can be merged. You can merge your own PR once checks are green.

## Conventional commits

Commit messages (and, importantly, **PR titles** — merges are squashed into the PR title) follow [Conventional Commits](https://www.conventionalcommits.org/). The type decides the next version:

| Message | Release |
| --- | --- |
| `fix(#12): …` | patch (0.1.0 → 0.1.**1**) |
| `feat(#12): …` | minor (0.1.0 → 0.**2**.0) |
| `feat(#12)!: …` — or a `BREAKING CHANGE:` footer | major (0.1.0 → **1**.0.0) |
| `chore: …`, `docs: …`, `ci: …`, `test: …`, `refactor: …` | no release |

Notes:
- A breaking change is marked with a **`!`** before the colon (`feat(#12)!:`) or a `BREAKING CHANGE:` line in the commit body — **not** a `BREAKING CHANGE(scope):` prefix.
- The scope in parentheses is free-form; here we use the **issue number** (e.g. `(#12)`) so releases link back to issues.

## Releases (automated)

Releases are handled by [release-please](https://github.com/googleapis/release-please):

1. When conventional commits land on `main`, release-please opens/updates a **release PR** that bumps `package.json`, updates `CHANGELOG.md`, and lists the changes.
2. Merging that release PR creates the git tag (bare `MAJOR.MINOR.PATCH`, no `v` prefix) and a GitHub Release.

Nothing is released until you merge the release PR, so you stay in control of timing.
