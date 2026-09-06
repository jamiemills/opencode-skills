"use strict";

// T003 verification: lib/request-router.mjs classifyRequest maps representative
// csm-orchestrate-request/1 envelopes onto the routeable skill set. Explicit
// request.kind is authoritative; requestedSignals.capabilities win over text;
// text hints reach conditional-mode skills only (explicit-mode skills such as
// csm-grill/csm-plan/csm-build/csm-upload are never text-selectable); a request
// with no kind and no matching conditional skill fails with a no-route
// TypeError listing the accepted kinds. csm-orchestrate has no self-route.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { classifyRequest } from "../csm-orchestrate/lib/request-router.mjs";

const CAPABILITIES_URL = new URL("../csm-orchestrate/capabilities.json", import.meta.url);

const base = (overrides = {}) => ({
  schema: "csm-orchestrate-request/1",
  schemaRevision: 1,
  requestId: "request-router-matrix",
  runId: "run-20260906t230626z-4f3a9b2c1d8e",
  kind: "research",
  prompt: "Research how to generalize request intake in csm-orchestrate.",
  goalSlug: "request-router-matrix",
  artifactRef: null,
  repo: null,
  ...overrides,
});

const MATRIX = [
  {
    request: base({
      kind: "research",
      prompt: "Research how to build the new intake switch.",
    }),
    expected: "csm-deep-research",
  },
  {
    request: base({
      kind: "grill",
      prompt: "Grill this rough idea before we plan it.",
    }),
    expected: "csm-grill",
  },
  {
    request: base({
      kind: "plan",
      prompt: "Make a plan from the saved approach.",
    }),
    expected: "csm-plan",
  },
  {
    request: base({
      kind: "execute-plan",
      prompt: "Execute the saved parallelism plan.",
    }),
    expected: "csm-build",
  },
  {
    request: base({
      kind: "bdd-tdd",
      prompt: "Add a BDD/TDD package for the validated plan.",
    }),
    expected: "csm-bdd-tdd",
  },
  {
    request: base({
      kind: "review",
      prompt: "Review this repository and deliver a findings report.",
    }),
    expected: "csm-review",
  },
  {
    request: base({
      kind: "review-python",
      prompt: "Run the python doctrine review over the repository.",
    }),
    expected: "csm-review-python",
  },
  {
    request: base({
      kind: "tests",
      prompt: "Generate and maintain the executable test suite.",
    }),
    expected: "csm-make-tests",
  },
  {
    request: base({
      kind: "scan",
      prompt: "Scan the repository for its conventions and norms.",
    }),
    expected: "csm-scan",
  },
  {
    request: base({
      kind: "ddd",
      prompt: "Run a DDD analysis over the repository structure.",
    }),
    expected: "csm-ddd",
  },
  {
    request: base({
      kind: "browse",
      prompt: "Browse the page, log in, and screenshot the result.",
    }),
    expected: "csm-browse",
  },
  {
    request: base({
      kind: "upload",
      prompt: "Upload the validated evidence to the demo site.",
    }),
    expected: "csm-upload",
  },
  {
    request: base({
      kind: "autoresearch",
      prompt: "Autoresearch the declared evaluate function.",
    }),
    expected: "csm-autoresearch",
  },
];

test("classification matrix routes each request kind to its owning skill", () => {
  assert.ok(MATRIX.length >= 10, "matrix must hold at least ten representative requests");
  for (const { request, expected } of MATRIX) {
    const classified = classifyRequest(request);
    assert.equal(classified.kind, request.kind, `kind for ${request.kind}`);
    assert.deepEqual(classified.routes, [expected], `routes for ${request.kind}`);
    assert.deepEqual(classified.signals.capabilities, [expected], `signals for ${request.kind}`);
    assert.deepEqual(classified.signals.inputs, [], `default inputs for ${request.kind}`);
    assert.equal(classified.goalSlug, request.goalSlug);
  }
});

test("explicit-mode skills are never reached by text heuristics alone", () => {
  for (const prompt of [
    "Build a plan for the router and implement this change set.",
    "Please implement this saved plan now.",
  ]) {
    assert.throws(
      () => classifyRequest({ schema: "csm-orchestrate-request/1", prompt }),
      (error) => {
        assert.ok(error instanceof TypeError);
        assert.match(error.message, /no route selected/);
        assert.match(error.message, /accepted kinds are/);
        return true;
      },
    );
  }
});

test("an execute-plan kind routes to csm-build even with an empty prompt", () => {
  const classified = classifyRequest({
    ...base({ kind: "execute-plan", prompt: "" }),
  });
  assert.equal(classified.kind, "execute-plan");
  assert.deepEqual(classified.routes, ["csm-build"]);
  assert.deepEqual(classified.signals.capabilities, ["csm-build"]);
});

test("requestedSignals.capabilities select a skill over contradictory text", () => {
  const classified = classifyRequest({
    ...base({ kind: null, prompt: "Review this repository end to end." }),
    requestedSignals: { capabilities: ["csm-plan"] },
  });
  assert.equal(classified.kind, "plan");
  assert.deepEqual(classified.routes, ["csm-plan"]);
  assert.deepEqual(classified.signals.capabilities, ["csm-plan"]);
});

test("requestedSignals.capabilities can name conditional skills explicitly", () => {
  const classified = classifyRequest({
    ...base({ kind: null, prompt: "Nothing matching here." }),
    requestedSignals: { capabilities: ["csm-scan"] },
  });
  assert.equal(classified.kind, "scan");
  assert.deepEqual(classified.routes, ["csm-scan"]);
});

test("requests with no route fail closed with a no-route TypeError", () => {
  for (const request of [
    base({ kind: null, prompt: "Ship it." }),
    base({ kind: "orchestrate", prompt: "Run csm-orchestrate." }),
    base({ kind: null, prompt: "" }),
  ]) {
    assert.throws(
      () => classifyRequest(request),
      (error) => {
        assert.ok(error instanceof TypeError);
        assert.match(error.message, /accepted kinds are/);
        return true;
      },
    );
  }
});

test("signals.inputs derive from the artifactRef kind", () => {
  const plan = classifyRequest(base({ kind: "execute-plan", artifactRef: "plan" }));
  assert.deepEqual(plan.signals.inputs, ["plan"]);

  const approach = classifyRequest(base({ kind: "research", artifactRef: "approach" }));
  assert.deepEqual(approach.signals.inputs, ["approach"]);

  const absent = classifyRequest(base({ kind: "research", artifactRef: null }));
  assert.deepEqual(absent.signals.inputs, []);

  const planPath = classifyRequest(
    base({ kind: "execute-plan", artifactRef: ".agents/plans/2026-09-06-x-csm.json" }),
  );
  assert.deepEqual(planPath.signals.inputs, ["plan"]);

  const approachPath = classifyRequest(
    base({ kind: "research", artifactRef: ".agents/approaches/2026-09-06-y-approach.json" }),
  );
  assert.deepEqual(approachPath.signals.inputs, ["approach"]);
});

test("goalSlug falls back to a slugified prompt when absent", () => {
  const classified = classifyRequest(
    base({ kind: "research", goalSlug: null, prompt: "Research how to build X." }),
  );
  assert.match(classified.goalSlug, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(classified.goalSlug.length <= 48);
  assert.equal(classified.goalSlug, "research-how-to-build-x");
});

test("requestedSignals.capabilities can never name csm-orchestrate", () => {
  const classified = classifyRequest({
    ...base({ kind: null, prompt: "Research the best router design." }),
    requestedSignals: { capabilities: ["csm-orchestrate"] },
  });
  assert.ok(!classified.routes.includes("csm-orchestrate"));
  assert.ok(!classified.signals.capabilities.includes("csm-orchestrate"));
  assert.ok(!["csm-orchestrate"].includes(classified.kind));
});

test("capability manifest holds 13 skills incl. csm-bdd-tdd and excludes csm-orchestrate", async () => {
  const manifest = JSON.parse(await readFile(CAPABILITIES_URL, "utf8"));
  const skills = manifest.skills.map((entry) => entry.skill);
  assert.equal(skills.length, 13);
  assert.ok(skills.includes("csm-bdd-tdd"));
  assert.ok(!skills.includes("csm-orchestrate"));
  const explicit = manifest.skills
    .filter((entry) => entry.activation.mode === "explicit")
    .map((entry) => entry.skill);
  assert.deepEqual(explicit.toSorted(), ["csm-build", "csm-grill", "csm-plan", "csm-upload"]);
});
