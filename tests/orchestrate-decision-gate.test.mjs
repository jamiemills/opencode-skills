"use strict";

// T006: decision gate + six-condition adversarial isolation matrix. The
// hermetic run always executes (fake Docker transport, real decision logic) and
// records the artifact. When Docker is available the same gate re-runs live and
// records the stronger live artifact at the same path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createHermeticProbes,
  createLiveProbes,
  DECISION_CONDITIONS,
  DECISION_GATE_SCHEMA,
  ISOLATION_MATRIX_PROPERTIES,
  runDecisionGate,
} from "../csm-orchestrate/lib/decision-gate.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_PATH = join(
  REPO_ROOT,
  ".agents",
  "evidence",
  "dynamic-worker-runtime",
  "decision-gate.json",
);
const DOCKER_AVAILABLE = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const NOW = () => "2026-09-13T00:00:00.000Z";

function assertAllPass(artifact) {
  assert.equal(
    artifact.verdict,
    "pass",
    `gate failed: ${artifact.failedConditions.join(", ")} :: ${JSON.stringify(
      artifact.conditions.filter((condition) => condition.status !== "pass"),
    )}`,
  );
  assert.equal(artifact.conditions.length, 6);
  for (const condition of artifact.conditions)
    assert.equal(
      condition.status,
      "pass",
      `${condition.id} (${condition.title}) failed: ${JSON.stringify(condition.evidence)}`,
    );
  assert.equal(artifact.isolationMatrix.status, "pass", JSON.stringify(artifact.isolationMatrix));
  for (const property of ISOLATION_MATRIX_PROPERTIES)
    assert.equal(
      artifact.isolationMatrix.properties[property],
      "pass",
      `matrix property ${property} failed: ${JSON.stringify(
        artifact.isolationMatrix.evidence?.[property],
      )}`,
    );
}

test("T006: the hermetic gate passes all six conditions and every isolation-matrix property", async () => {
  const artifact = await runDecisionGate({
    probes: createHermeticProbes(),
    now: NOW,
    evidencePath: EVIDENCE_PATH,
  });
  assertAllPass(artifact);
  assert.equal(artifact.schema, DECISION_GATE_SCHEMA);
  assert.equal(artifact.mode, "hermetic");
  assert.equal(artifact.generatedAt, NOW());

  const onDisk = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
  assert.equal(onDisk.schema, DECISION_GATE_SCHEMA);
  assert.equal(onDisk.verdict, "pass");
  assert.equal(onDisk.conditions.length, 6);
  assert.deepEqual(
    onDisk.conditions.map((condition) => condition.id),
    DECISION_CONDITIONS.map((condition) => condition.id),
  );
  assert.deepEqual(Object.keys(onDisk.isolationMatrix.properties), [
    ...ISOLATION_MATRIX_PROPERTIES,
  ]);
});

test("T006: a failing probe yields a fail verdict naming the failing condition", async () => {
  const artifact = await runDecisionGate({
    probes: {
      ...createHermeticProbes(),
      egressDefaultDeny: async () => ({ pass: false, evidence: { reason: "forced-denial" } }),
    },
    now: NOW,
    persist: false,
  });
  assert.equal(artifact.verdict, "fail");
  assert.deepEqual(artifact.failedConditions, ["C3"]);
  const failing = artifact.conditions.find((condition) => condition.id === "C3");
  assert.equal(failing.status, "fail");
  assert.equal(failing.evidence.reason, "forced-denial");
});

test("T006: artifactPath is runtime-only and never persisted into the artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-gate-"));
  try {
    const scratch = join(dir, "decision-gate.json");
    const artifact = await runDecisionGate({
      probes: createHermeticProbes(),
      now: NOW,
      evidencePath: scratch,
    });
    assertAllPass(artifact);
    const onDisk = JSON.parse(await readFile(scratch, "utf8"));
    assert.equal(onDisk.verdict, "pass");
    assert.equal(onDisk.artifactPath, undefined, "artifactPath is runtime-only, never persisted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "T006: the live gate passes all six conditions and the isolation matrix under Docker",
  { skip: !DOCKER_AVAILABLE },
  async () => {
    const artifact = await runDecisionGate({
      probes: createLiveProbes(),
      now: NOW,
      evidencePath: EVIDENCE_PATH,
    });
    assertAllPass(artifact);
    assert.equal(artifact.mode, "live");
    const onDisk = JSON.parse(await readFile(EVIDENCE_PATH, "utf8"));
    assert.equal(onDisk.verdict, "pass");
    assert.equal(onDisk.mode, "live");
  },
);
