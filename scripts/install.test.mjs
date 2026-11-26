#!/usr/bin/env node
// Run: node --test "scripts/*.test.mjs"
// Exercises the pure parsers and the link/doctor behaviour against a tmp skills dir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync, readlinkSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseManifest, parseLock, planSkillsCli } from "./install.mjs";

const MANIFEST = join(import.meta.dirname, "..", "STACK.md");

test("parseManifest reads the real STACK.md", () => {
  const m = parseManifest(execFileSync("cat", [MANIFEST], { encoding: "utf-8" }));

  // dotfiles skills: every table row in the origin: dotfiles section.
  assert.deepEqual(m.dotfiles, [
    "pre-commit",
    "pre-push",
    "pr-catchup",
    "ship",
    "simplify",
    "code-review",
    "placement-review",
    "pr-dogfood",
    "flaky-ci",
  ]);

  // parked: kept on disk for reference but never linked.
  assert.deepEqual(m.parked, ["pf"]);
  // A parked skill must not also be linked, or parking does nothing.
  assert.ok(!m.dotfiles.includes("pf"), "pf must not be both parked and linked");

  // cli-installer: generated stubs, never copied.
  assert.deepEqual(m.cliInstaller, ["agent-browser", "rex", "skill-creator"]);

  // excluded: domain-stack skills, and no prose leaks in (e.g. words outside backticks).
  for (const n of ["bump-sdk", "dev-flow", "review-loop", "sdk-browser", "sdk-issue-report", "task-board"]) {
    assert.ok(m.excluded.includes(n), `${n} should be excluded`);
  }
  // A wrapped list must not silently drop names — that bug under-counted by 2.
  assert.equal(m.excluded.length, 6);
  assert.ok(!m.dotfiles.includes("agent-browser"), "cli-installer must not leak into dotfiles");
  assert.ok(!m.excluded.includes("the"), "only backticked names count as excluded");
  // This repo is public: the excluded section must not name the private repos,
  // orgs, or people those skills belong to.
  const manifestText = execFileSync("cat", [MANIFEST], { encoding: "utf-8" });
  for (const term of ["mappedin", "mpdin", "rally", "apollo"]) {
    assert.ok(!new RegExp(`\\b${term}\\b`, "i").test(manifestText), `${term} must not appear in STACK.md`);
  }
});

test("parseManifest ignores headings outside the three it knows", () => {
  const m = parseManifest(
    [
      "# title",
      "| `nope` | not under a section |",
      "## `origin: dotfiles`",
      "| Skill | Purpose |",
      "|---|---|",
      "| `alpha` | a |",
      "| `beta-x` | b |",
      "## `origin: skills-cli`",
      "| `gamma` | belongs to the CLI |",
      "## `excluded`",
      "prose mentioning `delta`",
      "- `epsilon`, `zeta` live elsewhere",
    ].join("\n"),
  );
  assert.deepEqual(m.dotfiles, ["alpha", "beta-x"]);
  assert.deepEqual(m.cliInstaller, []);
  // Bare prose line is not a bullet, so `delta` is ignored.
  assert.deepEqual(m.excluded, ["epsilon", "zeta"]);
});

test("parseLock sorts names and tolerates a missing skills map", () => {
  assert.deepEqual(parseLock({ skills: { b: {}, a: {} } }), ["a", "b"]);
  assert.deepEqual(parseLock({}), []);
});

// --- behaviour: link / doctor against an isolated skills dir -----------------

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "ystack-test-"));
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  // cli-installer skills are tool-owned and absent from a fresh sandbox, but
  // doctor checks them. Seed stand-ins so the drift under test is the one the
  // test is about, not "you never installed the tools".
  const seedOwned = () => {
    for (const name of ["agent-browser", "rex", "skill-creator"]) {
      const src = join(root, "owned", name);
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "SKILL.md"), name);
      symlinkSync(src, join(skills, name), "dir");
    }
  };
  const run = (cmd) =>
    execFileSync("node", [join(import.meta.dirname, "install.mjs"), cmd], {
      env: { ...process.env, AGENT_SKILLS_DIR: skills },
      encoding: "utf-8",
      stdio: "pipe",
    });
  return { root, skills, run, seedOwned, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("link creates one symlink per dotfiles skill, idempotently", () => {
  const s = sandbox();
  try {
    s.run("link");
    const linked = readdirSync(s.skills).sort();
    assert.deepEqual(linked, [
      "code-review",
      "flaky-ci",
      "placement-review",
      "pr-catchup",
      "pr-dogfood",
      "pre-commit",
      "pre-push",
      "ship",
      "simplify",
    ]);
    // Second run must not fail on existing links.
    assert.doesNotThrow(() => s.run("link"));
    assert.deepEqual(readdirSync(s.skills).sort(), linked);
  } finally {
    s.done();
  }
});

test("link refuses to clobber a real directory owned by another tool", () => {
  const s = sandbox();
  try {
    // Simulate the skills CLI having installed `code-review` as a real dir.
    mkdirSync(join(s.skills, "code-review"));
    writeFileSync(join(s.skills, "code-review", "SKILL.md"), "upstream");
    s.run("link");
    // ...the CLI's file survives, so `npx skills update -g` ownership is intact.
    assert.equal(readdirSync(join(s.skills, "code-review")).join(), "SKILL.md");
  } finally {
    s.done();
  }
});

test("doctor reports drift and passes when clean", () => {
  const s = sandbox();
  try {
    assert.throws(() => s.run("doctor"), /Command failed/);
    s.run("link");
    s.seedOwned();
    assert.doesNotThrow(() => s.run("doctor"));
  } finally {
    s.done();
  }
});

// The reason cli-installer skills are checked at all: their target lives in a
// tool's own cache, which moves on upgrade. `existsSync(skillsDir) === true` and
// the skill silently stops loading — doctor must be the thing that notices.
test("doctor flags a dangling cli-installer link", () => {
  const s = sandbox();
  try {
    s.run("link");
    s.seedOwned();
    assert.doesNotThrow(() => s.run("doctor"));

    // Plugin upgrade moves the cache dir out from under the link.
    rmSync(join(s.root, "owned", "skill-creator"), { recursive: true, force: true });
    try {
      s.run("doctor");
      assert.fail("doctor should have failed on a dangling link");
    } catch (e) {
      assert.match(String(e.stderr), /skill-creator: dangling link/);
    }
  } finally {
    s.done();
  }
});

test("doctor flags an absent cli-installer skill", () => {
  const s = sandbox();
  try {
    s.run("link");
    s.seedOwned();
    rmSync(join(s.skills, "rex"), { force: true });
    try {
      s.run("doctor");
      assert.fail("doctor should have failed");
    } catch (e) {
      assert.match(String(e.stderr), /rex: not installed/);
    }
  } finally {
    s.done();
  }
});

test("link repairs a stale symlink left by a previous layout", () => {
  const s = sandbox();
  try {
    // Simulate the pre-stack layout: same name, wrong destination.
    mkdirSync(join(s.root, "old", "pf"), { recursive: true });
    symlinkSync(join(s.root, "old", "pf"), join(s.skills, "pf"), "dir");
    s.run("link");
    s.seedOwned();
    assert.doesNotThrow(() => s.run("doctor"));
  } finally {
    s.done();
  }
});

test("doctor flags a link that points outside the stack", () => {
  const s = sandbox();
  try {
    s.run("link");
    const other = join(s.root, "impostor");
    mkdirSync(other);
    rmSync(join(s.skills, "flaky-ci"), { force: true });
    symlinkSync(other, join(s.skills, "flaky-ci"), "dir");
    try {
      s.run("doctor");
      assert.fail("doctor should have failed");
    } catch (e) {
      assert.match(String(e.stderr), /flaky-ci \[agents\]: links to .*impostor/);
    }
  } finally {
    s.done();
  }
});

// `check` had no coverage, which let a stale variable survive a refactor and crash
// on the very first real run. It is the safe read-only command, so it must always
// produce a report — before and after linking, and non-zero only when dirty.
test("check reports state without mutating anything", () => {
  const s = multiSandbox();
  try {
    assert.throws(() => s.run("check"), /Command failed/);
    // A dirty check must not have created any links.
    assert.deepEqual(readdirSync(s.skills.pi), []);

    s.run("link");
    s.seedOwned();
    const out = s.run("check");
    assert.match(out, /targets: agents, claude, pi/);
    assert.match(out, /ok\s+ship \[claude\]/);
  } finally {
    s.done();
  }
});

// --- multi-agent targets: ystack must link into every agent config home -------

// Sandbox with separate homes for each agent, so `targets()` resolves from the
// override vars rather than from this machine's real directories.
function multiSandbox({ only = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ystack-multi-"));
  const homes = { agents: join(root, "agents"), claude: join(root, "claude"), pi: join(root, "pi") };
  for (const h of Object.values(homes)) mkdirSync(h, { recursive: true });
  const skills = Object.fromEntries(Object.entries(homes).map(([k, h]) => [k, join(h, "skills")]));
  // `only` simulates an agent that is not installed: its skills dir never exists.
  for (const [k, d] of Object.entries(skills)) if (k !== only) mkdirSync(d, { recursive: true });
  const env = {
    ...process.env,
    AGENTS_HOME: homes.agents,
    CLAUDE_CONFIG_DIR: homes.claude,
    PI_CODING_AGENT_DIR: homes.pi,
    AGENT_SKILLS_DIR: "",
    AGENT_SKILLS_TARGETS: "",
  };
  const run = (cmd) =>
    execFileSync("node", [join(import.meta.dirname, "install.mjs"), cmd], { env, encoding: "utf-8", stdio: "pipe" });
  const seedOwned = () => {
    for (const name of ["agent-browser", "rex", "skill-creator"]) {
      const src = join(root, "owned", name);
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "SKILL.md"), name);
      symlinkSync(src, join(skills.agents, name), "dir");
    }
  };
  return { root, homes, skills, run, seedOwned, done: () => rmSync(root, { recursive: true, force: true }) };
}

// The reason this exists: pi loads ~/.agents/skills natively, but Claude Code
// only loads its own config dir, so a single-target link silently made ystack's
// skills invisible to one of the two agents.
test("link fans out to every agent config home", () => {
  const s = multiSandbox();
  try {
    s.run("link");
    const expected = [
      "code-review",
      "flaky-ci",
      "placement-review",
      "pr-catchup",
      "pr-dogfood",
      "pre-commit",
      "pre-push",
      "ship",
      "simplify",
    ];
    for (const [id, dir] of Object.entries(s.skills)) {
      assert.deepEqual(readdirSync(dir).sort(), expected, `${id} target missing links`);
    }
    // Each link resolves back to this repo's own skills/ dir.
    for (const id of Object.keys(s.skills)) {
      const link = join(s.skills[id], "ship");
      assert.equal(resolve(dirname(link), readlinkSync(link)), join(import.meta.dirname, "..", "skills", "ship"));
    }
    s.seedOwned();
    assert.doesNotThrow(() => s.run("doctor"));
  } finally {
    s.done();
  }
});

// An agent that is not installed must not be created by `link`, but doctor has to
// say so — otherwise a re-install of that agent silently leaves it skill-less.
test("link skips an absent agent, doctor reports it", () => {
  const s = multiSandbox({ only: "claude" });
  try {
    assert.ok(!existsSync(s.skills.claude), "precondition: claude not installed");
    s.run("link");
    assert.ok(!existsSync(s.skills.claude), "link must not create a home for an absent agent");
    assert.ok(existsSync(join(s.skills.pi, "ship")));

    s.seedOwned();
    try {
      s.run("doctor");
      assert.fail("doctor should flag the absent agent");
    } catch (e) {
      assert.match(String(e.stderr), /@claude: agent not installed/);
    }
  } finally {
    s.done();
  }
});

// One target holding a stale real directory must not stop the others updating.
test("a real directory in one target does not block the others", () => {
  const s = multiSandbox();
  try {
    mkdirSync(join(s.skills.claude, "ship"));
    writeFileSync(join(s.skills.claude, "ship", "SKILL.md"), "stale copy");
    s.run("link");
    // The stale copy is preserved...
    assert.equal(readFileSync(join(s.skills.claude, "ship", "SKILL.md"), "utf-8"), "stale copy");
    // ...and doctor calls it out by agent id, not just by name.
    s.seedOwned();
    try {
      s.run("doctor");
      assert.fail("doctor should flag the shadowing directory");
    } catch (e) {
      assert.match(String(e.stderr), /ship \[claude\]: real directory shadows ystack/);
    }
  } finally {
    s.done();
  }
});

// --- skills-cli: never install a package that would overwrite an owned name ---

test("planSkillsCli flags a source whose package contains an owned skill", () => {
  // `code-review` ships inside mattpocock/skills, so restoring any other skill
  // from that repo drags it in and clobbers the ystack copy. Regression: this
  // actually happened and replaced the symlink with a real directory.
  const plan = planSkillsCli({
    owned: ["code-review"],
    installed: ["grilling"],
    lock: {
      skills: {
        grilling: { source: "mattpocock/skills" },
        "code-review": { source: "mattpocock/skills" },
        tdd: { source: "mattpocock/skills" },
      },
    },
  });
  // `tdd` is missing from disk, but its package also ships the owned
  // `code-review`, so the whole source is refused rather than installed.
  assert.deepEqual(plan.sources, []);
  assert.deepEqual(plan.blocked, [{ source: "mattpocock/skills", collides: ["code-review"] }]);
});

test("planSkillsCli does nothing when every tracked skill is installed", () => {
  const plan = planSkillsCli({
    owned: ["code-review"],
    installed: ["tdd", "code-review"],
    lock: { skills: { tdd: { source: "mattpocock/skills" }, "code-review": { source: "mattpocock/skills" } } },
  });
  assert.deepEqual(plan.sources, []);
  assert.deepEqual(plan.blocked, []);
});

test("planSkillsCli ignores installed skills when deciding what is missing", () => {
  // A tracked skill that is present must not trigger a restore just because
  // its source also has absent siblings.
  const plan = planSkillsCli({
    owned: [],
    installed: ["a"],
    lock: { skills: { a: { source: "s/one" } } },
  });
  assert.deepEqual(plan.sources, []);
});
