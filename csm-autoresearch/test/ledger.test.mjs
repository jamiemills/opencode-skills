"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AppendOnlyLedger,
  atomicJson,
  hash,
  redact,
  validateReport,
} from "../lib/ledger/index.mjs";

test("ledger resumes by appending sequence numbers and retains every event", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ledger-"));
  const path = join(root, "run.jsonl");
  const provenance = {
    contractHash: hash("contract"),
    evaluatorHash: hash("evaluator"),
    environmentHash: hash("environment"),
  };
  const first = new AppendOnlyLedger(path, { runId: "run", provenance });
  await first.open();
  await first.append("intake", { payload: { authorization: "Bearer secret" } });
  const second = new AppendOnlyLedger(path, { runId: "run", provenance });
  const records = await second.open();
  await second.append("decision", {
    candidateId: "c",
    decision: "reject",
    payload: { path: "/home/user/private" },
  });
  const lines = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 1);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].sequence, 1);
  assert.equal(lines[0].provenance.redacted, true);
  assert.equal(lines[0].payload.authorization, "[REDACTED]");
  assert.equal(lines[1].payload.path, "[PATH]");
});

test("atomic JSON report writes are redacted and hashes are stable", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ledger-"));
  const path = join(root, "report.json");
  await atomicJson(path, {
    secret: "value",
    nested: { token: "abc" },
    stable: hash({ b: 2, a: 1 }),
  });
  const value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(value.secret, "[REDACTED]");
  assert.equal(value.nested.token, "[REDACTED]");
  assert.equal(hash({ a: 1, b: 2 }), value.stable);
  assert.deepEqual(redact("Bearer abc"), "[REDACTED]");
});

test("ledger quarantines torn tails and rejects a second writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ledger-"));
  const path = join(root, "run.jsonl");
  const ledger = new AppendOnlyLedger(path, {
    runId: "run",
    provenance: { contractHash: hash("c"), evaluatorHash: hash("e"), environmentHash: hash("v") },
  });
  await ledger.open();
  await ledger.append("intake");
  await writeFile(path, `${await readFile(path, "utf8")}broken`);
  const resumed = new AppendOnlyLedger(path, { runId: "run", provenance: ledger.provenance });
  const records = await resumed.open();
  assert.equal(records.length, 1);
  assert.equal(
    (await readdir(root)).some((name) => name.includes("torn-tail")),
    true,
  );
  await resumed.append("stopped");
  const held = new AppendOnlyLedger(path, { runId: "run", provenance: ledger.provenance });
  await held.open();
  await writeFile(`${path}.lock`, "held");
  await assert.rejects(() => held.append("intake"), /single-writer/);
});

test("ledger turns complete hash and run identity corruption into durable blocked state", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ledger-"));
  const path = join(root, "run.jsonl");
  const provenance = {
    contractHash: hash("c"),
    evaluatorHash: hash("e"),
    environmentHash: hash("v"),
  };
  const ledger = new AppendOnlyLedger(path, { runId: "run", provenance });
  await ledger.open();
  await ledger.append("intake");
  const record = JSON.parse(await readFile(path, "utf8"));
  record.event = "tampered";
  await writeFile(path, `${JSON.stringify(record)}\n`);
  const blocked = new AppendOnlyLedger(path, { runId: "run", provenance });
  const records = await blocked.open();
  assert.equal(blocked.status, "blocked");
  assert.equal(records.at(-1).event, "blocked");
  assert.equal(
    JSON.parse(await readFile(`${path}.state.json`, "utf8")).reason,
    "hash-integrity-failure",
  );
  await blocked.append("intake");
  await assert.rejects(() => blocked.append("evaluation"), /ledger is blocked/);
  const wrongRun = new AppendOnlyLedger(path, { runId: "other", provenance });
  assert.equal((await wrongRun.open()).at(-1).payload.status, "corrupt-ledger");
  assert.equal(wrongRun.status, "blocked");
});

test("ledger classifies sequence corruption separately from hash corruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-ledger-"));
  const path = join(root, "run.jsonl");
  const provenance = {
    contractHash: hash("c"),
    evaluatorHash: hash("e"),
    environmentHash: hash("v"),
  };
  const ledger = new AppendOnlyLedger(path, { runId: "run", provenance });
  await ledger.open();
  await ledger.append("intake");
  const record = JSON.parse(await readFile(path, "utf8"));
  record.sequence = 4;
  await writeFile(path, `${JSON.stringify(record)}\n`);
  await new AppendOnlyLedger(path, { runId: "run", provenance }).open();
  assert.equal(
    JSON.parse(await readFile(`${path}.state.json`, "utf8")).reason,
    "sequence-mismatch",
  );
});

test("report validation is fail-closed", () => {
  assert.throws(
    () => validateReport({ format: "csm-autoresearch-report/1", runId: "run" }, "run"),
    /invalid autoresearch report/,
  );
});
