---
name: placement-review
description: "Placement review of a plan or a diff: for every new function, loop, state, option, or test, find its existing home — the loop or state compute to fold it into, the right layer, the repo's pattern, a cheaper path, the existing test to extend. Use before ExitPlanMode, when reviewing a plan, from code-review, or when asked \"where should this go\" or \"can this be combined\"."
---

New code is locally safe to add and globally expensive to keep. This skill pushes every new piece of a plan or diff toward an existing **home**: the module that owns the concern, the loop that already walks the data, the test that already builds the fixture. A new home is fine when it is justified; an unexamined one is the finding.

Two modes, same questions:

- **Plan mode**: input is a plan (the current plan-mode plan, or a spec/plan file). Output: the plan, rewritten.
- **Review mode**: input is a git ref. Output: a report. Edits belong to the author or `simplify`.

## 1. Pin the input

- Plan mode: the plan text, verbatim. If it lives only in conversation, write it to a scratch file so the reviewer can read it.
- Review mode: take the ref from the user or the calling skill; if none was named, ask. Then `git diff <ref>...HEAD`.

Empty plan or empty diff → stop and say so.

## 2. Inventory the new units

List every **unit** the input adds:

- function, module, type, or file
- loop or pass over a collection
- state: a field, cache, derived value, option, or flag
- a new call site wiring one layer into another
- test, tagged with its tier: unit / integration / e2e

Done when every plan step or diff hunk maps to at least one unit, or is marked "no new unit" (renames, deletions, pure edits to existing lines).

## 3. Dispatch a fresh reviewer

Spawn one `general-purpose` subagent with a **fresh** context. Never a fork: the author's reasoning is exactly the anchor this review exists to escape. If you already are a subagent (e.g. `code-review`'s Placement axis), run steps 4–5 yourself.

The brief carries:

- the plan file path or the diff command
- the inventory from step 2
- the repo's standards files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, style docs) by path
- an instruction to read the **Questions** and **Verify** sections of this file: `~/.agents/skills/placement-review/SKILL.md`
- search rules: `rg` scoped to source directories, `rg -l` before reading, bounded `--max-count`

Ask for the report table in [Report](#report), under 500 words.

More than ~15 units across unrelated areas → split by area into up to 4 parallel reviewers.

## 4. Questions

Ask every question of every unit. Each answer is a search, not an opinion: run `rg` for the data, the type, the collection, and the sibling names before answering.

### Code

- **Home**: does a module already own this concern? Find where the same data type is created, mutated, or validated. A new file beside an existing owner is a finding.
- **Fold**: does an existing loop, pass, or state compute function already walk the same data at the same time? Two passes over one collection, or a derived value computed outside the function that computes its siblings, should **fold** into one. Same lifetime and same trigger are the test; the same data alone is not enough.
- **Layer**: is the change made at the layer that owns the invariant? Fixing a value downstream in each consumer when the producer could emit it correctly is the wrong layer; feature logic inside a shared core module is the wrong layer the other way.
- **Pattern**: how do the two or three nearest siblings solve the same problem? Cite them. A documented repo rule wins; otherwise the majority of siblings is the standard. A deviation needs a stated reason.
- **Cheaper**: is there a faster path? An existing index, cache, or lookup; moving work from per-frame to load time; deleting the work outright. Name the path it runs on. Deep hot-path analysis belongs to `code-review`'s Perf axis.

### Tests

- **Extend**: which existing test already builds this fixture or exercises this path? Prefer adding assertions there, with a one-line comment naming the case and why it lives in that test. A new test is justified only when no existing setup fits.
- **Tier**: what is the lowest tier that can observe this behaviour? Details, branches, and edge cases belong in unit tests. An e2e test covers wiring that exists only end-to-end, one happy path per feature, and states what no unit test can see. Every new e2e test without that statement is a finding.

## 5. Verify

Before a finding is reported:

- It cites `file:line` of the concrete home: the loop, the owner module, the sibling, the existing test. **No citation, no finding.**
- The suggested home fits: same lifetime, same data, no new dependency from a lower layer to a higher one. A merge that couples unrelated concerns is worse than the duplicate.
- Pre-existing placement problems the change didn't touch are labelled **FYI**, not findings.

Zero findings is a valid result.

## 6. Act on the report

- **Plan mode**: rewrite the affected plan steps in place so they target the cited homes. Append a short `Placement` section: one line per moved unit (what, where, why), and one line per unit that stays new with its justification. Then continue (e.g. `ExitPlanMode`).
- **Review mode**: return the report unchanged. Labels follow `code-review`: unprefixed = required, **Consider:** = worth weighing, **FYI** = context.

## Report

```markdown
## Placement: <plan name | diff since ref>

| Unit | Verdict | Home | Evidence |
|---|---|---|---|
| `computeBounds()` loop | fold | `layout.ts:212` `updateLayout` pass | both iterate `nodes` per frame on resize |
| `floor-switch.e2e.ts` | demote → unit | `floor.test.ts:88` | e2e asserts label text only; unit test reaches it |
| `LabelCache` | keep | — | no existing owner; `rg LabelCache\|labelCache` empty |

<one line: N units, M moved, worst finding>
```

Verdicts: `keep` (new home justified), `fold`, `move`, `reuse`, `extend-test`, `demote → unit`, `drop`.
