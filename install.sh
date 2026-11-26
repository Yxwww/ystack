#!/usr/bin/env bash
# ystack — the one entry point for a new machine.
#
#   1. link this repo's skills into every agent config home (~/.agents, ~/.claude, ~/.pi/agent)
#   2. restore skills-CLI skills tracked in ~/.agents/.skill-lock.json
#   3. doctor — verify every declared skill resolves in every installed target
#
# Runnable from anywhere; resolves its own directory.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$ROOT/scripts/install.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "ystack: node is required but was not found on PATH" >&2
  exit 1
fi

echo "==> ystack @ $ROOT"

echo
echo "==> 1/3 link skills into every agent config home"
node "$INSTALL" link

echo
echo "==> 2/3 restore skills-CLI skills"
# NOTE: this may refuse. `npx skills add` installs a whole package at once, and
# mattpocock/skills also ships a `code-review` — installing it would overwrite the
# symlink this repo owns. The installer refuses that source rather than clobbering
# it. That is deliberate, not a bug: install it by hand, remove its code-review
# directory, and re-run this script.
if ! node "$INSTALL" skills-cli; then
  echo "    skills-cli reported a refused source (see above) — continuing to doctor" >&2
fi

echo
echo "==> 3/3 doctor"
if node "$INSTALL" doctor; then
  echo
  echo "ystack: ok"
else
  echo
  echo "ystack: drift detected — see above" >&2
  exit 1
fi
