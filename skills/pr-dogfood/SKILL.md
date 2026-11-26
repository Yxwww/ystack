---
name: pr-dogfood
description: "Understand a pull request, then prove it works: read the change until you can explain it, run the multi-axis review, dogfood it live in a browser with one agent per feature, and write the record — a per-feature dogfood report, the re-rated aggregate, and a single-file HTML explainer a human can read without opening the code. Each review run writes a timestamped directory under pr-review/<n>/runs/, so the review history accumulates instead of being overwritten. Use when the user says \"review this PR\", \"dogfood it\", \"check this PR works\", \"explain what this PR does\", or drops a PR URL/number. Also use when they want a nice HTML write-up of a branch or a diff, even if they never say the word review."
---

# pr-dogfood

Four phases, one record. The order is the process — do not skip to the review
before you understand the change, and do not write the explainer before the
dogfood, because the explainer is where the dogfood's surprises land.

| Phase | Question | Output |
|---|---|---|
| 1. Learn | What does this change actually do? | prose in chat, then `README.md` |
| 2. Review | Is it right, and does it fit? | `axes/*.md` via the `code-review` skill |
| 3. Dogfood | Does it work when I run it? | `dogfood/*.md` + `evidence/*.png` |
| 4. Explain | Can someone else get it without reading the diff? | `explainer.html` |

**Why all four.** A review alone tells you the code is sound but not that it renders;
a dogfood alone finds bugs but not whether they were asked for; neither produces
anything a product manager can read. The four together are what makes a PR review
*land* — and the record is what makes it useful a month later, when the person who
reviewed it has forgotten why they trusted it.

## 1. Learn the change

Read the PR body, the linked ticket or ADR, and the tests. Read the **tests last**
and read the **docs first**: a PR body states intent, which is the one thing a diff
cannot tell you, and a diff states what happened, which is the one thing a PR body
gets wrong by accident.

Then explain it out loud, in chat, before reviewing anything:

- **The problem in one sentence.** Not the solution — the problem. If you can't
  state it without naming the fix, you don't understand the change yet.
- **The idea in one sentence**, then a worked example with real numbers from the code.
- **What it deliberately does not do**, with a pointer to where that is written down.

That last one is the highest-value reading you will do. A PR's "known gaps" section
is where its author was most honest, and it is where most of your review findings
will live once you check whether the gap is documented everywhere it needs to be.

Do not start phase 2 until you can answer "what breaks if this is reverted?" without
looking.

## 2. Review

Run the `code-review` skill. Do not reimplement it here — it owns the axes, the
briefs, the mutation checks and the labelling, and a second copy of that process
would drift from it.

That skill writes `<run>/axes/*.md` and `<run>/README.md`. `pr-dogfood` uses the
same run directory (see [Where the record goes](#where-the-record-goes)), so phase 2
and phase 3 accumulate into one place.

Add one instruction to the axes for this workflow:

> Judge the PR body's own claims as a spec fixture. Every specific, checkable
> assertion in it — a measured number, a test count, a snapshot delta, a "verified,
> not assumed" — either holds against the artefacts or it does not. List each claim
> with a verdict. A PR body that overstates is a finding in its own right, because
> it is what the next reviewer will believe instead of reading.

That instruction earns its place: PR bodies routinely contain claims that were true
at an earlier commit, and a reviewer who trusts them reviews a tree that no longer
exists.

## 3. Dogfood

Review says the code is sound. Dogfood says the code **does something**. They fail
independently — a change can be perfectly reviewed and completely inert, and the
most common bug in a well-tested PR is a call site no test reaches.

Dogfood the *product in the state a customer sees*, not the test suite. Load the real
example, use the real venue, and report what happened.

### Split the PR into features and fan out

One agent for the whole PR produces one shallow report. **Split the change into the
features a user would name** — "live navigation", "entity picker", "portal
transparency" — and give each its own agent and its own report. Seven parallel agents
each going deep on one feature beat one agent skimming all seven, and the split is
what makes each report readable on its own.

Decide the split from the diff and the PR body, not from the file layout: two files
can serve one feature, and one file can serve three. Name each feature the way the
product names it. If the change really is one feature, one report is correct — don't
manufacture a split to look thorough.

Spawn them **in parallel, in one message**, each with a self-contained brief: the
checkout path, the entry point and how to drive it, the spec or doc lines to judge
against, and the output path. An agent that has to rediscover the dev server has
spent its context on plumbing.

### What each agent does

1. **Get it running.** Follow the repo's own dev-server instructions; don't invent a
   build path. If a prerequisite package is unbuilt, build it rather than concluding
   the PR is broken — and record that you had to, because a broken getting-started
   path is a real finding for the next person even when it isn't this PR's fault.
2. **Build the checklist from the docs**, not from the code. Each row is a promise
   the feature makes, quoted from a spec or a doc page with its location. A checklist
   written from the implementation can only confirm the implementation.
3. **Drive it from the API the PR adds.** The example app is a convenience, not the
   subject. Exercise the new public surface directly — call the new field with a real
   value, then clear it — and capture state before, during and after. A feature that
   only works through the demo's hardcoded path is a feature that works in the demo.
4. **Capture a numbered sequence** into `<run>/dogfood/<feature>/01-<what>.png`,
   `02-<what>.png`, … The numbers are the walkthrough: a reader can follow the path
   without reading your prose, and a later run can be compared shot for shot.
5. **Measure, don't eyeball.** If the change affects rendering, compute something
   numeric from the frames (mean saturation, pixel diff, checksum). A screenshot
   proves what you saw; a number proves what changed.

### Prove the negative

The most valuable step is the one that proves **absence**:

- after clearing a field, is the frame **byte-identical** to before it was set?
  Compare checksums — the strongest available statement that nothing leaked.
- does an unknown id warn and leave the state untouched?
- does the feature correctly do nothing where it is meant to do nothing?

An "it works" screenshot is weak evidence. "Here is the exact frame where it
provably isn't" is strong.

### The per-feature report

`<run>/dogfood/<feature>.md`, one per feature. The **Results** table is the spine:
one row per promise, expected quoted from the doc, observed from the run, verdict.
The `Bugs` section is for anything that failed, and each bug gets the five parts
below — a bug report without a repro is an opinion, and one without a suspected cause
costs the author the same trace you just did.

```markdown
# <Feature>: dogfood report

- **Date:** <yyyy-mm-dd>
- **Run:** `runs/<stamp>` — see `<root>/README.md` for earlier reviews of this PR
- **Demo / entry point:** <url or command, viewport>
- **PR / branch:** #<n> / `<branch>`
- **Head:** `<sha>` (line numbers are against that commit)
- **Verdict:** <Ready | Ready with issues | Not ready> — <one sentence, naming the worst bug>

## Summary
<what you exercised; then one bullet per bug, `B<n> (severity)` leading>

## Results
| Scenario | Expected (doc/spec) | Observed | Verdict |
|---|---|---|---|
| <what you did> | <quoted promise + where it is written> | <what happened, with numbers> | PASS / PARTIAL (B<n>) / **FAIL (B<n>)** / NOT TESTED |

## Bugs

### B1 — <severity>: <the claim, as a sentence>

**Repro (deterministic):**
1. <numbered steps a stranger could follow>
2. <paste the exact payload/command you sent — not a description of it>
3. <what to wait for and what to look at>

**Expected:** <and where that is written down>

**Actual:** <what happened, with the numbers that make it undeniable>

**Suspected cause:**
- `<file:line>` — <the line and why it produces this>

**Severity:** <blocker | major | minor> — <what it costs the user, and whether they can recover>
```

`NOT TESTED` is a real answer: a path no fixture reaches is a gap in the pass, and
omitting the row makes the report read as though it passed. Say so, and say what
would close it.

### Aggregate, and re-rate the labels

The feature reports are inputs, not conclusions. Once they are all in, write
`<run>/dogfood/README.md` yourself, and **do not take their severities at face value**.

Each agent judged one feature in isolation and had every reason to inflate: a minor
inconvenience in its feature reads as blocking when it is the only thing that agent
saw. Your job is the comparison the individual agents could not do:

- **Re-rate against the whole PR.** A "blocker" in a demo scaffold is not the PR's
  blocker. A finding that predates the diff is not the PR's at all — check the base
  commit before blaming it.
- **De-duplicate across features.** One root cause surfacing in two reports is one
  item, not two. Say which finding it came from so it isn't lost.
- **Record every re-rate.** A severity note that says "reported High → blocking:
  defeats the feature's headline contract on a real venue shape" is what makes the
  verdict trustworthy. A sideways move with no reason is worse than no rating.

```markdown
# PR #<n>: dogfood findings

- **Date:** <yyyy-mm-dd> · **Run:** `runs/<stamp>` · **Head:** `<sha>`
- **How these findings were produced:** <one sentence: N agents, one feature each,
  venue, entry point. Name anything uncommitted that the reader won't find in the PR.>
- **Report labels are not taken at face value.** <where you re-rated, and why>

## Verdict at a glance

Overall: <one line>.

| Feature | Verdict | Top finding | Report |
|---|---|---|---|
| <feature> | <Ready \| Ready with issues \| **Not ready**> | <one sentence> | [x.md](x.md) |

### Severity notes
- **<Feature> `B<n>` (report: <label>) → <new label>.** <why it moved>.

## Blocking

### 1. <the claim>
**Problem.** <one paragraph>
**User impact.** <concrete, with numbers>
**Evidence.** [<feature>.md](<feature>.md) `B<n>`; `<file:line>`

## Should fix

## Pre-existing, not this PR
```

The `Pre-existing` section is not a dumping ground — it is what stops a review from
being ignored. A reader who sees three real PR problems and four things the change
didn't cause will trust the three.


## 4. Explain

Write `<run>/explainer.html`: one self-contained file. It exists because the people
who need to understand a change — the PM, the designer, the next engineer — will not
read a 1400-line diff, and a markdown file with no figures makes them read anyway.

Content, in this order. The order is the argument, not a template to pad:

1. **What this is**, in two sentences, with the head SHA named so the reader knows
   what they are looking at.
2. **The problem** — the concrete annoyance, not the abstraction. "Every space on a
   floor looked identical" beats "lacked per-instance granularity".
3. **The idea** — the one decision the rest follows from, with its rule stated as
   arithmetic or a short pseudo-line. If the rule is a formula, show the formula.
4. **A worked example with real numbers** from your own run, not from the PR body.
   Show the before/after and the delta.
5. **Figures** — the screenshots, inline, with captions that say what to look at and
   what the numbers are. Side-by-side when they are a pair, because the comparison
   is the content.
6. **What it deliberately does not do** — the known gap, named, with where the design
   for it lives.
7. **What surprised me** — your own dogfood findings, phrased as prose. This is the
   section a reader trusts most, because it is the only part that could not have been
   generated from the diff.

Make it look like a document, not a wiki dump: one reading column, real type, a
figure that can be seen. Respect `prefers-color-scheme`. Keep it a single file with
no build step — a reader should be able to open it from the repo or send it to
someone. Do **not** embed the PR's screenshots as base64 if they are already in
`evidence/`; relative paths keep the file readable and diffable.

State at the top of the file how it was produced, including what you could not run.

## Where the record goes

One `<root>` per change, resolved once and reused by every phase:

| Situation | `<root>` |
|---|---|
| A pull request | `<repo>/pr-review/<number>/` |
| A branch with no PR | `<repo>/pr-review/<branch-slug>/` |
| Local work, no branch yet | `.scratch/review-<date>/` |

`<run>` (used throughout this skill) is `<root>/runs/<stamp>/` — the directory one
review run writes to. Resolve both once, at the start, and pass `<run>`'s absolute
path to every axis.

Under the **repo being reviewed**, not the reviewer's workspace — a workspace gets
torn down and the record is about that code. Keyed by PR number because that is the
stable identity; branches get renamed and head SHAs move on every push.

### Every run gets its own timestamped directory

A PR gets reviewed more than once — a new push, a re-review after a force-push, a
second look a month later. **Each run writes to a fresh directory**, never over the
last one:

```
<root>/runs/<yyyy-mm-dd>-<hhmm>-<head7>/
```

`<head7>` is the short SHA of the commit you reviewed. That is the part that makes
the history navigable: two runs on the same day are told apart by time, and two runs
of the same time are told apart by what they looked at. A `git log` of the review
directory then reads as the change's own history — what was found, what got fixed,
what someone disagreed with.

**Never overwrite a previous run.** If you disagree with an earlier finding, write a
new run that says so; the earlier file is a record of what was believed then, and
editing it destroys the one thing a history is for. Say in the new run what changed
since the last one — `git log --oneline` on the directory tells you what it saw.

Each run directory is self-contained:

```
<root>/
├── README.md            current state: latest run, verdict, links to every run
└── runs/
    └── 2026-11-26-0822-87c7c7a/
        ├── README.md        this run: verdict, one line per subject, links
        ├── axes/            from phase 2, written by each axis itself
        │   └── {standards,spec,perf,placement}.md
        ├── dogfood/
        │   ├── README.md      the aggregate: verdict, severity re-rates  (coordinator)
        │   ├── <feature>.md   one per feature, written by its own agent
        │   └── <feature>/     numbered screenshots: 01-place-dot.png, 02-walking.png, …
        ├── evidence/          frames that are not part of a feature walkthrough
        │   └── *.png          (phase-2 axis evidence, or a figure the explainer cites)
        └── explainer.html   from phase 4
```

Start by creating the run directory and resolving its absolute path — pass that to
every axis, so nothing lands in a previous run by accident. If you are re-running
because the head moved, a new directory is not optional: `evidence/` filenames
repeat across runs (the same example, the same step order), and reusing a directory
means last week's screenshot silently stands in for this week's.

### The two READMEs are different jobs

`<root>/README.md` is the **current state**: the latest verdict, the links, and one
line per prior run so a reader sees the history without opening anything. It is the
only file a new run is allowed to rewrite. It should read like this:

```markdown
## Review history

| Run | Head | Verdict | Notable |
|---|---|---|---|
| [2026-11-26-1430-a3f21b8](runs/2026-11-26-1430-a3f21b8/) | `a3f21b8` | land | earlier finding closed by the push |
| [2026-11-26-0822-87c7c7a](runs/2026-11-26-0822-87c7c7a/) | `87c7c7a` | land | 2 findings, 1 rejected on evidence |
| [2026-11-25-1042-4e9c1d3](runs/2026-11-25-1042-4e9c1d3/) | `4e9c1d3` | don't land | untested call site |
```

Newest first. "Notable" carries the one fact a reader needs to tell the runs apart —
not a summary of everything in it.

`<root>/runs/<stamp>/README.md` is that run's index: verdict, one line per subject,
links within the run. It is an index, not a second copy — if a finding appears in
both it and a subject file, they will disagree eventually.

## House format for the .md reports

The subject files are the durable record, so match the shape they already have in
this org — a header block of facts, then prose that argues, then the evidence:

```markdown
# PR #<n> review — <the claim, as a sentence>

- **PR:** `<org>/<repo>` #<n>
- **Head:** `<sha>`. Line numbers are against that commit.
- **Run:** `runs/<stamp>` (so a reader who opens this file alone can find its siblings)
- **Status:** <drafted | posted | local only>

## The <thing>
<what it looks like, and what is actually true>

## Why this <is deliberate | is a bug | matters>
<the argument, with file:line for every assertion>

## <the fix, cheapest first>
```

The **Run** line is what keeps a file honest once there is more than one review. A
finding is a claim about a moment; the same line at a later head may be fixed,
still broken, or no longer true. Naming the run and the head lets the next reviewer
check rather than trust.

If the head moved since the last run, **read the previous run's findings before
writing new ones** and say for each whether it still holds. A history that only
accumulates findings, never closes them, becomes a list of things nobody checked
twice — which is worse than no history, because it looks diligent.

Rules that make these worth reading later:

- **Every claim carries `file:line`.** A finding without a location is a rumour.
- **Say which findings you rejected, and why.** A record that only lists hits can't
  tell whether the reviewer was thorough or credulous. "I could not reproduce this"
  is a result, and it stops the next person chasing it again.
- **Separate what is this PR's fault from what was already broken.** Check the base
  commit before blaming the diff.
- **Never soften a real issue, never inflate a small one.** "Might be a minor
  concern" about a broken path is dishonest; "CRITICAL" about a stale comment is
  noise that costs the document its credibility.
- **No headings, no template, in a *comment*.** The files are structured. A PR
  comment is prose. Don't confuse the two.

## Posting is a separate step

Writing the record is not posting to the PR. A comment speaks as the team, so show
the body to the human first and post only on their instruction. Never approve,
merge, or request changes on someone else's PR; a bot approval is indistinguishable
from a human one to anything downstream.

## Report

In chat, answer the question the user actually asked — usually "is this good?" and
"what is it?" — not "here are four files":

```
## What it is
<two sentences: the problem, the idea>

## Does it work
<the dogfood verdict, with the one number that proves it>

## Does it hold up
<the review verdict: counts per axis, the worst finding in each>

## What I'd do
<land / land after X / don't land, and why>

Record: <run>/  (history: <root>/runs/)
```

Then stop. If they want the explainer opened or the comment posted, they will say so.
