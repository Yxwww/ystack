# ystack

Domain-agnostic development skills. Product- and org-specific skills live in
separate stacks, pinned to a product; this one is not.

**A skill has exactly one origin. ystack never copies what another tool owns.**
[`STACK.md`](STACK.md) is the machine-readable source of truth — `scripts/install.mjs`
parses it, so declaring a skill there is what makes it installable.

**This repo is standalone.** Nothing here references dotfiles. Every path resolves
from this repo's own root (`scripts/` → `..`), and the only thing read from outside
is the `skills` CLI's lockfile at `~/.agents/.skill-lock.json`, which the CLI owns.
Clone it anywhere and `./install.sh` works.

## The four origin classes

| Origin | What it means | Restored by |
|---|---|---|
| **dotfiles** | Authored *here*, under `skills/`. | `install.sh` → `install.mjs link` symlinks each into **every** agent config home |
| **skills-cli** | Installed by `npx skills add <repo> -g`, tracked in `~/.agents/.skill-lock.json`. **Never copied into this repo.** | `install.mjs skills-cli` re-adds missing ones from the lockfile |
| **cli-installer** | Generated stubs from a CLI you installed (`agent-browser`, `rex`). | Re-run the tool (`agent-browser skills install`, `rex skill setup`) — never commit a copy, the tool rewrites it on upgrade |
| **excluded** | Belongs to another, domain-specific stack | Not installed here at all |

The rule exists because the alternative is silent data loss. Copying a CLI-managed
skill freezes a stale version and fights `npx skills update`; symlinking over a real
directory destroys whatever the other tool put there. So `link` refuses to overwrite
a real directory, and `skills-cli` refuses a whole package that would.

## Install

Requires **Node** (>= 18) and **git**.

```sh
./install.sh
```

One entry point, three steps: link this repo's skills into every agent config home,
restore missing skills-CLI skills, then `doctor`. It resolves its own directory, so
it runs from anywhere. Exits non-zero if any declared skill fails to resolve.

### Which directories get the links

An agent only loads skills from **its own** config directory, so a link only in
`~/.agents/skills/` is invisible to some agents. `link` fans out to all of:

| Target | Default dir | Override |
|---|---|---|
| `agents` | `~/.agents/skills/` | `AGENTS_HOME` |
| `claude` | `~/.claude/skills/` | `CLAUDE_CONFIG_DIR` |
| `pi` | `~/.pi/agent/skills/` | `PI_CODING_AGENT_DIR` |

No path is hardcoded — each default is overridable by that agent's own variable, which
is also how the tests point at a sandbox. An agent that isn't installed is skipped by
`link` and reported by `doctor` rather than getting a directory invented for it.

`AGENT_SKILLS_DIR` collapses the target set to a single directory (tests).
`AGENT_SKILLS_TARGETS=claude,pi` restricts it by id.

## Subcommands

```sh
./install.sh                       # all three steps; the new-machine entry point

./scripts/install.mjs check        # report state, change nothing
./scripts/install.mjs link         # symlink origin:dotfiles skills; repair stale links
./scripts/install.mjs skills-cli   # restore missing skills-cli skills from the lockfile
./scripts/install.mjs doctor       # verify every declared skill resolves; non-zero on drift
```

`check` is the safe read-only inspection — it lists each dotfiles skill's actual
state (`ok`, `missing`, `dir`, `foreign-link`) without touching anything.

Tests: `node --test "scripts/*.test.mjs"` (18 cases, no fixtures outside a tmpdir).

## `code-review` shadows `mattpocock/skills`

This repo ships its own `code-review` — a three-axis review (Standards / Spec / Perf)
whose Perf axis delegates to `skills/code-review/references/perf-systems.md`, a
five-axis systems pass (triage hot-vs-cold, then memory / layout / cpu / gpu / io).

It has **the same name** as the `code-review` inside `mattpocock/skills`, and that has
two consequences you must know about:

1. **`npx skills update -g` will revert it.** The CLI owns that package and will
   re-install its own `code-review` as a real directory over this repo's symlink.
   After any CLI update, remove the clobbered directory and re-run `./install.sh`.
   (`ln -snf` will not replace a non-empty directory, so `link` refuses rather than
   pretending it worked.)

2. **`./install.sh` may refuse the whole mattpocock package.** `npx skills add` is
   all-or-nothing per repo: it installs every skill in a package. Since that package
   ships a `code-review` this repo owns, restoring *any* mattpocock skill would
   overwrite it. So `skills-cli` detects the collision and refuses the entire source
   instead of racing it — then `install.sh` continues to `doctor`.

   That refusal is **deliberate, not a bug**. To resolve it by hand:

   ```sh
   npx skills add mattpocock/skills -g -y      # installs its own code-review
   rm -rf ~/.agents/skills/code-review         # remove the shadowing copy
   ./install.sh                                # re-link this repo's version
   ```

   Renaming that skill here would remove the refusal entirely.

`STACK.md` records the shadow explicitly, so the conflict is discoverable from the
manifest rather than only from a failure.

## Layout

```
STACK.md              # source of truth: every skill, its origin, what's excluded
install.sh            # one entry point for a new machine
scripts/install.mjs   # link | skills-cli | check | doctor
scripts/install.test.mjs
skills/<name>/        # the skills this repo owns (origin: dotfiles)
```
