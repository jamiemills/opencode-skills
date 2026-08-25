"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import {
  BASES,
  CONFIDENCES,
  CLAIM_KINDS,
  ContractError,
  STATUSES,
  assertAnswerDoesNotOverwriteStatic,
  assertReportMatchesGraph,
  buildAnswer,
  buildClaim,
  buildEvidence,
  buildGraphEnvelope,
  buildReportEnvelope,
  canonicalizeGraph,
  makeEvidenceId,
  serializeGraph,
  validateGraphReferences,
} from "../lib/ddd/contracts.mjs";
import { validateGraph, validateReport } from "../lib/ddd/validate.mjs";

const fixturesDir = new URL("./fixtures/contracts/", import.meta.url);

async function loadFixture(name) {
  return JSON.parse(await readFile(join(fixturesDir.pathname, name), "utf8"));
}

test("valid graph fixtures pass schema validation", async () => {
  for (const name of ["valid-graph.json", "valid-minimal-graph.json"]) {
    const result = await validateGraph(await loadFixture(name));
    assert.deepEqual(result.errors, [], `${name}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.ok, true);
  }
});

test("valid report fixture passes schema validation", async () => {
  const result = await validateReport(await loadFixture("valid-report.json"));
  assert.deepEqual(result.errors, []);
});

test("invalid fixtures fail with a named reason", async () => {
  const cases = [
    ["invalid-bad-status.json", /value not in enum/],
    ["invalid-absolute-path.json", /must not match "not" clause|pattern/],
    ["invalid-hypothesis-observed.json", /value not in enum/],
  ];
  for (const [name, reason] of cases) {
    const result = await validateGraph(await loadFixture(name));
    assert.equal(result.ok, false, `${name} unexpectedly validated`);
    assert.match(result.errors.join("\n"), reason);
  }
  const report = await validateReport(await loadFixture("invalid-report-missing-graphrunid.json"));
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /missing required property "graphRunId"/);
});

test("canonical serializer is byte-stable across runs and input orderings", async () => {
  const graph = await loadFixture("valid-graph.json");
  const first = serializeGraph(graph);
  const second = serializeGraph(graph);
  assert.equal(first, second);
  const shuffled = structuredClone(graph);
  shuffled.nodes.reverse();
  shuffled.claims.reverse();
  shuffled.evidence.reverse();
  assert.equal(serializeGraph(shuffled), first);
  assert.equal(JSON.parse(first).nodes[0].id, "node-planning");
});

test("vocabulary enums are frozen and complete", () => {
  for (const list of [STATUSES, CLAIM_KINDS, BASES, CONFIDENCES]) {
    assert.ok(Object.isFrozen(list));
  }
  assert.ok(STATUSES.includes("observed") && STATUSES.includes("unverified"));
  assert.ok(CLAIM_KINDS.includes("context_hypothesis"));
});

test("runtime vocabulary enums stay synchronized with the graph schema", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../schemas/ddd-graph.schema.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(schema.properties.claims.items.properties.status.enum, [...STATUSES]);
  assert.deepEqual(schema.properties.claims.items.properties.claimKind.enum, [...CLAIM_KINDS]);
  assert.deepEqual(schema.properties.claims.items.properties.basis.enum, [...BASES]);
  assert.deepEqual(schema.properties.claims.items.properties.confidence.enum, [...CONFIDENCES]);
});

test("report finding vocabulary stays synchronized with the graph contract", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../schemas/ddd-report.schema.json", import.meta.url), "utf8"),
  );
  const finding = schema.properties.sections.items.properties.findings.items.properties;
  assert.deepEqual(finding.status.enum, [...STATUSES]);
  assert.deepEqual(finding.basis.enum, [...BASES]);
  assert.deepEqual(finding.confidence.enum, [...CONFIDENCES]);
});

test("evidence IDs are deterministic and path-guarded", () => {
  const input = {
    claimId: "cl-x-0001",
    sourceKind: "declaration",
    path: "src/a.mjs",
    locator: "export:f",
    matchedKey: "f",
  };
  const again = { ...input };
  assert.equal(makeEvidenceId(input), makeEvidenceId(again));
  assert.notEqual(makeEvidenceId(input), makeEvidenceId({ ...input, locator: "export:g" }));
  assert.throws(() => buildEvidence({ ...input, path: "/abs/src/a.mjs" }), ContractError);
});

test("buildClaim rejects context_hypothesis claims with status observed", () => {
  assert.throws(
    () =>
      buildClaim({
        id: "cl-h-0001",
        claimKind: "context_hypothesis",
        status: "observed",
        subject: "s",
        basis: "static_analysis",
        confidence: "low",
      }),
    ContractError,
  );
  const ok = buildClaim({
    id: "cl-h-0002",
    claimKind: "context_hypothesis",
    status: "inferred",
    subject: "s",
    basis: "static_analysis",
    confidence: "low",
  });
  assert.equal(ok.status, "inferred");
});

test("graph reference validation catches dangling IDs", async () => {
  const graph = await loadFixture("valid-graph.json");
  assert.deepEqual(validateGraphReferences(graph).errors, []);
  const danglingEvidence = structuredClone(graph);
  danglingEvidence.claims[0].evidenceIds.push("ev-dddddddddddddddddddddddd");
  assert.deepEqual(validateGraphReferences(danglingEvidence).errors, [
    "claim cl-capability-planning-0001: dangling evidence ID ev-dddddddddddddddddddddddd",
  ]);
  const danglingQuestion = structuredClone(graph);
  danglingQuestion.answers.push(buildAnswer({ questionId: "q-missing", value: "x" }));
  const result = validateGraphReferences(danglingQuestion);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /dangling question ID q-missing/);
});

test("report must cross-reference the graph run ID", async () => {
  const graph = await loadFixture("valid-graph.json");
  const report = await loadFixture("valid-report.json");
  assert.equal(assertReportMatchesGraph(report, graph), true);
  assert.throws(
    () => assertReportMatchesGraph({ ...report, graphRunId: "run-other" }, graph),
    ContractError,
  );
});

test("user answers can never overwrite static-evidence claims", async () => {
  const graph = await loadFixture("valid-graph.json");
  const answer = buildAnswer({
    questionId: "q-boundary-owner-0001",
    subject: "node-planning",
    value: "team-x",
  });
  assert.throws(() => assertAnswerDoesNotOverwriteStatic(graph.claims, answer), ContractError);
  const free = buildAnswer({ questionId: "q-unclaimed", subject: "node-nothing", value: "y" });
  assert.equal(assertAnswerDoesNotOverwriteStatic(graph.claims, free), true);
});

test("envelopes require a run ID and carry format markers", () => {
  assert.throws(() => buildGraphEnvelope({}), ContractError);
  assert.throws(() => buildReportEnvelope({}), ContractError);
  const env = buildGraphEnvelope({ runId: "r1", generatedAt: "t" });
  assert.equal(env.format, "csm-ddd-graph/1");
  const report = buildReportEnvelope({ runId: "r1", generatedAt: "t" });
  assert.equal(report.format, "csm-ddd-report/1");
  assert.equal(report.graphRunId, "r1");
});

test("canonicalizeGraph sorts every ID collection deterministically", async () => {
  const graph = await loadFixture("valid-graph.json");
  const canon = canonicalizeGraph(graph);
  const ids = canon.claims.map((c) => c.id);
  assert.deepEqual(ids, ids.toSorted());
});
