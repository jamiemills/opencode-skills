import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";
import {
  validateApproval,
  validateFinalOutcome,
  validatePhaseGraph,
  validateRequirementLedger,
} from "../csm-orchestrate/lib/contracts.mjs";

const root = new URL("../", import.meta.url);
const registry = parseJson(
  await readFile(new URL("../schemas/registry.json", import.meta.url), "utf8"),
);
const schemas = await Promise.all(
  registry.entries.map(async (entry) => {
    const schema = parseJson(
      await readFile(new URL(`../${entry.schemaPath}`, import.meta.url), "utf8"),
    );
    Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
    return schema;
  }),
);
const validator = createSchemaRegistry({
  registry,
  schemas,
  root: root.pathname,
});

const digest = `sha256:${"a".repeat(64)}`;
const phase = (phaseId, parentPhaseId = null) => ({
  schema: "csm-orchestrate-phase/1",
  phaseId,
  parentPhaseId,
  runId: "run-test-20260827",
  graphRevision: 1,
  insertion: { mode: "initial", ordinal: 0 },
  owner: "csm-orchestrate",
  route: "csm-build",
  requirementIds: ["req-output"],
  acceptanceSignals: ["node --test"],
  approvalScope: ["read"],
  idempotency: { key: phaseId, mode: "read-only" },
  remediationBudget: 1,
  status: "planned",
});
const ledger = (
  status = "verified",
  evidenceRefs = [{ evidenceId: "ev-test", kind: "technical", status: "available", digest }],
) => ({
  schema: "csm-orchestrate-requirement/1",
  ledgerId: "ledger-test",
  requirements: [
    {
      requirementId: "req-output",
      criticality: "critical",
      statement: "output is accepted",
      status,
      evidenceRefs,
    },
  ],
});
const cursor = {
  schema: "csm-orchestrate-cursor/1",
  cursorId: "cursor-test",
  runId: "run-test-20260827",
  phaseId: "phase-root",
  routeState: "selected",
  checkpointState: "validated",
  attempt: 0,
  idempotencyKey: "phase-root",
};
const receipt = {
  schema: "csm-orchestrate-receipt/1",
  receiptId: "receipt-parent",
  runId: "run-test-20260827",
  phaseId: "phase-root",
  childReceipts: [
    {
      receiptId: "receipt-child",
      schema: "csm-build-state/1",
      runId: "run-child-20260827",
      digest,
      owner: "csm-build",
      status: "completed",
    },
  ],
  approval: {
    approvalId: "approval-test",
    scope: ["read"],
    approvedDigest: digest,
    approvedAt: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-28T00:00:00Z",
    status: "approved",
  },
  statuses: {
    route: "complete",
    child: "completed",
    artifact: "completed",
    verification: "verified",
    parent: "verified",
  },
  outcome: { status: "VERIFIED", accepted: true, acceptanceRefs: ["req-output", "ev-test"] },
  idempotencyKey: "phase-root",
};

test("positive phase, ledger, cursor, and receipt contracts resolve from the registry", () => {
  assert.equal(validator.resolve("csm-orchestrate-phase", 1).id, "csm-orchestrate-phase/1");
  assert.equal(
    validator.resolve("csm-orchestrate-requirement", 1).id,
    "csm-orchestrate-requirement/1",
  );
  assert.equal(validator.resolve("csm-orchestrate-cursor", 1).id, "csm-orchestrate-cursor/1");
  assert.equal(validator.resolve("csm-orchestrate-receipt", 1).id, "csm-orchestrate-receipt/1");
  assert.equal(validator.entries.length >= 4, true);
  assert.equal(
    validator.resolve("csm-orchestrate-phase", 1).schema.required.includes("phaseId"),
    true,
  );
  assert.equal(
    validator.resolve("csm-orchestrate-requirement", 1).schema.required.includes("requirements"),
    true,
  );
  assert.equal(
    validator.resolve("csm-orchestrate-cursor", 1).schema.required.includes("checkpointState"),
    true,
  );
  assert.equal(
    validator.resolve("csm-orchestrate-receipt", 1).schema.required.includes("approval"),
    true,
  );
  assert.equal(validator.validate("csm-orchestrate-phase/1", phase("phase-root")).valid, true);
  assert.equal(validator.validate("csm-orchestrate-requirement/1", ledger()).valid, true);
  assert.equal(validator.validate("csm-orchestrate-cursor/1", cursor).valid, true);
  assert.equal(validator.validate("csm-orchestrate-receipt/1", receipt).valid, true);
});

test("critical verified requirement without available evidence is rejected", () => {
  assert.throws(() => validateRequirementLedger(ledger("verified", [])), /lacks evidence/);
  assert.throws(
    () => validateFinalOutcome(ledger("open"), { status: "VERIFIED" }),
    /unresolved critical/,
  );
});

test("duplicate and cyclic phase graphs fail closed", () => {
  assert.throws(() => validatePhaseGraph([phase("phase-a"), phase("phase-a")]), /duplicate/);
  assert.throws(
    () => validatePhaseGraph([phase("phase-a", "phase-b"), phase("phase-b", "phase-a")]),
    /cycle/,
  );
});

test("approval cannot be reused after expiry or input digest drift", () => {
  const approval = {
    approvalId: "approval-test",
    scope: ["read"],
    approvedDigest: digest,
    approvedAt: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-28T00:00:00Z",
    status: "approved",
  };
  assert.equal(validateApproval(approval, digest, new Date("2026-08-27T12:00:00Z")), true);
  assert.throws(
    () => validateApproval(approval, digest, new Date("2026-08-28T00:00:00Z")),
    /expired/,
  );
  assert.throws(
    () => validateApproval(approval, `sha256:${"b".repeat(64)}`, new Date("2026-08-27T12:00:00Z")),
    /digest mismatch/,
  );
});
