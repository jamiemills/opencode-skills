// Hermetic tests for the lock-free per-entry temp registry
// (scripts/lib/temp-registry.mjs). Every fixture is a throwaway git repo /
// temp dir under os.tmpdir(); XDG_STATE_HOME is redirected so the non-git
// fallback can never touch the real ~/.local/state. Concurrency is exercised
// with real child processes and a start barrier; no network.

"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";
import {
  entryId,
  list as listRegistry,
  load as loadRegistry,
  register,
  registryDir,
  registryPath,
  unregister,
} from "../scripts/lib/temp-registry.mjs";

const MODULE_URL = new URL("../scripts/lib/temp-registry.mjs", import.meta.url).href;

// Isolate the XDG fallback for this whole file (and every child it spawns).
const XDG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "temp-registry-xdg-"));
process.env.XDG_STATE_HOME = XDG_ROOT;
test.after(() => fs.rmSync(XDG_ROOT, { recursive: true, force: true }));

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "temp-registry-test",
  GIT_AUTHOR_EMAIL: "temp-registry-test@example.invalid",
  GIT_COMMITTER_NAME: "temp-registry-test",
  GIT_COMMITTER_EMAIL: "temp-registry-test@example.invalid",
};

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "temp-registry-repo-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "t@test"]);
  git(root, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed");
  git(root, ["add", "seed.txt"]);
  git(root, ["commit", "-m", "seed"]);
  return root;
}

function jsonFiles(root) {
  return fs.readdirSync(registryDir(root)).filter((name) => name.endsWith(".json"));
}

// A tiny worker that imports the module under test by absolute file URL. A
// shared future start timestamp makes every child begin its operation at the
// same instant (a real contention spike, not a staggered queue).
function writeWorker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "temp-registry-worker-"));
  const file = path.join(dir, "worker.mjs");
  fs.writeFileSync(
    file,
    `import { register, unregister } from ${JSON.stringify(MODULE_URL)};
const [mode, root, target, startAtRaw] = process.argv.slice(2);
const startAt = Number(startAtRaw);
if (Number.isFinite(startAt) && startAt > 0) {
  while (Date.now() < startAt) {
    // busy-wait for the shared barrier
  }
}
if (mode === "register") {
  register({ kind: "tempdir", path: target, runId: \`child-\${process.pid}\` }, root);
} else if (mode === "unregister") {
  unregister(target, root);
} else {
  throw new Error(\`unknown worker mode: \${mode}\`);
}
`,
    "utf8",
  );
  return { dir, file };
}

function runWorker(workerFile, args) {
  const env = { ...GIT_ENV, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerFile, ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited ${code}: ${stderr}`));
    });
  });
}

test("register dedupes by resolved path and unregister is idempotent", () => {
  const root = makeRepo();
  try {
    const target = path.join(root, "a");
    register({ kind: "tempdir", path: target }, root);
    register({ kind: "tempdir", path: target, runId: "r2" }, root);
    const entries = listRegistry(root);
    assert.equal(entries.length, 1, "re-registering a path updates one entry in place");
    assert.equal(entries[0].runId, "r2");
    assert.ok(entries[0].ts.endsWith("Z"), "ts is UTC");
    assert.deepEqual(jsonFiles(root), [`${entryId(target)}.json`], "one full-digest entry file");

    assert.equal(unregister(target, root), true);
    assert.equal(unregister(target, root), false, "unregister is idempotent");
    assert.deepEqual(loadRegistry(root), []);
    assert.deepEqual(jsonFiles(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("malformed files are skipped and path/id mismatches are quarantined", () => {
  const root = makeRepo();
  try {
    const good = path.join(root, "good");
    register({ kind: "tempdir", path: good }, root);
    const dir = registryDir(root);

    // A correctly-named entry file whose contents are not JSON.
    fs.writeFileSync(path.join(dir, `${entryId(path.join(root, "bad"))}.json`), "{ not json");
    // A well-formed entry whose embedded path does not hash to its file id.
    const impostor = {
      kind: "tempdir",
      path: path.join(root, "other"),
      runId: "x",
      ts: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, `${"0".repeat(64)}.json`), JSON.stringify(impostor));
    // Neither temp writes nor the sentinel are entries.
    fs.writeFileSync(path.join(dir, "leftover.tmp"), "garbage");
    fs.writeFileSync(path.join(dir, ".migrated"), JSON.stringify({ ts: new Date().toISOString() }));

    const entries = listRegistry(root);
    assert.equal(entries.length, 1, "only the valid, correctly-named entry survives");
    assert.equal(entries[0].path, good);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy registry migrates once and never resurrects unregistered entries", () => {
  const root = makeRepo();
  try {
    const legacyPath = registryPath(root);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    const legacy = [
      {
        kind: "tempdir",
        path: path.join(root, "legacy-a"),
        runId: "old",
        ts: "2020-01-01T00:00:00.000Z",
      },
      {
        kind: "worktree",
        path: path.join(root, "legacy-b"),
        branch: "wt/b",
        runId: "old",
        ts: "2020-01-01T00:00:00.000Z",
      },
    ];
    fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2));

    assert.equal(listRegistry(root).length, 2, "legacy entries migrated");
    assert.ok(
      fs.existsSync(path.join(registryDir(root), ".migrated")),
      "one-time sentinel created",
    );

    assert.equal(unregister(path.join(root, "legacy-a"), root), true);
    const after = listRegistry(root);
    assert.equal(after.length, 1, "unregister took effect");
    assert.equal(after[0].path, path.join(root, "legacy-b"));

    // A second load must not re-run migration / resurrect the removed entry.
    assert.equal(listRegistry(root).length, 1, "migration never runs twice");
    assert.ok(fs.existsSync(legacyPath), "legacy file is left in place (never deleted)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("N concurrent processes register N distinct paths with none lost", async () => {
  const root = makeRepo();
  const worker = writeWorker();
  try {
    const n = 16;
    const targets = Array.from({ length: n }, (_, i) => path.join(root, `concurrent-${i}`));
    const startAt = Date.now() + 600;
    await Promise.all(
      targets.map((target) => runWorker(worker.file, ["register", root, target, String(startAt)])),
    );
    const entries = listRegistry(root);
    assert.equal(entries.length, n, "all N concurrent registrations present");
    assert.deepEqual(
      entries.map((e) => e.path).toSorted(),
      targets.toSorted(),
      "exactly the N distinct paths",
    );
  } finally {
    fs.rmSync(worker.dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("N concurrent unregisters remove exactly their paths, leaving the remainder", async () => {
  const root = makeRepo();
  const worker = writeWorker();
  try {
    const n = 14;
    const removed = Array.from({ length: n }, (_, i) => path.join(root, `rm-${i}`));
    const kept = Array.from({ length: n }, (_, i) => path.join(root, `keep-${i}`));
    for (const target of [...removed, ...kept]) register({ kind: "tempdir", path: target }, root);
    assert.equal(listRegistry(root).length, 2 * n, "all paths pre-registered");

    const startAt = Date.now() + 600;
    await Promise.all(
      removed.map((target) =>
        runWorker(worker.file, ["unregister", root, target, String(startAt)]),
      ),
    );
    assert.deepEqual(
      listRegistry(root)
        .map((e) => e.path)
        .toSorted(),
      kept.toSorted(),
      "exactly the remainder survives",
    );
  } finally {
    fs.rmSync(worker.dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("same-path register/unregister race never produces a torn JSON entry", async () => {
  const root = makeRepo();
  const worker = writeWorker();
  try {
    const target = path.join(root, "contended");
    for (let round = 0; round < 3; round += 1) {
      const startAt = Date.now() + 300;
      const jobs = [];
      for (let i = 0; i < 8; i += 1) {
        jobs.push(runWorker(worker.file, ["register", root, target, String(startAt)]));
        jobs.push(runWorker(worker.file, ["unregister", root, target, String(startAt)]));
      }
      await Promise.all(jobs);

      const dir = registryDir(root);
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const raw = fs.readFileSync(path.join(dir, name), "utf8");
        assert.ok(raw.trim().length > 0, `empty entry file: ${name}`);
        assert.doesNotThrow(() => JSON.parse(raw), `torn entry file: ${name}`);
      }
      const entries = listRegistry(root);
      assert.ok(entries.length <= 1, "at most one deduped entry");
      if (entries.length === 1) assert.equal(entries[0].path, target);
    }
  } finally {
    fs.rmSync(worker.dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
