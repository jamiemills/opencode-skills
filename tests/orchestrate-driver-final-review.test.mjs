"use strict";
// End-to-end wiring test for the driver's --final-review flag: a minimal
// read-only fixture approach must reach a VERIFIED terminal receipt when the
// independent reviewer module is supplied, proving the review invocation,
// persisted review records, and the VERIFIED outcome path work through the
// driver.
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const reviewerPath = join(repoRoot, "scripts", "independent-reviewer.mjs");

const HOST_SOURCE = `"use strict";
// Minimal read-only fixture host for the driver wiring test. Digests are
// constants: the evidence schema pins the sha256 form, and the orchestrator's
// identity checks are expectation-echo based, so no hashing is needed here.
const DIGEST = "sha256:" + "a".repeat(64);

export default function hostFixture() {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const source = {
        path: "result-1.json",
        artifactId: "art-result-1",
        digest: DIGEST,
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId: "ev-driver-review-1",
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        validation: { signal: "fixture deliverable produced", status: "pass" },
        source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-driver-review-1",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: DIGEST,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return {
          status: "resolved",
          path,
          owner: expected.expectedOwner ?? item.owner,
          fileDigest: expected.expectedFileDigest ?? item.source.digest,
          value: item,
        };
      },
    },
  };
}
`;

test("driver --final-review drives a real run to VERIFIED through the independent reviewer", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-final-review-"));
  try {
    const runId = "run-driver-review-fixture-" + process.pid;
    const approach = {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId,
      ideaSlug: "driver-review",
      signals: { capabilities: ["csm-scan"], inputs: ["repository"] },
      phases: [
        {
          phaseId: "P1",
          title: "Deliver",
          goal: "produce the deliverable",
          deliverables: ["typed result"],
          scope: ["repository"],
          outOfScope: ["production"],
          constraints: [],
          acceptanceHints: ["technical pass", "functional pass"],
          context: [],
          dependencies: [],
        },
      ],
    };
    const approachPath = join(sandbox, "approach.json");
    const hostPath = join(sandbox, "host.mjs");
    await writeFile(approachPath, JSON.stringify(approach, null, 2) + "\n");
    await writeFile(hostPath, HOST_SOURCE + "\n");
    const { stdout } = await exec(
      process.execPath,
      [driverPath, "--approach", approachPath, "--host", hostPath, "--final-review", reviewerPath],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.match(stdout, /status: VERIFIED/);
    const evidenceLine = stdout.split("\n").find((line) => line.startsWith("evidence:"));
    const receiptDir = evidenceLine.slice("evidence:".length).trim();
    const receipt = JSON.parse(await readFile(join(receiptDir, "receipt.json"), "utf8"));
    assert.equal(receipt.outcome.status, "VERIFIED");
    assert.equal(receipt.outcome.accepted, true);
    assert.ok(receipt.outcome.acceptanceRefs.includes("ev-driver-review-1"));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
