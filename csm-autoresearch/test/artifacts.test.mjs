"use strict";

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SCHEMAS,
  createArtifactDescriptor,
  createArtifactEnvelope,
  validateArtifactEnvelope,
  rejectProjectionInput,
  replayLedger,
  replayReport,
  registerSchemas,
  sharedRunId,
} from "../lib/artifacts/index.mjs";
import { AppendOnlyLedger, hash } from "../lib/ledger/index.mjs";

const provenance = {
  contractHash: hash("contract"),
  evaluatorHash: hash("evaluator"),
  environmentHash: hash("environment"),
};

test("native ledger/report replay remains valid and receives shared identity externally", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-autoresearch-compat-"));
  const ledgerPath = join(root, "legacy-ledger.jsonl");
  const ledger = new AppendOnlyLedger(ledgerPath, { runId: "legacy-run", provenance });
  await ledger.open();
  await ledger.append("intake");
  const replayed = await replayLedger(ledgerPath, "legacy-run", provenance);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].recordHash, JSON.parse(await readFile(ledgerPath, "utf8")).recordHash);

  const reportPath = join(root, "legacy-report.json");
  const fixture = await readFile(
    new URL("./fixtures/compatibility/legacy-report.json", import.meta.url),
    "utf8",
  );
  await writeFile(reportPath, fixture);
  assert.equal((await replayReport(reportPath, "legacy-run")).status, "completed");

  const descriptor = createArtifactDescriptor({
    runId: "legacy-run",
    kind: "autoresearch-report",
    digest: hash(JSON.parse(fixture)),
    location: "legacy-report.json",
    contentType: "application/json",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  const envelope = createArtifactEnvelope(descriptor, {
    nativeRunId: "legacy-run",
    startedAt: "2026-08-25T00:00:00.000Z",
    endedAt: "2026-08-25T00:00:00.000Z",
    sourceDigests: Object.values(provenance),
  });
  assert.equal(envelope.artifact.artifactId, descriptor.artifact.artifactId);
  assert.equal(envelope.payload.artifact.runId, envelope.run.runId);
  assert.equal(envelope.provenance.nativeRunId, "legacy-run");
  assert.equal(sharedRunId("legacy-run"), envelope.run.runId);
});

test("registration rejects unknown revisions and projections cannot become machine inputs", () => {
  assert.equal(registerSchemas().get(SCHEMAS.ledger), "ledger");
  assert.throws(
    () => registerSchemas([{ id: "csm-autoresearch-ledger-event/2" }]),
    /unknown|registration|duplicate/,
  );
  assert.throws(() => rejectProjectionInput("report.md"), /projection/);
  assert.throws(() => rejectProjectionInput({ schema: "csm-projection/1" }), /projection/);
  assert.equal(rejectProjectionInput("report.json"), "report.json");
});

test("producer APIs reject independent native and shared run identities", () => {
  const descriptor = createArtifactDescriptor({
    nativeRunId: "producer-run",
    kind: "autoresearch-report",
    digest: hash("report"),
    location: "report.json",
    contentType: "application/json",
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  assert.throws(
    () => createArtifactEnvelope(descriptor, { nativeRunId: "other-run" }),
    /nativeRunId.*mismatch|run identity/i,
  );
  const envelope = createArtifactEnvelope(descriptor, { nativeRunId: "producer-run" });
  envelope.run.runId = sharedRunId("other-run");
  assert.throws(
    () => validateArtifactEnvelope(envelope, { nativeRunId: "producer-run" }),
    /nativeRunId.*mismatch|run identity/i,
  );
});
