---
name: pre-push
description: >
  Runs after pushing to git. Updates the open PR description to accurately reflect what was pushed.
  Trigger when the user says "pushed", "ready to push", "update the PR", or after git push completes.
  Also auto-triggers via the git-workflow-gates extension's tool_result nudge after a successful git push.
---

# Post-Push: Update PR Description

## Step 1: Check for an open PR

```bash
gh pr view --json number,url,body,title 2>/dev/null
```

If no PR exists, stop here.

## Step 2: Understand what was pushed

Diff against the PR's own base, not a hardcoded branch — reuse the `baseRefName`
from Step 1's `gh pr view`:

```bash
gh pr view --json baseRefName -q .baseRefName   # e.g. master, main
BASE=$(gh pr view --json baseRefName -q .baseRefName)
git log "origin/$BASE"..HEAD --oneline
git diff "origin/$BASE"...HEAD --stat
```

## Step 3: Write the PR description to follow the template

Read the repo's PR template (check `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`, `pull_request_template.md`).

The body must **follow the template's structure** — keep every section heading, in template order. How you get there depends on the current body:

- **Body already follows the template** — update only the sections whose content changed; leave the rest untouched.
- **Body is empty or still has placeholder HTML comments** — fill every REQUIRED section from the diff/commits.
- **Body is free-form / doesn't match the template** (common for AI-generated descriptions) — **restructure it**: fold the existing prose into the matching template sections, drop prose that has no home, and add any REQUIRED section that's missing. Do not preserve a non-template layout just because it was there first.

Style:
- **Overview over detail.** The body states what ships and why it holds; it is not a changelog of the diff.
  A reviewer reads the body to decide *how* to review, then reads the code. Anything only readable
  next to its lines belongs in the diff, a commit message, or a design doc — not here. Step 4 is the
  checklist for this.
- **Point at the design artifact** (openspec change, ADR, RFC) by path instead of inlining its
  reasoning. Duplicated design prose in the body goes stale separately from the doc it copied.
- Concise — bullets over prose. Lead with the change, not the background.
- Checkbox impact sections (Breaking API, CSP, Analytics, Wrappers, Security, Privacy, DevOps): check `[x] Yes` only when the answer is genuinely yes; otherwise leave `[ ] Yes` unchecked with a one-line reason on the next line.
- Remove placeholder HTML comments (`<!-- ... -->`) from sections you filled. Leave them in unfilled OPTIONAL sections.
- Preserve content the user hand-wrote — relocate it into the right section rather than rewriting it.

## Step 4: Trim to the overview

The template sets the sections; this sets their weight. Before writing, and again before posting,
cut what a reviewer can read faster in the diff.

Keep:
- What ships, and the one or two rules a reviewer cannot infer from the code (a non-obvious
  ordering, a load-bearing constraint).
- Evidence as the *conclusion*: a few lines of test/build output, plus one sentence naming what the
  cases cover. Not the full transcript, not a table of every gate.
- Merge danger: door, blast radius, and real consumer breakage.

Cut:
- Per-file or per-function inventories, `+N/-N` line sketches, "DELETED (137 lines)" annotations.
- Mutation-check / gate tables, and per-delta "and why it's acceptable" subsections.
- Before/after of things the diff already shows; repeated evidence blocks.
- Stale byte counts and file sizes (they drift the moment the chunk graph changes).
- Design reasoning that a linked openspec/ADR already owns.

Then check the size:

```bash
wc -c /tmp/pr-<number>-body.md    # target ~2-4k chars; >6k means diff detail leaked in
```

Never drop:
- The reason behind a counter-intuitive rule — reviewers cannot reconstruct that from the diff.
- Consumer-facing breakage, and known limits that affect merging.
- Content the user hand-wrote.

Write the body to a temp file and use `--body-file` (robust for multi-line bodies, backticks, and code fences — `--body` breaks on those):

```bash
gh pr edit <number> --body-file /tmp/pr-<number>-body.md
```

Report the PR URL when done.
