import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const PACK_CLI = path.join(REPO, "scripts/pack-bootstrap.mjs");
const LOCK = ".pack-lock";

function runPack(outputRoot, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [PACK_CLI, `--output-root=${outputRoot}`],
      { cwd: REPO, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) resolvePromise({ status: 0, stdout, stderr });
        else
          resolvePromise({
            status: typeof error.code === "number" ? error.code : 1,
            stdout,
            stderr: `${stderr}${error.message}`,
          });
      },
    );
  });
}

async function waitFor(predicate, { what, timeoutMs = 60_000, everyMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

test("two concurrent CLI packs of one output root: exactly one wins, the other fails fast", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pack-concurrency-"));
  try {
    const winner = runPack(root);
    await waitFor(
      async () => {
        try {
          await stat(path.join(root, LOCK));
          return true;
        } catch {
          return false;
        }
      },
      { what: "winner to hold the pack lock" },
    );
    const loser = await runPack(root);
    assert.notEqual(loser.status, 0, "second pack must fail fast while the first holds the lock");
    assert.match(loser.stderr, /pack refused: another pack is already running/);
    assert.match(loser.stderr, /\.pack-lock/, "lock message names the lock path");
    const winnerResult = await winner;
    assert.equal(winnerResult.status, 0, `winner pack failed: ${winnerResult.stderr}`);
    assert.match(winnerResult.stdout, /^sha256: [a-f0-9]{64}$/m);
    await assert.rejects(stat(path.join(root, LOCK)), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale lock fails the next pack with a clear message and a retry succeeds after removal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pack-concurrency-"));
  try {
    const staleClaim = {
      format: "csm-pack-lock/1",
      token: "deadbeef",
      pid: 999999,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(path.join(root, LOCK), `${JSON.stringify(staleClaim, null, 2)}\n`);
    const blocked = await runPack(root);
    assert.notEqual(blocked.status, 0, "stale lock must fail the pack fast");
    assert.match(blocked.stderr, /pack refused: another pack is already running/);
    assert.match(blocked.stderr, /999999/, "message reports the stale owner pid");
    await rm(path.join(root, LOCK));
    const retry = await runPack(root);
    assert.equal(retry.status, 0, `retry after stale-lock removal must succeed: ${retry.stderr}`);
    assert.match(retry.stdout, /^sha256: [a-f0-9]{64}$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sequential double packs stay green and leave no lock behind", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pack-concurrency-"));
  try {
    const first = await runPack(root);
    assert.equal(first.status, 0, `first pack failed: ${first.stderr}`);
    const second = await runPack(root);
    assert.equal(second.status, 0, `second pack failed: ${second.stderr}`);
    const firstSha = /^sha256: ([a-f0-9]{64})$/m.exec(first.stdout)?.[1];
    const secondSha = /^sha256: ([a-f0-9]{64})$/m.exec(second.stdout)?.[1];
    assert.equal(firstSha, secondSha, "deterministic double pack");
    await assert.rejects(stat(path.join(root, LOCK)), { code: "ENOENT" });
    assert.equal(
      (await readFile(path.join(root, "payload-index.json"), "utf8").then((c) => c.length)) > 0,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
