// Post-publication registry replay runner (DEF-RELEASE evidence).
//
// Modes:
//   --fixture    Self-test: warm a file: tarball pack, npm cache verify, replay
//                the same file: args, and diff the installed trees. This proves
//                the mechanics ONLY — it is never registry-replay evidence.
//   --registry   Post-publish evidence mode: warm and replay both use the exact
//                literal registry spec (grammar.package.spec) in a dead-registry
//                sandbox. Requires the package to be published; fails closed
//                otherwise (by design — a file: substitution is forbidden by
//                bootstrap/release-checklist.md).
//
// Usage:
//   node scripts/replay-registry.mjs --fixture
//   node scripts/replay-registry.mjs --registry   (post-publication only)
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import {
  checkArgv,
  checkSpec,
  grammar,
  hashTree,
  makeSandbox,
  runNpx,
} from "../tests/offline/commands.mjs";
import { packBootstrap } from "./pack-bootstrap.mjs";

const execFileAsync = promisify(execFile);
const mode = process.argv[2];

const contentTree = (sandbox) =>
  hashTree(sandbox.cache).then((entries) => entries.filter(([rel]) => rel.startsWith("_npx/")));

async function cacheVerify(sandbox, transcripts) {
  const verify = await execFileAsync("npm", ["cache", "verify"], {
    cwd: sandbox.cwd,
    encoding: "utf8",
    env: sandbox.env,
    timeout: 120000,
  });
  transcripts.push({ step: "npm cache verify", exit: 0, stdout: verify.stdout });
  return verify;
}

async function runFixtureMode() {
  const pack = await packBootstrap();
  const sandbox = await makeSandbox();
  const transcripts = [];
  try {
    const warmArgs = [
      ...grammar.onlineFlags,
      ...grammar.requiredFlags,
      `--package=file:${pack.tarball}`,
      grammar.package.bin,
      "--version",
    ];
    // Fixture mode intentionally bypasses checkArgv: a file: spec can never be
    // registry-replay evidence (grammar rejects it; release-checklist.md forbids
    // substituting it). This mode only proves the mechanics.
    const warm = await runNpx(sandbox, warmArgs);
    assert.equal(warm.stdout.trim(), "0.1.0");
    transcripts.push({ step: "warm (file:)", argv: warmArgs, stdout: warm.stdout.trim() });
    const warmTree = await contentTree(sandbox);
    assert.ok(warmTree.length >= 100, "installed package tree hash input is non-trivial");
    await cacheVerify(sandbox, transcripts);
    const replay = await runNpx(sandbox, [...grammar.offlineFlags, ...warmArgs]);
    assert.equal(replay.stdout.trim(), "0.1.0");
    transcripts.push({
      step: "replay (file:)",
      argv: [...grammar.offlineFlags, ...warmArgs],
      stdout: replay.stdout.trim(),
    });
    const replayTree = await contentTree(sandbox);
    assert.deepEqual(replayTree, warmTree);
    console.log("FIXTURE SELF-TEST: PASS — hash-tree-identical replay (not registry evidence)");
    console.log(JSON.stringify(transcripts, null, 1));
    return 0;
  } finally {
    await rm(sandbox.dir, { recursive: true, force: true });
  }
}

async function runRegistryMode() {
  const spec = grammar.package.spec;
  const specCheck = checkSpec(spec);
  assert.equal(specCheck.ok, true, "registry spec must satisfy the offline grammar");
  const warmArgs = [
    ...grammar.onlineFlags,
    ...grammar.requiredFlags,
    `--package=${spec}`,
    grammar.package.bin,
    "--version",
  ];
  const replayArgs = [...grammar.offlineFlags, ...warmArgs];
  const warmArgvCheck = checkArgv(warmArgs);
  assert.equal(warmArgvCheck.ok, true, JSON.stringify(warmArgvCheck));
  const replayArgvCheck = checkArgv(replayArgs, { offline: true });
  assert.equal(replayArgvCheck.ok, true, JSON.stringify(replayArgvCheck));
  const sandbox = await makeSandbox();
  const transcripts = [];
  try {
    let warm;
    let failClosed = null;
    try {
      warm = await runNpx(sandbox, warmArgs);
    } catch (error) {
      failClosed = String(error?.message ?? error).slice(0, 300);
    }
    if (failClosed) {
      await rm(sandbox.dir, { recursive: true, force: true });
      console.error(
        "REGISTRY REPLAY: FAIL-CLOSED (expected before publication) —",
        JSON.stringify({ stage: "warm", spec, reason: failClosed }),
      );
      process.exit(1);
    }
    assert.equal(warm.stdout.trim(), "0.1.0");
    transcripts.push({ step: "warm (registry)", argv: warmArgs, stdout: warm.stdout.trim() });
    const warmTree = await contentTree(sandbox);
    assert.ok(warmTree.length >= 100, "installed package tree hash input is non-trivial");
    await cacheVerify(sandbox, transcripts);
    const replay = await runNpx(sandbox, replayArgs);
    assert.equal(replay.stdout.trim(), "0.1.0");
    transcripts.push({ step: "replay (registry)", argv: replayArgs, stdout: replay.stdout.trim() });
    const replayTree = await contentTree(sandbox);
    assert.deepEqual(replayTree, warmTree);
    console.log("REGISTRY REPLAY: PASS — hash-tree-identical against the registry spec");
    console.log(JSON.stringify(transcripts, null, 1));
    return 0;
  } finally {
    await rm(sandbox.dir, { recursive: true, force: true });
  }
}

switch (mode) {
  case "--fixture":
    process.exit(await runFixtureMode());
    break;
  case "--registry":
    process.exit(await runRegistryMode());
    break;
  default:
    console.error("usage: replay-registry.mjs --fixture | --registry");
    process.exit(1);
}
