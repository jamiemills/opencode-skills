import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { regenPlan, runRegen, verifyFresh } from "../scripts/regen.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function trackedRels() {
  const r = spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, "git ls-files failed");
  return new Set(r.stdout.split("\n").filter(Boolean));
}

function trackedDirs(tracked) {
  const dirs = new Set();
  for (const rel of tracked) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

// Copies the committed (tracked) file set into a git-less temp copy, so the
// idempotence run never touches this checkout's tree.
function cloneTracked(dest, tracked) {
  const dirs = trackedDirs(tracked);
  fs.cpSync(REPO, dest, {
    recursive: true,
    filter: (src) => {
      const rel = relative(REPO, src);
      if (rel === "") return true;
      const top = rel.split(sep)[0];
      if (top === ".git" || top === "node_modules") return false;
      const posix = rel.split(sep).join("/");
      return tracked.has(posix) || dirs.has(posix);
    },
  });
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// Content manifest of the regen-owned artifacts. Comparing manifests between
// runs is the git-visible-diff assertion for a git-less copy.
function snapshotGenerated(rootDir) {
  const paths = [
    join(rootDir, "csm-orchestrate", "capabilities.json"),
    join(rootDir, "bootstrap", "payload-index.json"),
    ...listFiles(join(rootDir, "bootstrap", "package")),
  ];
  return paths
    .map((p) => [relative(rootDir, p).split(sep).join("/"), sha256(fs.readFileSync(p))])
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

test("regenPlan returns the three regen steps in dependency order", () => {
  const plan = regenPlan(REPO);
  assert.deepEqual(
    plan.map((step) => step.id),
    ["fmt", "gen-capabilities", "pack-bootstrap"],
  );
  for (const step of plan) {
    assert.equal(typeof step.command, "string");
    assert.ok(Array.isArray(step.args) && step.args.length > 0);
  }
});

test("verifyFresh confirms the committed generated mirrors are current", async () => {
  const { ok, issues } = await verifyFresh({ root: REPO });
  assert.equal(ok, true, issues.join("; "));
});

test("regenerating twice in a temp copy leaves generated artifacts identical", async () => {
  const tracked = trackedRels();
  const sandbox = await mkdtemp(join(tmpdir(), "csm-regen-"));
  const copy = join(sandbox, "repo");
  // A generator-only plan: oxfmt's own idempotence is covered upstream, and
  // skipping the repo-wide format pass keeps the real run lightweight while
  // still exercising both write steps end-to-end. The full ordered plan
  // (including fmt) is asserted above.
  const generators = regenPlan(copy).filter((step) => step.id !== "fmt");
  try {
    cloneTracked(copy, tracked);
    await symlink(join(REPO, "node_modules"), join(copy, "node_modules"), "dir");

    runRegen({ root: copy, steps: generators, stdio: "pipe" });
    const first = snapshotGenerated(copy);
    assert.ok(first.length > 0, "temp copy produced no generated artifacts");

    runRegen({ root: copy, steps: generators, stdio: "pipe" });
    const second = snapshotGenerated(copy);

    assert.deepEqual(second, first, "a second regen changed the generated artifacts");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
