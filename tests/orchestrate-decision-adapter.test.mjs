"use strict";

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDecisionAdapter,
  deterministicDecision,
  noAdapterDecision,
} from "../csm-orchestrate/lib/decision-adapter/index.mjs";
import {
  decisionPoints,
  getDecisionPoint,
  listDecisionPoints,
  serializeDecisionPoints,
  validateDecisionPoint,
} from "../csm-orchestrate/lib/decision-adapter/points.mjs";
import {
  createProviderRegistry,
  DEFAULT_PROVIDER_ID,
  PROVIDER_SELECTION_ENV,
} from "../csm-orchestrate/lib/decision-adapter/providers/index.mjs";
import { materialDigest } from "../csm-orchestrate/lib/run-helpers.mjs";
import compiledPoints from "../csm-orchestrate/decision-points.json" with { type: "json" };

const POINT_ID = "route-classification";
const STATE = { request: "route this", candidates: ["csm-scan", "csm-ddd"] };

const bytes = (value) => Buffer.from(JSON.stringify(value));

function providerFixtureSource(id, model = "typesafe/jev-1.13") {
  return `export default {
  id: ${JSON.stringify(id)},
  endpoint: "https://example.invalid/decisions",
  apiKeyEnv: "OPENROUTER_ROUTER_KEY",
  defaultModel: ${JSON.stringify(model)},
  buildRequest: (input) => ({ input }),
  parseResponse: (json) => json,
  classifyError: (status) => String(status),
};
`;
}

async function withProviderDir(t, files) {
  const dir = await mkdtemp(join(tmpdir(), "csm-decision-providers-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source);
  return dir;
}

test("absent, off, and shadow decisions are byte-identical", () => {
  const absent = bytes(noAdapterDecision(POINT_ID, STATE));
  assert.deepEqual(bytes(deterministicDecision(POINT_ID, STATE)), absent);

  const off = createDecisionAdapter({ mode: "off" });
  const shadow = createDecisionAdapter({ mode: "shadow" });
  assert.deepEqual(bytes(off.decide(POINT_ID, STATE)), absent);
  assert.deepEqual(bytes(off.shadow(POINT_ID, STATE)), absent);
  assert.deepEqual(bytes(shadow.decide(POINT_ID, STATE)), absent);
  assert.deepEqual(bytes(shadow.shadow(POINT_ID, STATE)), absent);
  assert.deepEqual(bytes(off.decide(POINT_ID, STATE)), bytes(shadow.decide(POINT_ID, STATE)));

  assert.equal(off.decide(POINT_ID, STATE).applied, false);
  assert.equal(shadow.decide(POINT_ID, STATE).applied, false);
  assert.equal(shadow.applying, false);
});

test("unknown point ids are byte-identical across absent, off, and shadow", () => {
  const unknown = "no-such-decision-point";
  const absent = bytes(noAdapterDecision(unknown, STATE));
  const off = createDecisionAdapter({ mode: "off" });
  const shadow = createDecisionAdapter({ mode: "shadow" });

  assert.doesNotThrow(() => off.decide(unknown, STATE));
  assert.doesNotThrow(() => shadow.decide(unknown, STATE));
  assert.deepEqual(bytes(off.decide(unknown, STATE)), absent);
  assert.deepEqual(bytes(off.shadow(unknown, STATE)), absent);
  assert.deepEqual(bytes(shadow.decide(unknown, STATE)), absent);
  assert.deepEqual(bytes(shadow.shadow(unknown, STATE)), absent);
  assert.deepEqual(bytes(off.decide(unknown, STATE)), bytes(shadow.decide(unknown, STATE)));
});

// T006: a representative invocation request shaped like the one built at
// csm-orchestrate/lib/index.mjs:822-871. Both runtime assignment sites -- the
// primary request at index.mjs:872 and the retry request at index.mjs:1225 --
// call this same `materialDigest`, so the invariant below covers both.
function representativeRequest() {
  return {
    schema: "csm-orchestrate-invocation/2",
    invocationId: "invocation-run-demo",
    parentRunId: "run-demo",
    childRunId: "run-demo-phase-one-node-a-0",
    phaseId: "phase-one",
    edgeId: "edge-node-a",
    skill: "csm-scan",
    skillDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    contractDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    handlerDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    receiptSchemaDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    evidenceSchemaDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    effectiveConfigDigest:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    sideEffects: ["workspace-read"],
    inputArtifactRefs: [{ id: "artifact-in", digest: "sha256:1111" }],
    upstreamArtifactRefs: [{ id: "artifact-upstream", digest: "sha256:2222" }],
    acceptanceSignalIds: ["signal-lint"],
    outputArtifactRefs: [],
    permissions: ["read"],
    approval: {
      schema: "csm-orchestrate-approval/2",
      approvalId: "approval-1",
      scope: ["read"],
      approvedDigest: "sha256:3333",
      approvedAt: "2026-09-19T00:00:00.000Z",
      expiresAt: "2026-09-20T00:00:00.000Z",
    },
    timeoutMs: 60000,
    cancellation: { requested: false },
    retry: { attempt: 1, idempotencyKey: "phase-one:node-a" },
    status: "ready",
    input: { query: "scan this", options: { depth: 2 } },
  };
}

test("the request digest is byte-identical across adapter modes", () => {
  // One request, exercised by every adapter mode in sequence: the adapter has
  // no channel to mutate it, so bytes and digest are unchanged throughout.
  const request = representativeRequest();
  const before = bytes(request);

  const adapters = [
    ["absent", null],
    ["off", createDecisionAdapter({ mode: "off" })],
    ["shadow", createDecisionAdapter({ mode: "shadow" })],
  ];
  const digests = {};
  for (const [name, adapter] of adapters) {
    if (adapter) {
      // Exercise the adapter against the request but never add its output to
      // the request; decision data must never be injected.
      adapter.decide(POINT_ID, request);
      adapter.shadow(POINT_ID, request);
    }
    digests[name] = materialDigest(request);
    assert.deepEqual(bytes(request), before, `request bytes changed under mode ${name}`);
    assert.equal(request.requestDigest, undefined);
  }
  assert.equal(typeof digests.absent, "string");
  assert.equal(digests.absent, digests.off);
  assert.equal(digests.off, digests.shadow);
  assert.deepEqual(bytes(digests.absent), bytes(digests.shadow));
});

test("materialDigest strips exactly status and requestDigest", () => {
  const request = representativeRequest();
  const baseline = materialDigest(request);

  const withStatus = { ...request, status: "blocked" };
  const withRequestDigest = { ...request, requestDigest: "sha256:deadbeef" };
  assert.equal(materialDigest(withStatus), baseline);
  assert.equal(materialDigest(withRequestDigest), baseline);
  assert.equal(materialDigest({ ...withStatus, ...withRequestDigest }), baseline);

  // "Exactly" those two: every other field, including a would-be decision
  // field, perturbs the digest. That is why decision data must never be added.
  assert.notEqual(materialDigest({ ...request, phaseId: "phase-two" }), baseline);
  assert.notEqual(materialDigest({ ...request, skill: "csm-ddd" }), baseline);
  assert.notEqual(materialDigest({ ...request, timeoutMs: 1 }), baseline);
  assert.notEqual(
    materialDigest({
      ...request,
      decision: createDecisionAdapter({ mode: "live" }).decide(POINT_ID, request),
    }),
    baseline,
  );
});

// T006: representative decision-free /2 records. The adapter has no channel to
// mutate them: serializing each record while off and shadow adapters are
// exercised must yield identical bytes.
const REPRESENTATIVE_RECORDS = {
  "csm-plan/2": {
    schema: "csm-plan/2",
    planId: "plan-1",
    status: "draft",
    tasks: [{ id: "T001", title: "example", dependsOn: [] }],
  },
  "csm-build-state/2": {
    schema: "csm-build-state/2",
    planId: "plan-1",
    cursor: { taskId: "T001", attempt: 2 },
    status: "in-progress",
  },
  "csm-review-findings/2": {
    schema: "csm-review-findings/2",
    reportId: "report-1",
    findings: [{ id: "F001", severity: "minor", message: "example" }],
  },
};

test("representative /2 records are byte-identical under off and shadow", () => {
  const modes = [
    ["absent", null],
    ["off", createDecisionAdapter({ mode: "off" })],
    ["shadow", createDecisionAdapter({ mode: "shadow" })],
  ];
  for (const [schema, record] of Object.entries(REPRESENTATIVE_RECORDS)) {
    assert.equal(record.schema, schema);
    let baseline = null;
    for (const [mode, adapter] of modes) {
      if (adapter) {
        adapter.decide(POINT_ID, record);
        adapter.shadow(POINT_ID, record);
      }
      const encoded = bytes(record);
      if (baseline === null) baseline = encoded;
      else assert.deepEqual(encoded, baseline, `${schema} changed under mode ${mode}`);
    }
  }
});

test("an unsupported decision mode is refused", () => {
  assert.doesNotThrow(() => createDecisionAdapter({ mode: "live" }));
  assert.throws(() => createDecisionAdapter({ mode: "apply" }), /unsupported decision mode/);
  assert.throws(() => createDecisionAdapter({ mode: "bogus" }), /unsupported decision mode/);
});

test("the point registry validates and matches decision-points.json", () => {
  assert.deepEqual(compiledPoints, serializeDecisionPoints());
  for (const point of listDecisionPoints()) {
    const result = validateDecisionPoint(point);
    assert.equal(result.valid, true, `${point.id}: ${result.errors.join("; ")}`);
  }
  assert.ok(decisionPoints.some((point) => point.applyVsAdvisory === "apply"));
  assert.ok(decisionPoints.some((point) => point.applyVsAdvisory === "advisory"));
  assert.throws(() => getDecisionPoint("does-not-exist"), /unknown decision point/);
});

test("the validator refuses an apply point that is not non-safety", () => {
  const invalid = {
    ...getDecisionPoint(POINT_ID),
    id: "unsafe-apply",
    safetyClass: "safety",
    applyVsAdvisory: "apply",
  };
  const result = validateDecisionPoint(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /only non-safety/.test(error)));
});

test("the provider registry discovers by naming convention and resolves the default", async (t) => {
  const dir = await withProviderDir(t, {
    "openrouter.mjs": providerFixtureSource("openrouter"),
    "index.mjs": "export default {};\n",
    "NotAnId.mjs": providerFixtureSource("NotAnId"),
    "notes.txt": "ignore me\n",
  });
  const registry = await createProviderRegistry({ providersDir: dir, env: {} });
  assert.deepEqual(registry.ids(), ["openrouter"]);
  assert.deepEqual(
    registry.list().map((descriptor) => descriptor.id),
    ["openrouter"],
  );
  assert.equal(registry.requestedId, DEFAULT_PROVIDER_ID);
  assert.equal(registry.unresolved, false);
  assert.equal(registry.resolve("openrouter").defaultModel, "typesafe/jev-1.13");
  const selection = registry.select();
  assert.equal(selection.unresolved, false);
  assert.equal(selection.id, DEFAULT_PROVIDER_ID);
});

test("an unknown provider id is reported as unresolved", async (t) => {
  const dir = await withProviderDir(t, {
    "openrouter.mjs": providerFixtureSource("openrouter"),
  });
  const registry = await createProviderRegistry({
    providersDir: dir,
    env: { [PROVIDER_SELECTION_ENV]: "vercel" },
  });
  assert.equal(registry.requestedId, "vercel");
  assert.equal(registry.unresolved, true);
  assert.equal(registry.resolve("vercel"), null);
  const selection = registry.select();
  assert.equal(selection.unresolved, true);
  assert.equal(selection.descriptor, null);
  assert.equal(selection.reason, "unknown-provider");
});

test("a blank selection env falls back to the default provider id", async (t) => {
  const dir = await withProviderDir(t, {
    "openrouter.mjs": providerFixtureSource("openrouter"),
  });
  const registry = await createProviderRegistry({
    providersDir: dir,
    env: { [PROVIDER_SELECTION_ENV]: "   " },
  });
  assert.equal(registry.requestedId, DEFAULT_PROVIDER_ID);
  assert.equal(registry.unresolved, false);
});

test("a descriptor whose id disagrees with its filename is quarantined", async (t) => {
  const dir = await withProviderDir(t, {
    "vercel.mjs": providerFixtureSource("openrouter"),
  });
  const reg = await createProviderRegistry({
    providersDir: dir,
    env: { CSM_DECISION_PROVIDER: "vercel" },
  });
  assert.equal(reg.resolve("vercel"), null);
  assert.ok(reg.invalid().some((entry) => entry.id === "vercel"));
  assert.equal(reg.select().unresolved, true);
});
