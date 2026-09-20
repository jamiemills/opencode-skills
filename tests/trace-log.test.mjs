"use strict";

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repoLogPath } from "../scripts/lib/repo-state.mjs";
import { appendTrace, recordDecision } from "../scripts/lib/trace-log.mjs";
import { isUtc, utcNow } from "../scripts/lib/utc.mjs";

const REQUIRED_FIELDS = ["ts", "runId", "actor", "action", "target", "justification", "outcome"];
const TRACE_MODULE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "lib",
  "trace-log.mjs",
);
const CONCURRENCY = 16;
const MAX_LINE_BYTES = 512 * 1024;

function baseEntry(overrides = {}) {
  return {
    runId: "run-20260101t000000z-abc123",
    actor: "trace-test",
    action: "append",
    target: "tests/trace-log.test.mjs",
    justification: "exercise the append-only trace log",
    outcome: "ok",
    ...overrides,
  };
}

async function readLines(file) {
  return (await readFile(file, "utf8")).split("\n").filter((line) => line.length > 0);
}

// A writer that waits on a start barrier (a sentinel file) before appending
// exactly one distinguishable line, so every child contends on the same file.
const WORKER_SOURCE = String.raw`
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [modulePath, file, token, readyPath, barrierPath] = process.argv.slice(2);
try {
  const { appendTrace } = await import(pathToFileURL(modulePath).href);
  writeFileSync(readyPath, token, "utf8");
  while (!existsSync(barrierPath)) await sleep(1);
  await appendTrace(
    {
      runId: "run-concurrent-" + token,
      actor: "trace-concurrency",
      action: "append",
      target: "tests/trace-log.test.mjs",
      justification: "barrier token " + token,
      outcome: "ok",
    },
    { file },
  );
} catch (error) {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
}
`;

function spawnWriter(workerPath, file, token, readyPath, barrierPath) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [workerPath, TRACE_MODULE, file, token, readyPath, barrierPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolvePromise({ code, stderr, token }));
  });
}

test("utcNow returns a UTC ISO-8601 timestamp and isUtc accepts only Z strings", () => {
  const now = utcNow();
  assert.ok(now.endsWith("Z"));
  assert.ok(isUtc(now));
  assert.ok(isUtc("2026-01-01T00:00:00.000Z"));
  assert.ok(!isUtc("2026-01-01T00:00:00+00:00"));
  assert.ok(!isUtc("2026-01-01T00:00:00"));
  assert.ok(!isUtc("not-a-dateZ"));
  assert.ok(!isUtc(undefined));
});

test("appendTrace defaults to the shared repo log (repoLogPath of cwd)", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "csm-trace-repo-")));
  const originalCwd = process.cwd();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
    process.chdir(root);
    const expected = join(root, ".git", "csm", "logs", "trace.jsonl");
    assert.ok(isAbsolute(repoLogPath(root)));
    assert.equal(repoLogPath(root), expected);
    const { file } = await appendTrace(baseEntry());
    assert.equal(file, expected);
    const lines = await readLines(expected);
    assert.equal(lines.length, 1);
    assert.ok(JSON.parse(lines[0]).ts.endsWith("Z"));
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendTrace appends one JSONL line with a UTC ts and all required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    const { file: written, entry } = await appendTrace(baseEntry(), { file });
    assert.equal(written, resolve(file));
    const lines = await readLines(file);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], JSON.stringify(entry));
    const parsed = JSON.parse(lines[0]);
    for (const field of REQUIRED_FIELDS) assert.ok(parsed[field], `missing ${field}`);
    assert.ok(parsed.ts.endsWith("Z"));
    assert.ok(!Number.isNaN(Date.parse(parsed.ts)));
    assert.equal(parsed.kind, "action");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendTrace rejects a non-UTC ts and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    await assert.rejects(
      () => appendTrace(baseEntry({ ts: "2026-01-01T00:00:00+00:00" }), { file }),
      TypeError,
    );
    await assert.rejects(() => stat(file), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordDecision sets kind=decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    await recordDecision(baseEntry({ action: "choose" }), { file });
    const [parsed] = (await readLines(file)).map((line) => JSON.parse(line));
    assert.equal(parsed.kind, "decision");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("credential-shaped values are redacted before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    await appendTrace(
      baseEntry({
        justification: "called with Bearer abc123token and API_KEY=supersecret",
        outcome: "TOKEN=anothersecret",
      }),
      { file },
    );
    const text = await readFile(file, "utf8");
    assert.ok(!text.includes("abc123token"));
    assert.ok(!text.includes("supersecret"));
    assert.ok(!text.includes("anothersecret"));
    assert.ok(text.includes("[REDACTED]"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("successive calls append without truncating earlier lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    await appendTrace(baseEntry({ action: "first" }), { file });
    await appendTrace(baseEntry({ action: "second" }), { file });
    const lines = await readLines(file);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).action, "first");
    assert.equal(JSON.parse(lines[1]).action, "second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversized records are retained, marked truncated, and never torn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-trace-"));
  try {
    const file = join(dir, "trace.jsonl");
    await appendTrace(baseEntry({ justification: "x".repeat(MAX_LINE_BYTES + 64 * 1024) }), {
      file,
    });
    const text = await readFile(file, "utf8");
    assert.ok(text.endsWith("\n"), "the record must be newline-terminated (no partial line)");
    const lines = text.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    for (const field of REQUIRED_FIELDS) assert.equal(typeof parsed[field], "string", field);
    assert.ok(parsed.justification.includes("[truncated:"));
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_LINE_BYTES);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent writers append every record as a whole line with no loss", async () => {
  const work = await mkdtemp(join(tmpdir(), "csm-trace-concurrent-"));
  try {
    const file = join(work, "shared-trace.jsonl");
    const readyDir = join(work, "ready");
    const barrierPath = join(work, "barrier");
    mkdirSync(readyDir, { recursive: true });
    const workerPath = join(work, "writer.mjs");
    writeFileSync(workerPath, WORKER_SOURCE, "utf8");

    const tokens = Array.from({ length: CONCURRENCY }, (_, index) => `w${String(index)}`);
    const runs = tokens.map((token) =>
      spawnWriter(workerPath, file, token, join(readyDir, `${token}.ready`), barrierPath),
    );

    const deadline = Date.now() + 30_000;
    while (readdirSync(readyDir).length < CONCURRENCY) {
      if (Date.now() > deadline) throw new Error("writers did not reach the start barrier");
      await sleep(5);
    }
    writeFileSync(barrierPath, "go", "utf8");

    const results = await Promise.all(runs);
    for (const result of results)
      assert.equal(result.code, 0, `writer ${result.token} failed: ${result.stderr}`);

    const lines = await readLines(file);
    assert.equal(lines.length, CONCURRENCY, "every concurrent record must be present");
    const seen = new Set();
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.justification.startsWith("barrier token "));
      seen.add(parsed.runId);
    }
    assert.equal(seen.size, CONCURRENCY, "each writer's unique token must appear exactly once");
    for (const token of tokens) assert.ok(seen.has(`run-concurrent-${token}`), token);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
