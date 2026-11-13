#!/usr/bin/env node
// ystack installer. See STACK.md — that file is the source of truth, this reads it.
//
// Standalone: everything this needs lives in this repo (STACK.md + skills/) plus
// the skills-CLI lockfile under ~/.agents. Nothing is read from outside the repo.
//
// Subcommands:
//   link       symlink origin:dotfiles skills into ~/.agents/skills
//   skills-cli re-add tracked skills-cli skills missing from ~/.agents/skills
//   check      report state, mutate nothing
//   doctor     verify every declared skill resolves; non-zero exit on drift
//
// AGENT_SKILLS_DIR overrides the target (tests use a tmpdir).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ -> repo root
const ROOT = resolve(HERE, "..");
const MANIFEST = join(ROOT, "STACK.md");
const SKILLS = join(ROOT, "skills");
// Where the `skills` CLI writes its manifest. Not a file in this repo.
const LOCK = join(homedir(), ".agents", ".skill-lock.json");

/**
 * Parse the title of every `## ` section in STACK.md, returning
 * { dotfiles: string[], cliInstaller: string[], excluded: string[] }.
 *
 * Manifest format (cold path, runs once per invocation):
 *   ## `origin: dotfiles`        -> a table, first column is the skill name
 *   ## `origin: cli-installer`   -> a table, first column is the skill name
 *   ## `excluded`               -> bullets; names live inside backticks
 *
 * Pure: string in, plain object out. Deliberately not a YAML/TOML dependency —
 * STACK.md must stay readable as documentation and as data.
 */
export function parseManifest(md) {
  const out = { dotfiles: [], parked: [], cliInstaller: [], excluded: [] };
  let section = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      // Unescape the backticks the heading uses for prose styling.
      const title = h[1].replace(/`/g, "");
      section = title.startsWith("origin: dotfiles")
        ? "dotfiles"
        : title.startsWith("origin: cli-installer")
          ? "cliInstaller"
          : title.startsWith("parked")
            ? "parked"
            : title.startsWith("excluded")
              ? "excluded"
              : null;
      continue;
    }
    if (!section) continue;
    if (section === "excluded" || section === "parked") {
      // Bullets only; skip prose. Names are backticked.
      if (!/^\s*-\s/.test(line)) continue;
      for (const m of line.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)) out[section].push(m[1]);
      continue;
    }
    // Table row: `| `name` | purpose |` — first cell, skip the header/divider.
    const cells = /^\|\s*(.+?)\s*\|/.exec(line);
    if (!cells) continue;
    const m = /^`([a-z0-9][a-z0-9-]*)`$/.exec(cells[1].trim());
    if (m) out[section].push(m[1]);
  }
  return out;
}

/** Skill names tracked in the skills-CLI lockfile. */
export function parseLock(lock) {
  return Object.keys(lock?.skills ?? {}).sort();
}

/**
 * Decide which `skills` CLI sources to install, and which to refuse.
 *
 * Restoring is all-or-nothing per source: `npx skills add <repo>` installs every
 * skill in that repo. So a source is only safe when none of the names it ships
 * are owned by ystack — otherwise the CLI writes a real directory over the
 * ystack symlink (this clobbered `code-review` once already).
 *
 * Pure: { owned, installed, lock } -> { sources, blocked }.
 */
export function planSkillsCli({ owned, installed, lock }) {
  const present = new Set(installed);
  const ownedSet = new Set(owned);
  const missing = Object.entries(lock?.skills ?? {}).filter(([name, s]) => !present.has(name) && s?.source);

  // source -> every skill name it ships, from the lockfile.
  const bySource = new Map();
  for (const [name, s] of Object.entries(lock?.skills ?? {})) {
    if (!s?.source) continue;
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source).push(name);
  }

  const need = new Set(missing.map(([, s]) => s.source));
  const sources = [];
  const blocked = [];
  for (const src of need) {
    const collides = (bySource.get(src) ?? []).filter((n) => ownedSet.has(n)).sort();
    if (collides.length) blocked.push({ source: src, collides });
    else sources.push(src);
  }
  return { sources, blocked };
}

// ---------------------------------------------------------------------------

function readManifest() {
  if (!existsSync(MANIFEST)) {
    console.error(`missing manifest: ${MANIFEST}`);
    process.exit(1);
  }
  return parseManifest(readFileSync(MANIFEST, "utf-8"));
}

function skillsDir() {
  return process.env.AGENT_SKILLS_DIR ?? join(homedir(), ".agents", "skills");
}

function inspect(name) {
  const link = join(skillsDir(), name);
  const src = join(SKILLS, name);
  let st;
  try {
    st = lstatSync(link);
  } catch {
    return { name, link, src, kind: "missing" };
  }
  if (st.isSymbolicLink()) {
    const dest = resolve(dirname(link), readlinkSync(link));
    return { name, link, src, kind: dest === src ? "ok" : "foreign-link", dest };
  }
  return { name, link, src, kind: "dir" };
}

const C = process.stdout.isTTY
  ? { ok: "\x1b[32m", warn: "\x1b[33m", bad: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" }
  : { ok: "", warn: "", bad: "", dim: "", off: "" };

/**
 * Resolve a tool-owned (cli-installer) skill. Unlike `inspect`, the target is NOT
 * expected to be `skills/<name>` — it lives in the tool's own cache.
 *
 * Returns kind:
 *   ok        — a directory or a symlink resolving to a real skill dir
 *   dangling  — the link exists but its target is gone (tool moved its cache)
 *   absent    — nothing at the path; the tool was never run here
 *
 * The dangling case is why this exists: doctor must fail on it, because a dangling
 * link is indistinguishable from a missing skill at load time, yet `existsSync` on
 * a directory that merely *contains* such links says everything is fine.
 */
export function inspectOwned(name, dir = skillsDir()) {
  const link = join(dir, name);
  let st;
  try {
    st = lstatSync(link);
  } catch {
    return { name, link, kind: "absent" };
  }
  // Follows the link. A missing target throws or yields false.
  const target = st.isSymbolicLink() ? readlinkSync(link) : null;
  const resolved = existsSync(link);
  if (!resolved) return { name, link, kind: "dangling", target };
  const hasSkill = existsSync(join(resolvedPath(link), "SKILL.md"));
  return { name, link, kind: hasSkill ? "ok" : "no-skill-md", target, resolved: resolvedPath(link) };
}

function resolvedPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(dirname(p), "");
  }
}

function cmdCheck({ quiet = false } = {}) {
  const m = readManifest();
  const rows = m.dotfiles.map(inspect);
  let drift = 0;
  if (!quiet) console.log(`ystack @ ${ROOT}\n`);
  for (const r of rows) {
    const bad = r.kind !== "ok";
    if (bad) drift++;
    if (quiet && !bad) continue;
    const col = r.kind === "ok" ? C.ok : C.warn;
    console.log(`  ${col}${r.kind.padEnd(12)}${C.off} ${r.name}${bad ? `  ${C.dim}${r.link}${C.off}` : ""}`);
  }
  for (const name of m.cliInstaller) {
    const r = inspectOwned(name);
    if (quiet && r.kind === "ok") continue;
    const present = r.kind !== "absent";
    const col = r.kind === "ok" || r.kind === "absent" ? (present ? C.ok : C.dim) : C.bad;
    const label = r.kind === "absent" ? "absent" : r.kind;
    // A declared skill that is absent is drift too, same as an unlinked one.
    if (r.kind !== "ok") drift++;
    console.log(
      `  ${col}${label.padEnd(12)}${C.off} ${name} ${C.dim}(cli-installer — restored by its own tool)${C.off}`,
    );
  }
  if (!quiet) console.log(`\n  ${rows.length} dotfiles · ${m.cliInstaller.length} cli-installer · ${m.parked.length} parked · ${m.excluded.length} excluded names`);
  return drift;
}

function cmdLink() {
  const m = readManifest();
  mkdirSync(skillsDir(), { recursive: true });
  let linked = 0;
  let skipped = 0;
  for (const name of m.dotfiles) {
    const r = inspect(name);
    if (!existsSync(r.src)) {
      console.error(`  ${C.bad}MISSING SRC${C.off} ${name} — declared in STACK.md but ${r.src} does not exist`);
      process.exitCode = 1;
      continue;
    }
    if (r.kind === "dir") {
      // The skills CLI or a manual install owns this real directory. Do not
      // clobber it — that loses whatever the other tool put there.
      console.log(`  ${C.warn}SKIP${C.off}   ${name} — real directory exists (remove it to let ystack own this name)`);
      skipped++;
      continue;
    }
    if (r.kind === "foreign-link") {
      // Stale link from an earlier layout. Never do this to a real directory.
      unlinkSync(r.link);
    }
    if (r.kind !== "ok") {
      symlinkSync(r.src, r.link, "dir");
      console.log(`  ${C.ok}LINKED${C.off} ${name}`);
      linked++;
      continue;
    }
    linked++;
  }
  if (skipped) console.error(`\n  ${C.warn}${skipped} skill(s) skipped${C.off} — another tool owns the directory`);
  else console.log(`\n  ${linked} linked`);
  return 0;
}

function cmdSkillsCli() {
  if (!existsSync(LOCK)) {
    console.error(`missing lockfile: ${LOCK}`);
    return 1;
  }
  const lock = JSON.parse(readFileSync(LOCK, "utf-8"));
  const { dotfiles } = readManifest();
  const installed = existsSync(skillsDir()) ? readdirSync(skillsDir()) : [];
  const { sources, blocked } = planSkillsCli({ owned: dotfiles, installed, lock });

  for (const b of blocked) {
    console.error(
      `  ${C.bad}REFUSED${C.off} ${b.source} — its package also ships ${b.collides.join(", ")}, which ystack owns`,
    );
    console.error(`          installing it would overwrite the ystack symlink. Install that source by hand, then re-link.`);
  }
  if (sources.length === 0 && blocked.length === 0) {
    console.log("  all skills-CLI skills present");
    return 0;
  }
  for (const src of sources) {
    console.log(`  adding ${src}`);
    execFileSync("npx", ["-y", "skills@1.5.7", "add", src, "-g", "-y"], { stdio: "inherit" });
  }
  return blocked.length ? 1 : 0;
}

function cmdDoctor() {
  const m = readManifest();
  const problems = [];
  for (const name of m.dotfiles) {
    const r = inspect(name);
    if (!existsSync(r.src)) problems.push(`${name}: source missing at ${r.src}`);
    else if (r.kind === "dir") problems.push(`${name}: real directory shadows ystack (run: rm -rf ${r.link})`);
    else if (r.kind === "missing") problems.push(`${name}: not linked (run: install.mjs link)`);
    else if (r.kind === "foreign-link") problems.push(`${name}: links to ${r.dest}, not the stack`);
  }
  // cli-installer skills are tool-owned, so ystack cannot restore them itself —
  // it only reports. A dangling link is loud because it fails silently at load.
  for (const name of m.cliInstaller) {
    const r = inspectOwned(name);
    if (r.kind === "ok") continue;
    if (r.kind === "dangling") problems.push(`${name}: dangling link -> ${r.target} (the tool moved its cache; re-run its regenerate step)`);
    else if (r.kind === "no-skill-md") problems.push(`${name}: ${r.resolved} has no SKILL.md`);
    else if (r.kind === "absent") problems.push(`${name}: not installed (declared in STACK.md; see its Install step)`);
  }
  if (problems.length === 0) {
    console.log(
      `  ${C.ok}ok${C.off} — ${m.dotfiles.length} dotfiles + ${m.cliInstaller.length} cli-installer skills resolve, ${m.parked.length} parked, ${m.excluded.length} excluded`,
    );
    return 0;
  }
  for (const p of problems) console.error(`  ${C.bad}drift${C.off} ${p}`);
  return 1;
}

// ---------------------------------------------------------------------------

// Only run the CLI when executed directly, so tests can import the parsers.
// realpath both sides: a symlinked parent (/tmp -> /private/tmp on macOS) would
// otherwise compare unequal and silently no-op the whole command.
const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const [, , cmd = "check"] = process.argv;
  switch (cmd) {
    case "link":
      process.exit(cmdLink());
    case "skills-cli":
      process.exit(cmdSkillsCli());
    case "check":
      process.exit(cmdCheck() ? 1 : 0);
    case "doctor":
      process.exit(cmdDoctor());
    default:
      console.error(`unknown subcommand: ${cmd}\n  link | skills-cli | check | doctor`);
      process.exit(2);
  }
}
