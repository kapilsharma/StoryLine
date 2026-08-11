# Git golden rules

## Never commit — hand off instead

**Never run `git add`, `git commit`, or `git push`.** This is a hard rule from the maintainer, who reviews and commits every change by hand.

Do all the work in the working tree (create a feature branch only if explicitly asked — but still don't commit to it), run the full verification, then **stop and hand off**:

- list the files you changed,
- give a ready-to-paste Conventional-Commit message (with the `(#N)` issue scope and a `Closes #N` line for the PR),
- then wait.

Do this even when finishing an issue, and even when committing would be convenient. Preparing the commit message is helpful; running git is not yours to do.

## Start big work from a clean baseline

Before a substantial change (feature, refactor, dependency upgrade, migration), run `git status`. If the tree already has uncommitted changes, **surface that and suggest the maintainer commit first**, so the big change starts from a clean, revertible point. (You don't commit it — you just flag it.) Small edits don't need this.

## Don't touch unrelated changes

If the working tree has edits you didn't make (the maintainer's in-progress work), leave them alone — don't stage, revert, or fold them into your change. Work only on the files your task needs.
