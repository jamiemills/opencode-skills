// T003 (PART B): idempotent install contract for the opencode continuation
// plugin. Proves --dry-run writes nothing, --apply installs the full dependency
// set, a second --apply is a byte-identical no-op, and the installed wrapper
// still resolves its relative import to the installed core.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  DEFAULT_SOURCE,
  DEFAULT_TARGET,
  PLUGIN_FILES,
  applyInstall,
  planInstall,
} from "../../scripts/install-opencode-plugin.mjs";

const cliPath = path.join(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "install-opencode-plugin.mjs",
);

const CORE_FIXTURE = `export function decideContinuation({ guard, budget = {}, env = {} } = {}) {
  if (env.CSM_CONTINUE_KILL) return { action: "stop", reason: "kill-switch", command: null };
  if (guard?.exitCode === 0) return { action: "stop", reason: "no-work-remaining", command: null };
  if (guard?.exitCode !== 2) return { action: "stop", reason: "guard-unrecognized", command: null };
  if (Number.isFinite(budget.maxContinues) && (budget.continues ?? 0) >= budget.maxContinues)
    return { action: "stop", reason: "budget-exhausted", command: null };
  return { action: "continue", reason: "work-remaining", command: "node csm-build/lib/loop-guard.mjs" };
}
export const FIXTURE_MARKER = "installed-copy-ok";
`;

const WRAPPER_FIXTURE = `import { FIXTURE_MARKER, decideContinuation } from "./csm-continue-core.mjs";

export const CsmContinuePlugin = async ({ client }) => {
  const budget = { continues: 0, maxContinues: 1 };
  return {
    marker: FIXTURE_MARKER,
    event: async ({ event }) => {
      if (event?.type !== "session.idle") return;
      const sessionID = event?.properties?.sessionID;
      if (!sessionID) return;
      const decision = decideContinuation({ guard: { exitCode: 2 }, budget, env: {} });
      if (decision.action !== "continue") return;
      budget.continues += 1;
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: decision.command }] },
      });
    },
  };
};

export default CsmContinuePlugin;
`;

function makeFixtureSource() {
  const source = mkdtempSync(path.join(os.tmpdir(), "csm-plugin-src-"));
  writeFileSync(path.join(source, "csm-continue.js"), WRAPPER_FIXTURE);
  writeFileSync(path.join(source, "csm-continue-core.mjs"), CORE_FIXTURE);
  return source;
}

function runInstaller(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("exports the full dependency set and defaults to the opencode plugins dir", () => {
  assert.deepEqual([...PLUGIN_FILES], ["csm-continue.js", "csm-continue-core.mjs"]);
  assert.equal(DEFAULT_TARGET, path.join(os.homedir(), ".config", "opencode", "plugins"));
});

test("the real plugin source resolves to exactly the dependency set", async () => {
  const plan = await planInstall({ source: DEFAULT_SOURCE, target: DEFAULT_TARGET });
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(
    plan.files.map((file) => file.name),
    [...PLUGIN_FILES],
  );
  for (const file of plan.files) {
    const expected = createHash("sha256").update(readFileSync(file.source)).digest("hex");
    assert.equal(file.sourceHash, expected, `${file.name} source hash must be real`);
  }
});

test("--dry-run prints a plan and writes nothing", () => {
  const source = makeFixtureSource();
  const target = path.join(mkdtempSync(path.join(os.tmpdir(), "csm-plugin-dry-")), "plugins");
  try {
    const result = runInstaller("--source", source, "--target", target, "--dry-run");
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.dryRun, true);
    assert.equal(summary.action, "install");
    assert.equal(summary.installed, 0);
    assert.equal(summary.changed, 2);
    assert.equal(summary.missing.length, 0);
    assert.deepEqual(
      summary.files.map((file) => file.name),
      [...PLUGIN_FILES],
    );
    assert.ok(!existsSync(target), "dry-run must not create the target directory");
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(path.dirname(target), { recursive: true, force: true });
  }
});

test("--apply installs both files, then a second --apply is a byte-identical no-op", () => {
  const source = makeFixtureSource();
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "csm-plugin-apply-"));
  const target = path.join(targetDir, "plugins");
  try {
    const first = runInstaller("--source", source, "--target", target, "--apply");
    assert.equal(first.status, 0, first.stderr);
    const firstSummary = JSON.parse(first.stdout);
    assert.equal(firstSummary.dryRun, false);
    assert.equal(firstSummary.installed, 2);
    assert.equal(firstSummary.unchanged, 0);
    for (const name of PLUGIN_FILES) {
      assert.ok(existsSync(path.join(target, name)), `${name} must be installed`);
    }
    assert.equal(readFileSync(path.join(target, "csm-continue.js"), "utf8"), WRAPPER_FIXTURE);
    assert.equal(readFileSync(path.join(target, "csm-continue-core.mjs"), "utf8"), CORE_FIXTURE);
    const before = PLUGIN_FILES.map((name) => readFileSync(path.join(target, name)));

    const second = runInstaller("--source", source, "--target", target, "--apply");
    assert.equal(second.status, 0, second.stderr);
    const secondSummary = JSON.parse(second.stdout);
    assert.equal(secondSummary.installed, 0);
    assert.equal(secondSummary.unchanged, 2);
    assert.equal(secondSummary.action, "noop");
    const after = PLUGIN_FILES.map((name) => readFileSync(path.join(target, name)));
    assert.deepEqual(after, before, "second --apply must leave the target byte-identical");
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("installed wrapper resolves its relative import and injects one bounded prompt", async () => {
  const source = makeFixtureSource();
  const targetDir = mkdtempSync(path.join(os.tmpdir(), "csm-plugin-import-"));
  const target = path.join(targetDir, "plugins");
  try {
    const plan = await planInstall({ source, target });
    await applyInstall(plan);
    const installed = await import(pathToFileURL(path.join(target, "csm-continue.js")).href);
    const prompts = [];
    const client = {
      session: {
        prompt: async (args) => {
          prompts.push(args);
          return { data: {} };
        },
      },
    };
    const hooks = await installed.CsmContinuePlugin({ client });
    assert.equal(hooks.marker, "installed-copy-ok", "relative import must load installed core");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].path.id, "ses-1");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } });
    assert.equal(prompts.length, 1, "the continuation budget bounds prompts");
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});
