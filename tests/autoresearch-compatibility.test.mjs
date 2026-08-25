import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AppendOnlyLedger, hash } from "../csm-autoresearch/lib/ledger/index.mjs";
import {
  createArtifactDescriptor,
  createArtifactEnvelope,
  rejectProjectionInput,
  replayReport,
} from "../csm-autoresearch/lib/artifacts/index.mjs";

test("autoresearch old report replay and shared descriptor preserve native identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-autoresearch-root-"));
  const reportPath = join(root, "old-report.json");
  const report = {
    format: "csm-autoresearch-report/1",
    runId: "old-run",
    status: "stopped",
    mode: "hill-climb",
    sourceMode: "registered",
    baseline: { metrics: { score: 1 }, status: "ok" },
    trials: [],
    gates: { hardPassed: true, failed: [] },
    artifactRefs: ["old-ledger.jsonl"],
  };
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  assert.equal((await replayReport(reportPath, "old-run")).runId, "old-run");
  const descriptor = createArtifactDescriptor({
    runId: report.runId,
    kind: "autoresearch-report",
    digest: hash(report),
    location: "old-report.json",
    contentType: "application/json",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  const envelope = createArtifactEnvelope(descriptor, {
    nativeRunId: report.runId,
    startedAt: "2026-08-25T00:00:00.000Z",
    sourceDigests: [hash("contract")],
  });
  assert.equal(envelope.payload.artifact.digest, descriptor.artifact.digest);
});

test("corruption is quarantined, locks remain exclusive, and projections are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-autoresearch-corrupt-"));
  const path = join(root, "run.jsonl");
  const provenance = {
    contractHash: hash("c"),
    evaluatorHash: hash("e"),
    environmentHash: hash("v"),
  };
  const ledger = new AppendOnlyLedger(path, { runId: "run", provenance });
  await ledger.open();
  await ledger.append("intake");
  await writeFile(path, `${await readFile(path, "utf8")}broken\n`);
  const resumed = new AppendOnlyLedger(path, { runId: "run", provenance });
  const records = await resumed.open();
  assert.equal(records.at(-1).event, "blocked");
  assert.equal(
    (await readdir(root)).some((name) => name.includes("corrupt-ledger")),
    true,
  );
  await writeFile(`${path}.lock`, "held");
  await assert.rejects(() => resumed.append("evaluation"), /single-writer|blocked/);
  assert.throws(() => rejectProjectionInput("human.html"), /projection/);
});
