"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { appendTrace, recordDecision } from "../scripts/lib/trace-log.mjs";
import { isUtc, utcNow } from "../scripts/lib/utc.mjs";

const REQUIRED_FIELDS = ["ts", "runId", "actor", "action", "target", "justification", "outcome"];

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
