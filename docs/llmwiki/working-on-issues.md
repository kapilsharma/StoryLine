# Working on issues

Work is tracked in **GitHub Issues** on the repo. When the maintainer says **"check issue N"** / "work on issue N", read it with the GitHub CLI:

```bash
gh issue view N          # body + metadata
gh issue list --state open
```

(If `gh` isn't installed/authenticated on this machine, say so — issues can't be read without it or the GitHub API.)

## Per-issue flow

1. **Read the issue.** Some are written at a high level.
2. **Clarify real forks first.** If it's a major/ambiguous change (especially UI), ask a few concise, decision-shaping questions before building — the maintainer prefers being asked on genuine forks, and dislikes being asked about obvious defaults. Present a recommendation, not a survey.
3. **Study the relevant code**, then implement.
4. **Verify** — the full workflow in [project-overview.md](./project-overview.md#verify-workflow) (typecheck → test → build → boot). Add/extend tests for pure logic.
5. **Hand off — do not commit.** Summarise the changed files and a ready-to-paste conventional-commit message / PR text. The maintainer reviews and commits. See [git-golden-rules.md](./git-golden-rules.md).

## Branches, commits, releases

- `main` is protected: changes land through a **pull request**. Use a feature branch when asked.
- **Conventional Commits**, with the **issue number as the scope**: `feat(#12): …`, `fix(#12): …`, breaking = `feat(#12)!: …`. The type drives the version bump (see [versioning-and-schema.md](./versioning-and-schema.md)).
- Put `Closes #N` in the PR body so the issue auto-closes on merge (the `(#N)` scope alone does not close it).
- **release-please** opens a release PR from the merged commits; merging it tags the release and creates a GitHub Release. Installers are built by a separate manual workflow — see [../workflow.md](../workflow.md).

## Note on `Requirements/`

Early in the project, work was tracked in a `Requirements/` folder (`BugFeature.md`, `Questions.md`, `ChangeLog.md`, `FeatureN.md`). That folder is **gitignored and not part of the public clone** — the workflow moved to GitHub Issues + release-please's `CHANGELOG.md`. Don't expect those files to exist; don't rely on them.
