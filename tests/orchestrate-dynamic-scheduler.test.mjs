"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import {
  DynamicProposalError,
  assertDynamicModeAllowed,
  compileDynamicPhase,
  validateProposedSet,
} from "../csm-orchestrate/lib/dynamic-scheduler.mjs";

const digest = (char) => `sha256:${char.repeat(64)}`;
const capabilities = {
  skills: [
    {
      skill: "csm-build",
      digest: digest("a"),
      effects: ["workspace-write"],
      approvalClass: "human-and-host",
      bounds: { maxConcurrency: 4, maxDepth: 1, maxAgents: 16, maxItems: 256 },
      decomposition: { strategy: "ready-set", bound: 8 },
    },
    {
      skill: "csm-review",
      digest: digest("b"),
      effects: ["read-only"],
      approvalClass: "none",
      bounds: { maxConcurrency: 2, maxDepth: 1, maxAgents: 16, maxItems: 24 },
      decomposition: { strategy: "dimension-chunk", bound: 24 },
    },
  ],
};
const registry = await loadSchemaRegistry();
const proposal = (nodes, overrides = {}) => ({
  phaseId: "phase-dynamic-audit",
  nodes,
  ...overrides,
});
const context = (extra = {}) => ({
  capabilities,
  approved: true,
  routeKind: "research",
  runId: "run-dynamic-1",
  ...extra,
});
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

test("a valid proposal compiles to canonical phase/2 route nodes the executor consumes", () => {
  const phase = compileDynamicPhase(
    proposal([
      { taskId: "audit-routes", skill: "csm-review" },
      {
        taskId: "fix-routes",
        skill: "csm-build",
        effects: ["workspace-write"],
        dependencies: ["audit-routes"],
      },
    ]),
    context(),
  );
  assert.equal(phase.schema, "csm-orchestrate-phase/2");
  assert.equal(phase.routeNodes.length, 2);
  assert.equal(phase.routeNodes[0].parallelGroup, "read-only");
  assert.equal(phase.routeNodes[1].dependencies.length, 1);
  assert.deepEqual(registry.validate("csm-orchestrate-phase/2", phase).errors, []);
  assert.equal(registry.validate("csm-orchestrate-phase/2", phase).valid, true);
});

test("dynamic mode is refused for the plan/execute-plan route", () => {
  assert.equal(
    codeOf(() =>
      compileDynamicPhase(
        proposal([{ taskId: "t1", skill: "csm-review" }]),
        context({ routeKind: "execute-plan" }),
      ),
    ),
    "dynamic-refused-plan-route",
  );
  assert.equal(
    codeOf(() => assertDynamicModeAllowed({ routeKind: "plan", approved: true })),
    "dynamic-refused-plan-route",
  );
});

test("dynamic mode requires an explicit approval and a declared decomposition policy", () => {
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([{ taskId: "t1", skill: "csm-review" }]),
        context({ approved: false }),
      ),
    ),
    "dynamic-approval-required",
  );
  assert.equal(
    codeOf(() =>
      assertDynamicModeAllowed({
        routeKind: "research",
        approved: true,
        capability: { skill: "csm-scan" },
      }),
    ),
    "dynamic-policy-undeclared",
  );
});

test("proposals are blocked on unknown skills, undeclared effects, and approval gaps", () => {
  assert.equal(
    codeOf(() => validateProposedSet(proposal([{ taskId: "t1", skill: "csm-nope" }]), context())),
    "dynamic-unknown-skill",
  );
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([{ taskId: "t1", skill: "csm-review", effects: ["workspace-write"] }]),
        context(),
      ),
    ),
    "dynamic-undeclared-effect",
  );
  assert.equal(
    codeOf(() =>
      validateProposedSet(proposal([{ taskId: "t1", skill: "csm-orchestrate" }]), context()),
    ),
    "dynamic-unknown-skill",
  );
});

test("proposals are blocked on dependency cycles and unknown dependencies", () => {
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([
          { taskId: "a", skill: "csm-review", dependencies: ["b"] },
          { taskId: "b", skill: "csm-review", dependencies: ["a"] },
        ]),
        context(),
      ),
    ),
    "dynamic-dependency-cycle",
  );
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([{ taskId: "a", skill: "csm-review", dependencies: ["ghost"] }]),
        context(),
      ),
    ),
    "dynamic-unknown-dependency",
  );
});

test("proposals are blocked on per-skill bounds and the total agent budget", () => {
  const three = [
    { taskId: "a", skill: "csm-review" },
    { taskId: "b", skill: "csm-review" },
    { taskId: "c", skill: "csm-review" },
  ];
  assert.equal(
    codeOf(() => validateProposedSet(proposal(three), context())),
    "dynamic-per-skill-bound-exceeded",
  );
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([
          { taskId: "a", skill: "csm-review" },
          { taskId: "b", skill: "csm-build", effects: ["workspace-write"] },
        ]),
        context({ maxAgents: 1 }),
      ),
    ),
    "dynamic-over-budget",
  );
  assert.ok(Object.getPrototypeOf(new DynamicProposalError("x", "y")) instanceof Error);
});

test("malicious proposals fail closed: duplicates, empty sets, and effect escalation", () => {
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        proposal([
          { taskId: "a", skill: "csm-review" },
          { taskId: "a", skill: "csm-review" },
        ]),
        context(),
      ),
    ),
    "dynamic-duplicate-task",
  );
  assert.equal(
    codeOf(() => validateProposedSet(proposal([]), context())),
    "dynamic-proposal-invalid",
  );
  assert.equal(
    codeOf(() => validateProposedSet({ phaseId: "phase-x", nodes: "not-an-array" }, context())),
    "dynamic-proposal-invalid",
  );
  assert.equal(
    codeOf(() =>
      validateProposedSet(proposal([{ skill: "csm-review" }], { phaseId: "bad" }), context()),
    ),
    "dynamic-proposal-invalid",
  );
});

test("a side-effecting skill with no approval class is refused", () => {
  const withEvil = {
    skills: [
      ...capabilities.skills,
      {
        skill: "csm-evil",
        digest: digest("d"),
        effects: ["workspace-write"],
        approvalClass: "none",
        bounds: { maxConcurrency: 1, maxDepth: 0, maxAgents: 1, maxItems: 1 },
        decomposition: { strategy: "fixed", bound: 1 },
      },
    ],
  };
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        {
          phaseId: "phase-dynamic-evil",
          nodes: [{ taskId: "x", skill: "csm-evil", effects: ["workspace-write"] }],
        },
        { ...context(), capabilities: withEvil },
      ),
    ),
    "dynamic-effect-requires-approval",
  );
});

test("a skill without a declared decomposition policy is refused (T006)", () => {
  const withUndeclared = {
    skills: [
      ...capabilities.skills,
      {
        skill: "csm-nodecomp",
        digest: digest("e"),
        effects: ["read-only"],
        approvalClass: "none",
        bounds: { maxConcurrency: 1, maxDepth: 0, maxAgents: 1, maxItems: 1 },
      },
    ],
  };
  const caps = { ...capabilities, skills: withUndeclared.skills };
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        { phaseId: "phase-dynamic-nodecomp", nodes: [{ taskId: "x", skill: "csm-nodecomp" }] },
        { ...context(), capabilities: caps },
      ),
    ),
    "dynamic-policy-undeclared",
  );
});

test("T003r: a real-manifest skill without decomposition (csm-scan) is refused", async () => {
  const { loadCapabilities } = await import("../csm-orchestrate/lib/capabilities.mjs");
  const real = await loadCapabilities();
  assert.equal(
    codeOf(() =>
      validateProposedSet(
        { phaseId: "phase-real-refusal", nodes: [{ taskId: "scan-1", skill: "csm-scan" }] },
        { capabilities: real, approved: true, routeKind: "research" },
      ),
    ),
    "dynamic-policy-undeclared",
  );
});
