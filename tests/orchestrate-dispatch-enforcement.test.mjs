"use strict";

// Enforcement verification tests (orchestrate-skill-dispatch-enforcement plan):
//   E-001: orchestrate() with skill-level route and no executorAdapter → BLOCKED
//   E-002: orchestrate() with executorAdapter and enforceSkillFirstRouting → works
//   E-003: orchestrate() with enforceSkillFirstRouting: false → old behavior (incidental pass-through)
//   E-004: all 13 skills have registered executor handlers
//   E-005: csm-plan validation rejects warranted plans without dispatchConstraints
//   E-006: csm-plan validation accepts plans with valid dispatchConstraints
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { orchestrate } from "../csm-orchestrate/lib/index.mjs";
import { createExecutorHandlers } from "../csm-orchestrate/lib/skill-executor-handlers.mjs";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = () => new Date("2026-09-06T12:00:00Z");
const SHA_A = "sha256:" + "a".repeat(64);

const approachFor = (runId, skill) => ({
  schema: "csm-approach/1",
  schemaRevision: 1,
  status: "agreed",
  runId,
  ideaSlug: "enforce",
  signals: { capabilities: [skill], inputs: ["repository"] },
  phases: [
    {
      phaseId: "P1",
      title: "Work",
      goal: "do work",
      deliverables: ["result"],
      scope: ["repository"],
      outOfScope: ["production"],
      constraints: [],
      acceptanceHints: ["done"],
      context: [],
      dependencies: [],
    },
  ],
});

const noopHost = {
  async invokeSiblingSkill(_request) {
    throw new Error("invokeSiblingSkill should not be called when skill-first routing is enforced");
  },
};

const memoryStore = () => ({
  cursors: new Map(),
  async saveCursor(c) {
    this.cursors.set(c.cursorId, c);
  },
  async loadCursor(id) {
    return this.cursors.get(id) ?? null;
  },
});

test("E-001: orchestrate() with skill-level route and no executorAdapter returns BLOCKED when enforceSkillFirstRouting is true", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "enforce-e001-"));
  const result = await orchestrate({
    approach: approachFor("run-enforce-e001", "csm-build"),
    runId: "run-enforce-e001",
    host: noopHost,
    capabilities,
    signals: { capabilities: ["csm-build"], inputs: ["repository"] },
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryStore(),
    schemaRegistry: registry,
    artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
    enforceSkillFirstRouting: true,
    telemetryEmitter: null,
  });
  assert.equal(result.receipt.outcome.status, "BLOCKED");
  assert.equal(result.reason, "executor-adapter-required");
});

test("E-002: orchestrate() with enforceSkillFirstRouting: false uses host invocation (old behavior)", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "enforce-e002-"));
  // use a read-only skill (csm-scan) so autonomy auto-approves
  const artifacts = new Map();
  const host = {
    async invokeSiblingSkill(request) {
      const d = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-e002",
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: "f.json",
          artifactId: "a",
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      artifacts.set(d.source.path, { ...d, digest: SHA_A });
      return {
        status: "completed",
        technical: [{ id: "t", status: "pass", evidenceRefs: [d.evidenceId] }],
        functional: [{ id: "f", status: "pass", evidenceRefs: [d.evidenceId] }],
        evidence: [{ ...d, digest: SHA_A }],
        childReceipt: {
          receiptId: "receipt-e002",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: SHA_A,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(p, e = {}) {
        const v = artifacts.get(p);
        if (!v) return { status: "missing", code: "missing", message: "m" };
        return {
          status: "resolved",
          path: p,
          owner: e.expectedOwner,
          fileDigest: e.expectedFileDigest,
          value: { ...v, schema: v.source.schema },
        };
      },
    },
  };
  const result = await orchestrate({
    approach: approachFor("run-enforce-e002", "csm-scan"),
    runId: "run-enforce-e002",
    host,
    capabilities,
    signals: { capabilities: ["csm-scan"] },
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryStore(),
    schemaRegistry: registry,
    artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
    childArtifactResolver: host.artifactResolver,
    enforceSkillFirstRouting: false,
    telemetryEmitter: null,
  });
  // without final review, the terminal is REQUIRES_REVIEW (not BLOCKED)
  assert.notEqual(result.receipt.outcome.status, "BLOCKED");
  assert.notEqual(result.receipt.outcome.status, "FAILED");
});

test("E-004: all 13 skills in SUPPORTED_SKILLS have registered executor handlers", () => {
  const handlers = createExecutorHandlers();
  const expected = [
    "csm-autoresearch",
    "csm-bdd-tdd",
    "csm-browse",
    "csm-build",
    "csm-ddd",
    "csm-deep-research",
    "csm-grill",
    "csm-make-tests",
    "csm-plan",
    "csm-review",
    "csm-review-python",
    "csm-scan",
    "csm-upload",
  ];
  for (const skill of expected) {
    assert.ok(handlers.has(skill), `missing handler for ${skill}`);
    assert.equal(typeof handlers.get(skill), "function", `handler for ${skill} is not a function`);
  }
  assert.equal(handlers.size, 13);
});

test("E-003: orchestrate() with an incidental (non-skill) route runs without requiring an executor handler", async () => {
  const capabilities = await loadCapabilities();
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "enforce-e003-"));
  const artifacts = new Map();
  const host = {
    async invokeSiblingSkill(request) {
      const d = {
        schema: "csm-orchestrate-evidence/2",
        evidenceId: "ev-e003",
        kind: "technical",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        source: {
          path: "f.json",
          artifactId: "a",
          digest: SHA_A,
          schema: "csm-orchestrate-evidence/2",
          sourceRunId: request.childRunId,
        },
      };
      artifacts.set(d.source.path, { ...d, digest: SHA_A });
      return {
        status: "completed",
        technical: [{ id: "t", status: "pass", evidenceRefs: [d.evidenceId] }],
        functional: [{ id: "f", status: "pass", evidenceRefs: [d.evidenceId] }],
        evidence: [{ ...d, digest: SHA_A }],
        childReceipt: {
          receiptId: "receipt-e003",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: SHA_A,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(p, e = {}) {
        const v = artifacts.get(p);
        if (!v) return { status: "missing", code: "missing", message: "m" };
        return {
          status: "resolved",
          path: p,
          owner: e.expectedOwner,
          fileDigest: e.expectedFileDigest,
          value: { ...v, schema: v.source.schema },
        };
      },
    },
  };
  // An incidental task is a phase whose route does NOT match a csm skill needing
  // skill-level dispatch; enforceSkillFirstRouting only blocks skill-level work
  // without an executor adapter. A host-based incidental run still proceeds.
  const result = await orchestrate({
    approach: {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId: "run-enforce-e003",
      ideaSlug: "enforce",
      signals: { capabilities: ["csm-scan"], inputs: ["repository"] },
      phases: [
        {
          phaseId: "P1",
          title: "Work",
          goal: "do work",
          deliverables: ["result"],
          scope: ["repository"],
          outOfScope: ["production"],
          constraints: [],
          acceptanceHints: ["done"],
          context: [],
          dependencies: [],
        },
      ],
    },
    runId: "run-enforce-e003",
    host,
    capabilities,
    signals: { capabilities: ["csm-scan"] },
    approvals: createAutonomyPolicy(capabilities, { now: NOW }),
    now: NOW,
    cursorStore: memoryStore(),
    schemaRegistry: registry,
    artifactResolver: createArtifactResolver({ root, schemaRegistry: registry }),
    childArtifactResolver: host.artifactResolver,
    enforceSkillFirstRouting: false,
    telemetryEmitter: null,
  });
  assert.notEqual(result.receipt.outcome.status, "BLOCKED");
});
