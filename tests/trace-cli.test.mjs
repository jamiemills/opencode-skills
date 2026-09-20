"use strict";

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { entryFromArgs, parseArgs, runTraceCli, safeRunId } from "../scripts/trace.mjs";

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), "csm-trace-cli-"));
  return { dir, file: join(dir, "trace.jsonl") };
}

const FLAGS = [
  "action",
  "--actor",
  "csm-build",
  "--action",
  "task-complete",
  "--target",
  "T001",
  "--justification",
  "shipped",
  "--outcome",
  "ok",
];

test("parseArgs rejects unknown flags and a missing mode", () => {
  assert.throws(() => parseArgs(["--nope"]), /unknown flag/);
  assert.throws(() => parseArgs(["--actor", "x"]), /first argument/);
  assert.throws(() => parseArgs(["action", "--actor"]), /needs a value/);
});

test("runTraceCli appends one redacted UTC action line", async () => {
  const { dir, file } = tempFile();
  try {
    const lines = [];
    const result = await runTraceCli({
      argv: [...FLAGS, "--justification", "shipped API_KEY=supersecret", "--file", file],
      write: (line) => lines.push(line),
    });
    assert.equal(result.file, file);
    const record = JSON.parse(readFileSync(file, "utf8").trim());
    assert.equal(record.kind, "action");
    assert.equal(record.actor, "csm-build");
    assert.equal(record.action, "task-complete");
    assert.ok(record.ts.endsWith("Z"), "UTC timestamp");
    assert.ok(!JSON.stringify(record).includes("supersecret"), "secret redacted");
    assert.equal(lines[0], file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runTraceCli decision mode forces kind=decision", async () => {
  const { dir, file } = tempFile();
  try {
    await runTraceCli({ argv: ["decision", ...FLAGS.slice(1), "--file", file], write: () => {} });
    const record = JSON.parse(readFileSync(file, "utf8").trim());
    assert.equal(record.kind, "decision");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runTraceCli --stdin reads one JSON object and defaults runId to a safe generated id", async () => {
  const { dir, file } = tempFile();
  try {
    const input = JSON.stringify({
      actor: "csm-orchestrate",
      action: "checkpoint",
      target: "phase-1",
      justification: "stdin",
      outcome: "continue",
    });
    await runTraceCli({
      argv: ["--stdin", "--file", file],
      readStdin: async () => input,
      write: () => {},
    });
    const record = JSON.parse(readFileSync(file, "utf8").trim());
    assert.equal(record.actor, "csm-orchestrate");
    assert.match(record.runId, /^run-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entryFromArgs rejects a missing required field", () => {
  const parsed = parseArgs(["action", "--actor", "x"]);
  assert.throws(() => entryFromArgs(parsed, {}), /action must be a non-empty string/);
});

test("safeRunId refuses traversal and generates a safe id", () => {
  assert.match(safeRunId("../../evil"), /^run-/, "traversal is replaced by a generated id");
  assert.equal(safeRunId("run-abc_1.2"), "run-abc_1.2");
});
