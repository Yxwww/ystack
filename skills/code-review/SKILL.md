---
name: code-review
description: "Multi-axis code review of the changes since a fixed point: Standards (does the code follow this repo's documented conventions?), Spec (does it implement what was asked?), Perf (does it cost what it should on the hot path?), and Placement (does each new unit belong where it was put?). Axes run as parallel sub-agents with independent context, each writing its own report file, and are reported separately. Use when reviewing a branch, a PR, or work-in-progress, or when asked to \"review since X\"."
---

Multi-axis review of the diff between a fixed point and `HEAD`:

- **Standards** — does the code follow this repo's documented conventions?
- **Spec** — does it implement what the originating issue or task asked for?
- **Perf** — does it cost what it should, on the paths that actually run often?
- **Placement** — does each new unit belong in the home it was given?

Each axis runs as a **sub-agent with a fresh context window** so one axis cannot anchor another, and so a Standards pass can't mask a Spec failure. This skill routes and aggregates; it does not review inline.

**Every run leaves a record on disk.** Each axis writes its own file under `<run>/axes/` and the coordinator writes `<run>/README.md` — see [§3](#3-decide-where-the-record-goes). The chat answer is a summary of the record, never a substitute for it: a review that exists only in the transcript is gone when the session ends, and a coordinator retyping findings is producing a transcription, not evidence.

The order below is the process. Do not skip ahead to findings.

## 1. Pin the fixed point

Take the ref from the user — a SHA, branch, tag, `main`, `HEAD~5`. If they didn't name one, ask; do not guess `main`.

```bash
git rev-parse <fixed-point>                 # fail here, not inside three sub-agents
git diff <fixed-point>...HEAD --stat        # three-dot = merge-base, not the tip
git log <fixed-point>..HEAD --oneline
git diff <fixed-point>...HEAD
```

Empty diff → stop, say so, don't spawn anyone. Before reviewing, size the change:

```
~100 lines    Good — reviewable in one sitting.
~300 lines    Acceptable if it is a single logical change.
~1000 lines   Too large; ask for a split before reviewing.
```

Watch *file* size as well as diff size. A small diff that pushes a file past ~1000 total lines is a decomposition hint, not a nit. Complete file deletions and mechanical refactors are the exception — the reviewer only verifies intent.

## 2. Find the spec and the standards

**Spec source**, in order: issue/ticket references in the commit messages (`#123`, `Closes #45`, `ABC-42`); a path the user passed; a spec under `docs/`, `specs/`, or `.scratch/` matching the branch. If none exists, ask once — then let the Spec axis report "no spec available" rather than inventing requirements.

**Standards source**: every file in the repo that documents how code should be written. `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, and any style doc must all be on the list if present.

## 3. Decide where the record goes

A review that exists only in the transcript is lost the moment the session ends, and a coordinator that retypes findings into a file produces a *transcription* rather than a record. So every run leaves files on disk, **written as it proceeds** — not reconstructed afterwards from what is still in context.

| Situation | `<root>` |
|---|---|
| Reviewing a pull request | `<repo>/pr-review/<number>/` |
| Reviewing a branch with no PR | `<repo>/pr-review/<branch-slug>/` |
| Reviewing local work before any branch exists | `.scratch/review-<date>/` |

**One directory per run, never over the last one.** A PR gets reviewed repeatedly — new push, force-push, a second opinion a month later — and a record that overwrites itself is a record of the most recent opinion only. Write to `<root>/runs/<yyyy-mm-dd>-<hhmm>-<head7>/`, where `<head7>` is the short SHA you reviewed. `<root>/README.md` is the current state and the only file a later run may rewrite; everything under `runs/` is immutable, including findings you now disagree with — write a new run that says so instead of editing the old one.

Put it under the **repo being reviewed**, not the reviewer's workspace: the record is about that code and must survive the workspace being torn down. `pr-review/<number>/` is keyed by PR number because that is the stable identity — a branch can be renamed and a head SHA moves on every push.

Resolve the run directory **once**, to an absolute path, and pass it to every axis. Resolving it per-axis is how you get three axes writing to three directories.

Add the directory to `.gitignore` only if the repo already ignores review notes; otherwise leave it untracked and let the author decide. Never commit a review to the reviewed branch.

## 4. Spawn the axes in parallel

Issue all sub-agent calls together, in the foreground, and aggregate what comes back. Paste each axis's material into its brief — a sub-agent has no other access to it.

**Each axis writes its own file**, so a finding cannot be softened or dropped in transit. Put this line in every brief:

> Write your report to `<run>/axes/<axis>.md` before you finish. It is the record; your returned summary may be shorter. Do not write anywhere else.

An axis is therefore read-only **except** its own report file. Say so explicitly, because "do not modify any file" and "write your report" otherwise read as a contradiction and the agent skips the write:

> Read-only: do not modify the code under review. Your report file is the one permitted write.

If an axis could not run (no spec, all cold paths), it still writes its file saying which and why. An absent file is indistinguishable from a crash.

### Standards

Brief includes the diff command, commit list, the standards files, and [the smell baseline](#the-smell-baseline) pasted in full.

> Report, per file/hunk, (a) every place the diff violates a documented standard — cite the file and rule; (b) any baseline smell — name it and quote the hunk. Documented breaches may be hard violations; baseline smells are always judgement calls. A documented repo standard always overrides the baseline. Skip anything tooling enforces. Under 400 words.

### Spec

Brief includes the diff command, commit list, and the spec text or path.

> Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each. Under 400 words.

No spec → skip this axis and say so. Do not manufacture requirements.

### Mutation — give it to an axis, not to prose

A green suite is evidence of nothing until a deliberate break makes it red. **Mutation is a step in an axis brief, not a paragraph in this skill**, because a step the reader has to interpret is a step that gets skipped. Give it to the axis whose findings it can overturn:

- **Standards**, when the change's tests are in question: **check the tests by experiment, not by reading.** Invert one condition the change adds (drop a negation, swap `&&` for `||`), run the suite, restore the file from a copy. A mutation that stays green is a finding — name the missing test case. A green suite that survives a deliberate break is evidence of nothing.
- **Spec**, when a claimed behaviour has no test reaching it: delete or invert the call site the claim depends on and re-run. Report the number of tests that stayed green; if it is the whole suite, say so in those words.

Every mutation restores the file from a copy before moving on, and the report says which mutations were tried and what each result was. A mutation that stayed green because the code is *unreachable* is a different finding from one that stayed green because no test covers it — say which, and prove it (an unreachable branch can be shown with a one-line script; an untested one cannot).

### Perf

Perf is **its own pass, not a table of web-backend smells**. Full detail lives in [references/perf-systems.md](references/perf-systems.md) — read it before spawning this axis.

Three rules govern it:

1. **Triage hot vs cold first.** The axis only exists for code on a path that runs per-frame, per-entity, or per-element. Setup, teardown, and one-shot work are cold; simple beats fast there.
2. **All cold → skip the axis and say so.** That is the most common correct answer, not a failure to review.
3. **Every finding names the path** it runs on and carries a measurement status: `measured` | `estimated` | `unverified`. If you cannot name the per-frame path, it is not a finding. Every finding also cites the cost-model rule it invokes — no rule, no finding.

### Placement

Brief: "Run the `placement-review` skill (`~/.agents/skills/placement-review/SKILL.md`) in review mode against `<fixed-point>`. You are the reviewer; do not spawn another." It asks whether each new unit, test included, belongs in an existing home — a loop to fold into, a better layer, an existing test to extend. Read-only apart from its own report file.

## 5. Aggregate

Report under `## Standards`, `## Spec`, `## Perf`, `## Placement` — separate, lightly cleaned for grammar only, **not merged and not reranked across axes**. Keeping them apart is the point: clean Standards must not bury a Spec failure. The *chat* columns may be condensed; the axis files under `<run>` stay verbatim (see [Write the index](#write-the-index)).

Within each axis, order by leverage. Label every finding:

| Prefix | Meaning | Author action |
|---|---|---|
| **Critical:** | Blocks merge — vulnerability, data loss, broken behaviour | Must fix |
| *(no prefix)* | Required change | Must fix before merge |
| **Optional:** / **Consider:** | Suggestion | Worth weighing |
| **Nit:** | Formatting, style preference | May ignore |
| **FYI** | Context only | No action |

Before reporting, check each finding against callers, guards, and tests that reach the changed code — drop it if they rule it out. Label pre-existing defects separately from regressions this change introduces. **Zero findings is a valid result; do not invent one.**

End with one line per axis: count, and the worst issue *within* that axis.

### Write the index

Only after aggregating, write `<run>/README.md`: the verdict, one line per axis with its count and worst finding, and a link to each file. It is the entry point, not a second copy — if a finding appears in both the index and an axis file, they will disagree eventually. Then refresh `<root>/README.md` so it names this run as the latest and lists the earlier ones; that top-level file is the history.

Keep the axis files exactly as the sub-agents wrote them. Do not "clean them up" in place: an axis report with the coordinator's edits is no longer evidence of what that axis found. Where you **disagree** with a finding, say so in the index and leave the axis file alone — a rejected finding is information, and the record is more useful for showing the disagreement than for erasing it.

### Structural remedies

When flagging structure, propose the move, not just the complaint. Reach for a named restructuring: replace a conditional chain with a typed model or dispatcher; collapse duplicate branches; separate orchestration from logic; move feature logic out of a shared module; reuse the canonical helper; make a type boundary explicit; delete a pass-through wrapper. Prefer the remedy that removes moving pieces over one that spreads the same complexity around.

### Dependency discipline

A dependency change is code review. Ask: does the existing stack already solve this, how large is it, is it maintained, any known vulnerabilities, what licence? Prefer the standard library — every dependency is a liability.

For upgrades, separately:

1. **Read the changelog, not the version number.** Semver is a promise maintainers do not always keep.
2. **One dependency per change.** A bulk bump that breaks the build hides which package did it.
3. **Let the tests decide** — green before *and* after. Thin coverage around the dependency is the real finding; add the test first.
4. **Mind the transitive graph.** Review the lockfile diff, not just the manifest.
5. **Keep the lockfile honest.** Commit it, review its diff, never hand-edit it.

### Dead code

After a refactor, list what the change orphaned — unreachable functions, unused constants, superseded components — and **ask before deleting**:

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
→ Safe to remove these?
```

Don't leave it lying around; don't silently delete what you aren't sure about.

## Honesty and disagreement

- **Don't rubber-stamp.** "LGTM" with no evidence of review helps nobody.
- **Don't soften real issues.** "Might be a minor concern" for a production bug is dishonest.
- **Quantify** where you can — "this runs per entity, ~10k times a frame" beats "this could be slow".
- **Push back on approaches with clear problems.** Sycophancy is a review failure mode.
- **Accept override gracefully.** The author may hold context you don't; comment on code, not people.

When resolving a dispute: technical facts override opinion, style guides own style, design is judged on engineering principles, and codebase consistency is acceptable unless it degrades health. **Don't accept "I'll clean it up later"** — require it before submission, or a filed bug with an owner.

## Report

Two outputs, and they are not the same document. The files under `<run>` are the durable record; the chat answer is the short answer to "can I land this".

**Files** (written as the review proceeds, not afterwards):

```
<root>/
├── README.md          current state: latest run + one line per earlier run
└── runs/<stamp>/
    ├── README.md      this run's index
    ├── axes/
    │   ├── standards.md   each axis, verbatim, written by its own sub-agent
    │   ├── spec.md        never retyped by the coordinator
    │   ├── perf.md
    │   └── placement.md
    └── evidence/      frames, logs, traces a claim depends on  (optional)
```

**Chat**, in this shape:

```markdown
## Review: <change> since <fixed-point>

## Standards
<findings, labelled>

## Spec
<findings, labelled — or "no spec available">

## Perf
<findings, or "all changed paths are cold — skipped">

## Placement
<placement-review table, or "every new unit has a justified home">

## Checklist
- [ ] Change matches the spec
- [ ] Edge and error paths handled
- [ ] Tests cover the change (mutation-checked, not just green)
- [ ] Names and control flow clear
- [ ] Fits existing patterns; no feature logic in shared modules
- [ ] No secrets, untrusted input validated at boundaries
- [ ] Hot paths allocation-free; cold paths left simple
- [ ] Dependencies reviewed against changelog + lockfile diff
- [ ] Verification story documented

## Verdict
- [ ] **Approve** — ready to merge
- [ ] **Request changes** — required findings must be addressed
```

**Approval standard:** approve when the change definitely improves overall code health, even if imperfect. Don't block for not being written the way you would have written it. Do block for anything Critical, for a Spec mismatch, or for a hot-path regression that is `measured` or `estimated`.

## The smell baseline

Applies even when a repo documents nothing. Two rules bind it: **the repo overrides** — a documented standard always wins where it endorses something flagged here; and **always a judgement call** — each is a labelled heuristic ("possible Feature Envy"), never a hard violation. Skip anything tooling already enforces.

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

## Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, that's good enough" | Unreadable, insecure, or misdesigned code compounds into debt. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. |
| "We'll clean it up later" | Later never comes. The review is the gate. |
| "AI-generated code is probably fine" | It needs more scrutiny, not less — confident and plausible even when wrong. |
| "The tests pass, so it's good" | Necessary, not sufficient. A mutation that stays green proves little. |
| "The refactor makes it cleaner" | Relocating complexity isn't reducing it. Prefer the version where branches disappear. |
| "It's only a small addition" | Small diffs still grow big files and bolt branches onto unrelated flows. |
| "It's just a version bump" | A bump is behaviour you didn't write. Read the changelog. |
| "It can't be slow, it's not a loop" | Cost lives on the path, not in the syntax. Check what runs per frame. |
| "Optimize it anyway" | A perf finding with no hot path and no measurement is noise. |

## See also

- [references/perf-systems.md](references/perf-systems.md) — the systems/perf axis in full: hot/cold triage, memory, data layout, CPU, GPU, IO.
