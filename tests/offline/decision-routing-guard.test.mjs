"use strict";

// G5 repair (review F2): the guarded-routing apply gate has real acceptance
// tests. A Jev decision may apply ONLY when the deterministic router found no
// route or agrees with an existing route; explicit-mode skills are never
// Jev-selectable; an absent/off/shadow adapter resolves to null so routing is
// byte-identical to no adapter.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decisionRouteChoice,
  guardRouteDecision,
  resolveRouteDecision,
} from "../../csm-orchestrate/lib/phase-compiler.mjs";

test("decisionRouteChoice extracts the route from strings and answer shapes", () => {
  assert.equal(decisionRouteChoice("csm-build"), "csm-build");
  assert.equal(decisionRouteChoice({ answer: "csm-plan" }), "csm-plan");
  assert.equal(decisionRouteChoice({ answer: { choice: "csm-review" } }), "csm-review");
  assert.equal(decisionRouteChoice({ route: "csm-grill" }), "csm-grill");
  assert.equal(decisionRouteChoice(null), null);
  assert.equal(decisionRouteChoice({ answer: { type: "noul", noul: true } }), null);
});

test("guard applies a no-route choice and an agreeing choice", () => {
  const noRoute = guardRouteDecision([], { answer: "csm-build" });
  assert.equal(noRoute.applied, true);
  assert.deepEqual(noRoute.routes, ["csm-build"]);
  assert.equal(noRoute.reason, "no-route");

  const agree = guardRouteDecision(["csm-build"], { answer: "csm-build" });
  assert.equal(agree.applied, true);
  assert.deepEqual(agree.routes, ["csm-build"]);
  assert.equal(agree.reason, "agreement");
});

test("guard never overrides an existing deterministic route it disagrees with", () => {
  const result = guardRouteDecision(["csm-plan"], { answer: "csm-build" });
  assert.equal(result.applied, false);
  assert.deepEqual(result.routes, ["csm-plan"]);
  assert.equal(result.reason, "disagreement");
});

test("guard never makes an explicit-mode skill Jev-selectable", () => {
  const result = guardRouteDecision(
    [],
    { answer: "csm-review" },
    {
      explicitSkills: new Set(["csm-review"]),
    },
  );
  assert.equal(result.applied, false);
  assert.deepEqual(result.routes, []);
  assert.equal(result.reason, "explicit-mode");
});

test("guard honours a routingBand hold and a not-selectable skill", () => {
  assert.equal(guardRouteDecision([], { answer: "csm-build", routingBand: "hold" }).applied, false);
  assert.equal(
    guardRouteDecision(
      [],
      { answer: "csm-build" },
      {
        selectableSkills: new Set(["csm-plan"]),
      },
    ).reason,
    "not-selectable",
  );
});

test("resolveRouteDecision fails open to null for absent/off/shadow/broken hooks", async () => {
  assert.equal(await resolveRouteDecision(null, null), null);
  assert.equal(await resolveRouteDecision({ applying: false }, null), null);
  assert.equal(await resolveRouteDecision({ shadowing: true }, null), null);
  const fake = { decide: async () => ({ answer: "csm-build" }) };
  assert.deepEqual(await resolveRouteDecision(fake, {}), { answer: "csm-build" });
  assert.equal(
    await resolveRouteDecision(
      {
        decide: async () => {
          throw new Error("boom");
        },
      },
      {},
    ),
    null,
  );
});
