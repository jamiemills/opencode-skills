"use strict";

// T008: the deterministic never-Jev boundary guard. Advisory/decision payloads
// must not enter a protected input (digest, receipt, gate, closure, acceptance).

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoAdvisory,
  findAdvisoryPaths,
  guardProtectedInput,
} from "../../csm-orchestrate/lib/decision-adapter/boundary-guard.mjs";

test("a clean protected input passes", () => {
  const clean = {
    requirements: ["R1"],
    evidence: [{ id: "E1", kind: "test", result: "pass" }],
    findings: [{ id: "F1", severity: "high", status: "upheld" }],
  };
  const result = guardProtectedInput(clean, { label: "acceptance" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("a planted advisory object is rejected with its path", () => {
  const dirty = {
    requirements: ["R1"],
    advice: { pointId: "review-challenger-verdict", answer: "agree", providerId: "openrouter" },
  };
  const result = guardProtectedInput(dirty, { label: "receipt" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, ["/advice"]);
  assert.throws(
    () => assertNoAdvisory(dirty, { label: "receipt" }),
    /never-Jev boundary violation/,
  );
});

test("advisory nested in arrays and objects is found", () => {
  const nested = {
    gates: [{ id: "g1", payload: [{ providerId: "vercel", probabilities: { a: 1 } }] }],
  };
  assert.deepEqual(findAdvisoryPaths(nested), ["/gates/0/payload/0"]);
});

test("non-advisory objects that merely carry an answer key are not flagged", () => {
  assert.equal(guardProtectedInput({ answer: "yes" }).ok, true);
  assert.equal(guardProtectedInput({ confidence: 0.9 }).ok, true);
  assert.equal(guardProtectedInput({ pointId: "x" }).ok, true);
});

test("the guard fails closed on deeply nested advice and reports every path", () => {
  const dirty = {
    a: { b: { providerModel: "typesafe/jev-1.13", confidence: 0.2 } },
    list: [{ pointId: "p", answer: "uphold" }],
  };
  const result = guardProtectedInput(dirty);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 2);
});
