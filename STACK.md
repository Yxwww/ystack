# ystack

Domain-agnostic development skills. Product- and org-specific skills live in
separate stacks, pinned to a product; this one is not.

**A skill has exactly one origin. ystack never copies what another tool owns.**
This file is the machine-readable source of truth — `install.mjs` parses it.

## `origin: dotfiles`

Authored here, under `skills/`. Restore = symlink into `~/.agents/skills/`.
`install.mjs link` owns that loop; `install.sh` is the one entry point.

| Skill | Purpose |
|---|---|
| `pre-commit` | before `git commit`; captures the *why*. Must use sentinel `/tmp/pi-pre-commit-active` — matches `git-workflow-gates.ts` |
| `pre-push` | *post*-push PR body sync. Triggered by the extension's nudge, not a skill trigger |
| `pr-catchup` | invoke-only `/pr-catchup` status brief for resuming a PR |
| `ship` | simplify → review-fix rounds → commit → push. Runs under `/tmp/pi-ship-active`; that path **must** match the extension |
| `simplify` | cleanup-only review: reuse, simplification, efficiency, altitude |
| `code-review` | three-axis review: Standards / Spec / Perf. The Perf axis delegates to its `references/perf-systems.md` for a five-axis systems pass (memory, layout, cpu, gpu, io). **Shadows** the `skills` CLI copy from `mattpocock/skills` |
| `flaky-ci` | CI-vs-local flake diagnosis; bounded local repro, then instrument CI |
### Shadows

These names also exist in the `skills` CLI manifest. The copy here wins, and
`npx skills update -g` will revert it for `code-review`:

- `code-review` → supersedes `mattpocock/skills`.

To keep the local version, skip the CLI update for that skill, or run `./install.sh`
after removing the CLI's real directory (`ln -snf` will not replace a non-empty
directory).

## `origin: skills-cli`

Installed by `npx skills add <repo> -g`, tracked in `~/.agents/.skill-lock.json`.
**Never copied into this repo.**

- `mattpocock/skills` — 29 skills, including `grilling`, `tdd`, `research`, `pr`,
  `teach`, `retro`, `chief-of-staff`, `codebase-design`, `diagnosing-bugs`,
  `domain-modeling`, `grill-with-docs`, `prototype`, `writing-for-agents`.

`install.mjs skills-cli` re-adds any tracked skill whose folder is missing.
Membership is read from the lockfile, not from this file, because the CLI owns
that list.

## `origin: cli-installer`

Skills that are **generated stubs** from a CLI you installed. Restore = re-run the
tool; never commit a copy — the tool rewrites the file on upgrade.

`doctor` verifies these resolve too. A cli-installer skill is often a **symlink into
the tool's own cache**, so its target moves when the tool upgrades — that failure is
silent otherwise (the link dangles and the skill just stops loading).

| Skill | Install | Regenerate skill |
|---|---|---|
| `agent-browser` | `brew install agent-browser` | `agent-browser skills install` |
| `rex` | Rex app (`com.superlogical.rex`) | `rex skill setup` |
| `skill-creator` | Claude Code plugin: `claude plugin install skill-creator@claude-plugins-official` | `ln -snf ~/.claude/plugins/cache/claude-plugins-official/skill-creator/*/skills/skill-creator ~/.agents/skills/skill-creator` |

All three stubs say so themselves: `agent-browser` points at `agent-browser skills get core`,
`rex` at `rex __internal skill`. Backing any of them up would freeze a stale pointer.

`skill-creator` is the odd one: the plugin delivers the skill to Claude Code, but not to
`~/.agents/skills/`, so the symlink is what makes it loadable elsewhere. Its cache path
carries a version segment that changes on plugin upgrade — hence the `*` in the regenerate
command, and hence the dangling-link check in `doctor`.

## `parked`

Kept in `skills/` for reference but **not linked** by `install.mjs`. The file stays
recoverable; nothing loads it.

- `pf` — port finder / process manager CLI. Parked because it was never invoked:
the user drives the `pf` TUI directly, so there was no port question left for an
agent to answer. Rescoped around agent-shaped questions ("is this repo already
serving", "is 5173 free") but parked rather than trusted until something asks.
Revive by moving it back to `origin: dotfiles`. The binary itself lives in the
dotfiles repo (`apps/ports`) and is unaffected either way.

## `excluded`

Belongs to another stack. ystack neither installs nor links these — they are
domain-specific and live in separate (private) repos that ystack does not name:

- `bump-sdk`
- `dev-flow`
- `review-loop`
- `sdk-browser`
- `sdk-issue-report`
- `task-board`

## Usage

```sh
./install.sh                            # new machine: link, restore skills-CLI, doctor

./scripts/install.mjs check             # report state, change nothing
./scripts/install.mjs link              # symlink origin:dotfiles, remove stale links
./scripts/install.mjs skills-cli        # restore missing skills-CLI skills from the lockfile
./scripts/install.mjs doctor            # verify every declared skill resolves
```

`install.sh` runs `link`, then `skills-cli`, then `doctor`. It exits non-zero if
any declared skill does not resolve.

**`skills-cli` may refuse.** `npx skills add` installs a whole package at once, and
`mattpocock/skills` also ships its own `code-review` — installing that package would
overwrite the symlink this repo owns. So the installer refuses that source instead of
clobbering it. This is deliberate, not a bug: install that package by hand, remove its
`code-review` directory, then re-run `./install.sh`.
