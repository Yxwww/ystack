---
name: pr-catchup
description: >-
  Brings the agent up to speed on a pull request it is resuming work on — reads
  the PR, its
  diff and the surrounding code it touches (opening changed files and their
  callers to understand context, not just the hunks), the linked Jira ticket,
  any matching memory notes, local branch hygiene
  (uncommitted/unpushed/behind-base/stashes), and CI/review/merge state, then
  returns a tight status brief. Invoke-only: applies ONLY when the user
  explicitly invokes it as /pr-catchup. Do NOT auto-trigger on phrasing cues
  like "catch me up on this PR" or "read the PR and code changes"
---

# PR Catch-up

You're reloading context on a PR the user is resuming. Lead with the answer —
what the change does and where it stands, not a line-by-line diff recital. The
user wants the situational summary they'd build in their head, in seconds.

**Prerequisites:** steps 1, 2, and 6 use the `gh` CLI (authenticated); if `gh` is
unavailable, say so and ask the user to paste the PR number/URL rather than
guessing. Step 3 needs a Jira tool; if none is available, skip it silently.

**A number beats a branch name, every time.** If the user names the PR ("it's
PR #190"), use that number for every `gh` call. Deriving the PR from the local
branch is a fallback, and a common source of a wrong answer: review worktrees
are named after the PR (`pr-190/…`) but track the PR's head as upstream, so the
branch name matches nothing. See step 1.

## What "make sense of what's happening" means here

Cast the full net, then synthesize. The numbered order is **coverage and
synthesis priority**, not strict execution order — batch independent fetches
in one tool block, and keep the two serial bits (the code-reading walk in
step 2, and the final brief) serial. Each step degrades gracefully — if a
source is missing, note it in one clause and move on. Never block the whole
brief waiting on one flaky source.

1. **Resolve the PR — by number, not by local branch name.** The local branch
   is the *least* reliable way to find the PR. Review worktrees are routinely
   named after the PR (`pr-190/app-framework`) while tracking the PR's head
   branch as upstream, so `gh pr view` on the checked-out branch name matches
   nothing and returns "no pull requests found" **for a PR that exists**. Do
   not report that as "no PR" — it is a resolution failure, not a fact.

   Resolve in this order, stopping at the first hit:
   - **A PR number or URL the user gave** — trust it; that is the fix for
     everything below.
   - **The workspace name** — `devs/workspaces/<subject>/*` where the subject
     carries the number (`pr-190/`), plus its `workspace.toml` `purpose`.
     `gh pr view 190` directly.
   - **The upstream branch** — `git rev-parse --abbrev-ref @{u}`, then
     `gh pr list --head <branch> --state all`.
   - **The commit subjects** — `gh pr list --search '<a distinctive subject>'`.
     Commits are frequently rebased/rewritten onto the PR head, so SHAs differ
     while subjects match; this is what makes a rewritten branch resolvable.
   - Finally, the current branch name.

   Then fetch once: `gh pr view <num> --json
   number,title,body,state,isDraft,url,headRefName,baseRefName,mergeable,mergeStateStatus,additions,deletions,changedFiles`.
   Only after all of those come up empty say no PR was found — and say *which*
   things you tried, so the user can just hand you the number.

Once the PR resolves, fan out the independent fetches in one tool block: `gh pr
diff` (step 2's fetch), `jira_get_issue` (step 3), and `gh pr checks` (step 6).
Step 4's memory scan is already in context — zero cost. The serial parts are
step 2's code-reading walk and the final brief.

2. **Read the change.** `gh pr diff` for the actual diff. Skim for the _shape_
   of the change (which files/areas, what kind of edit) — you're building a
   mental model, not reviewing. Read the PR body: it often already states the
   intent and includes example code.

   Then **read the code, not just the delta** — a diff shows changed lines, not
   the context that makes them make sense. Where a hunk isn't self-explanatory,
   open the changed file around the edit (the diff gives you line anchors) to
   see the surrounding function/module, and follow outward when the change's
   purpose is still unclear: who calls the modified function, what type or
   invariant it touches, the sibling code it mirrors. The bar is being able to
   explain _why_ the change is shaped this way, not just restate the hunks. This
   is conditional depth — a small, obvious diff (a dependency swap, a one-line
   guard) needs none of it; a subtle logic or architecture change needs you to
   read the neighborhood. Spend the reading budget where the change is load-bearing.

3. **Pull the ticket, if any.** Extract a ticket id from the branch name, PR title,
   or body — match your tracker's key shape (`ABC-123`), however it is spelled.
   If found and a tracker tool is available
   (`jira_get_issue` or equivalent), fetch it for the acceptance criteria and any
   status/comments. **Many PRs have no
   ticket** (the user's default is no-ticket); if none is present, skip this
   silently — do not invent an id or file one.

4. **Recall what you already know.** Relevant `project_*` / `feedback_*` memory
   notes for this branch are usually **already in your context** via recall
   system-reminders — scan those first (zero tool calls) for a note tied to this
   branch, ticket, or feature. Fold in what's load-bearing (prior decisions,
   gotchas, where a fix landed). Only if nothing relevant surfaced and the PR
   clearly maps to ongoing work, grep the memory index
   (pi has no built-in memory dir; grep your agent's memory index if it keeps
   one, otherwise skip) for matching terms. Treat memory as _what was true when written_ — verify a
   named file/flag still exists before leaning on it.

5. **Check the local working tree — against the PR head, not against `@{u}`.**
   This needs only the branch name and the PR's `headRefName`, so batch it with
   step 1. When resuming, local state is often the first thing that matters —
   you may have left work uncommitted.

   `git status --short --branch`, `git stash list | grep "on $(git branch --show-current):"`,
   and then **`git log --oneline origin/<headRefName>..HEAD` / `HEAD..origin/<headRefName>`**.
   The stash stack is **global, not per-branch** (it can hold 100+ entries from
   every branch you've touched); filtering to the current branch is the only way
   the count means anything — never dump the whole list.

   **A review copy is not a feature branch — check, don't assume.** When the
   workspace's purpose is review, the local branch is typically a *replica* of
   the PR head, re-committed locally so its SHAs differ. Then:
   - `@{u}` points at the **PR head**, not at the PR's base, so
     `git status`'s "ahead N / behind M" measures your copy against the PR —
     it does **not** mean the PR is behind its base and does **not** mean
     anyone pushed. Reporting it as "branch is 86 behind, drifted" is wrong.
   - Every local commit showing as "unpushed" may be byte-identical to one
     already on the PR. Confirm before calling it unpushed work:
     `git log --oneline origin/<headRefName>..HEAD` lists rewritten twins of
     commits the PR already has — compare **subjects**, and only call out
     genuinely new ones.
   - Uncommitted changes, by contrast, are real either way: they are work on
     your copy whether or not the PR has it.

   So state it as what it is: "review copy, N commits ahead of PR head by SHA,
   same subjects", or "M commits genuinely not on the PR", never bare
   ahead/behind arithmetic. Call out the drift the user acts on: dirty tree,
   commits with no counterpart on the PR head, stash parked on this branch.

6. **Check where it stands remotely.** `gh pr checks` for CI, and read the review state
   / mergeability from the JSON in step 1. When the repo has branch-protection
   gates, call them out explicitly: a required **code-owner** review (approval
   from a non-bot reviewer; cursor approval alone may leave it BLOCKED),
   dismiss-on-push behavior, and any PR-title lint rule.

## Output: tight status brief

Lead with the answer. Use short, scannable sections — dense, no preamble. Adapt
the headers to what's actually notable; omit a section rather than pad it.

```
**<PR title>** · #<num> · <draft|ready> · <headRefName> → <baseRefName>

**What it does** — 1–3 sentences: the intent and approach. Pull from the ticket
/ body / your memory notes, not just the diff.

**Key changes**
- <area/file>: <what changed and why it matters>
- … (group by area; skip trivial/mechanical files)

**Where it stands** — Local (<clean|N uncommitted>, <commits genuinely not on the
PR head — or "review copy, nothing new">, <stash parked>), CI (<pass/fail/pending>),
review (<state; name the code-owner gate if blocking>), mergeable (<yes/conflicts/blocked>).
Note the last commit's intent if it clarifies what's in flight. Lead with local
drift — it's what the user acts on first.

**Open questions / next** — anything unresolved: unaddressed review comments,
failing checks, a half-finished thread from your memory notes. Omit if clean.
```

Name the branch you resolved from (`#190 · av/met-live-nav → master`), so a
wrong resolution is visible at a glance instead of silently reshaping the brief.

Keep the whole thing skimmable in ~20 seconds. If something in the diff
contradicts the ticket or the PR body, surface that — a drifted description is
exactly the kind of thing the user resumes work needing to know.

**Re-read the PR body before writing the brief.** Long-running integration PRs
carry their history in the body as appended `## Update —` sections, each with
its own verification numbers and canary version. The body is often the only
place that says what was found last and what is still open, so a brief built
from the diff alone will restate settled ground and miss the live thread. Take
the *newest* update section as the current state, not the original description.
