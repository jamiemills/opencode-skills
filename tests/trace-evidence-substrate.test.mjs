import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTrace, rotateTraceLog } from "../scripts/lib/trace-log.mjs";
import { runVerifyTracesCli, verifyTraces } from "../scripts/verify-traces.mjs";

const DIR = mkdtempSync(join(tmpdir(), "csm-trace-substrate-"));
const entry = () => ({
  runId: "r1",
  actor: "a",
  action: "x",
  target: "t",
  justification: "j",
  outcome: "o",
});
const lines = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("records are labelled production by default and fixture on request", async () => {
  const file = join(DIR, "default.jsonl");
  await appendTrace(entry(), { file });
  await appendTrace(entry(), { file, fixture: true });
  const [first, second] = lines(file);
  assert.equal(first.label, "production");
  assert.equal(second.label, "fixture");
});

test("the CSM_TRACE_FIXTURE env labels a rehearsal run", async () => {
  const file = join(DIR, "env.jsonl");
  const prior = process.env.CSM_TRACE_FIXTURE;
  process.env.CSM_TRACE_FIXTURE = "1";
  try {
    await appendTrace(entry(), { file });
  } finally {
    if (prior === undefined) delete process.env.CSM_TRACE_FIXTURE;
    else process.env.CSM_TRACE_FIXTURE = prior;
  }
  assert.equal(lines(file)[0].label, "fixture");
});

test("an explicit label wins; an unknown label is refused", async () => {
  const file = join(DIR, "explicit.jsonl");
  await appendTrace({ ...entry(), label: "fixture" }, { file });
  assert.equal(lines(file)[0].label, "fixture");
  await assert.rejects(() => appendTrace({ ...entry(), label: "staging" }, { file }), /label/);
});

test("rotation shifts generations and caps retention", () => {
  const file = join(DIR, "rotate.jsonl");
  writeFileSync(file, "x".repeat(64));
  assert.equal(rotateTraceLog(file, { maxBytes: 8, maxGenerations: 2 }).rotated, true);
  assert.ok(existsSync(`${file}.1`));
  writeFileSync(file, "y".repeat(64));
  rotateTraceLog(file, { maxBytes: 8, maxGenerations: 2 });
  assert.ok(existsSync(`${file}.2`));
  writeFileSync(file, "z".repeat(64));
  rotateTraceLog(file, { maxBytes: 8, maxGenerations: 2 });
  assert.ok(!existsSync(`${file}.3`), "must not exceed maxGenerations");
  assert.ok(existsSync(`${file}.1`) && existsSync(`${file}.2`));
  assert.equal(rotateTraceLog(file, { maxBytes: 1024 }).rotated, false);
});

test("a completed run with no trace fails closed", () => {
  const absent = verifyTraces({ file: join(DIR, "absent.jsonl"), runId: "r1" });
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, "log-absent");
});

test("production coverage fails closed when only fixture traces exist", async () => {
  const file = join(DIR, "coverage.jsonl");
  await appendTrace(entry(), { file, fixture: true });
  const bad = verifyTraces({ file, runId: "r1", requireProduction: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "no-production-trace-for-run");
  await appendTrace(entry(), { file });
  const good = verifyTraces({ file, runId: "r1", requireProduction: true });
  assert.equal(good.ok, true);
  assert.equal(good.production, 1);
  assert.equal(good.fixture, 1);
});

test("the CLI --require-production flag fails closed on a fixture-only log", async () => {
  const file = join(DIR, "cli.jsonl");
  await appendTrace(entry(), { file, fixture: true });
  const out = [];
  const result = await runVerifyTracesCli({
    argv: ["--file", file, "--run-id", "r1", "--require-production", "--json"],
    write: (line) => out.push(line),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-production-trace-for-run");
  assert.match(out[0], /no-production-trace-for-run/);
});
