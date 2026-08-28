import assert from "node:assert/strict";
import test from "node:test";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import {
  evaluateActivationPredicate,
  selectRoutes,
} from "../csm-orchestrate/lib/phase-compiler.mjs";

const manifest = await loadCapabilities();
const bySkill = new Map(manifest.skills.map((capability) => [capability.skill, capability]));
const phase = (goal) => ({
  phaseId: "P1",
  title: "P1",
  goal,
  deliverables: ["increment"],
  scope: ["bounded scope"],
  outOfScope: ["unrelated work"],
  constraints: [],
  acceptanceHints: ["deterministic acceptance"],
  dependencies: [],
  context: [],
});

test("evaluateActivationPredicate is exported and evaluates parseable predicates", () => {
  assert.equal(typeof evaluateActivationPredicate, "function");
  const autoresearch = bySkill.get("csm-autoresearch");
  const matching = evaluateActivationPredicate(
    autoresearch,
    phase("declare an evolution region with trusted source and evaluator for the climb"),
    { inputs: ["run contract"] },
  );
  assert.deepEqual(matching, { evaluable: true, activated: true });
  const nonMatching = evaluateActivationPredicate(
    autoresearch,
    phase("mention autoresearch in passing"),
    { inputs: ["run contract"] },
  );
  assert.deepEqual(nonMatching, { evaluable: true, activated: false });
});

test("an explicit term is satisfied by an explicit skill request alone", () => {
  const browse = bySkill.get("csm-browse");
  assert.deepEqual(
    evaluateActivationPredicate(browse, phase("unrelated goal text"), {
      capabilities: ["csm-browse"],
      inputs: ["browser task"],
    }),
    { evaluable: true, activated: true },
  );
  assert.deepEqual(
    evaluateActivationPredicate(browse, phase("unrelated goal text"), { inputs: [] }),
    { evaluable: true, activated: false },
  );
  assert.deepEqual(
    evaluateActivationPredicate(browse, phase("unrelated goal text"), {
      routes: ["csm-browse"],
    }),
    { evaluable: true, activated: true },
  );
  assert.deepEqual(
    evaluateActivationPredicate(browse, phase("unrelated goal text"), {
      "csm-browse": true,
    }),
    { evaluable: true, activated: true },
  );
});

test("or-arms and and-terms combine as declared", () => {
  const capability = {
    skill: "csm-or-test",
    activation: { mode: "conditional", predicate: "alpha beta or gamma delta and epsilon" },
  };
  assert.deepEqual(
    evaluateActivationPredicate(capability, phase("include alpha plus beta here"), {}),
    { evaluable: true, activated: true },
  );
  assert.deepEqual(evaluateActivationPredicate(capability, phase("only alpha is present"), {}), {
    evaluable: true,
    activated: false,
  });
  assert.deepEqual(
    evaluateActivationPredicate(capability, phase("gamma delta and epsilon together"), {}),
    { evaluable: true, activated: true },
  );
  assert.deepEqual(
    evaluateActivationPredicate(capability, phase("gamma delta without the third word"), {}),
    { evaluable: true, activated: false },
  );
  assert.deepEqual(
    evaluateActivationPredicate(
      { ...capability, activation: { mode: "conditional", predicate: "explicit alpha" } },
      phase("nothing relevant"),
      { capabilities: ["csm-or-test"] },
    ),
    { evaluable: true, activated: true },
  );
});

test("a trailing single-word or-arm reads as a phrase continuation, not a standalone arm", () => {
  const capability = {
    skill: "csm-continuation-test",
    activation: {
      mode: "conditional",
      predicate: "repository conventions are needed before planning or review",
    },
  };
  assert.deepEqual(
    evaluateActivationPredicate(
      capability,
      phase("repository conventions are needed before planning or review begins"),
      {},
    ),
    { evaluable: true, activated: true },
  );
  assert.deepEqual(
    evaluateActivationPredicate(capability, phase("a code review is requested"), {}),
    { evaluable: true, activated: false },
  );
});

test("unparseable or absent predicates are not evaluable and fall back to heuristics", () => {
  for (const predicate of ["", "   ", "or", "and evolution", "evolution or", "or and", "@@!!"]) {
    assert.deepEqual(
      evaluateActivationPredicate(
        { skill: "csm-fallback-test", activation: { mode: "conditional", predicate } },
        phase("anything"),
        {},
      ),
      { evaluable: false, activated: false },
      predicate,
    );
  }
  assert.deepEqual(
    evaluateActivationPredicate(
      { skill: "csm-fallback-test", activation: { mode: "conditional" } },
      phase("anything"),
      {},
    ),
    { evaluable: false, activated: false },
  );
  const skills = manifest.skills.map((capability) =>
    capability.skill === "csm-autoresearch"
      ? { ...capability, activation: { mode: "conditional", predicate: "or and" } }
      : capability,
  );
  const selected = selectRoutes(phase("the evaluator will decide"), {
    capabilities: skills,
    signals: { inputs: ["run contract"] },
  });
  assert.ok(
    selected.some((node) => node.skill === "csm-autoresearch"),
    "unparseable predicate falls back to heuristic hint matching",
  );
});

test("parseable predicates are authoritative for non-explicit conditional routing", () => {
  const matchesPredicate = selectRoutes(
    phase("declare an evolution region with trusted source and evaluator"),
    { capabilities: manifest.skills, signals: { inputs: ["run contract"] } },
  );
  assert.ok(matchesPredicate.some((node) => node.skill === "csm-autoresearch"));
  const matchesOldHintOnly = selectRoutes(
    phase("autoresearch evaluator signals while an independent repository audit is required"),
    { capabilities: manifest.skills, signals: { inputs: ["run contract"] } },
  );
  assert.equal(
    matchesOldHintOnly.some((node) => node.skill === "csm-autoresearch"),
    false,
    "text matching only the legacy hint no longer selects a predicate-bearing capability",
  );
  assert.ok(
    matchesOldHintOnly.some((node) => node.skill === "csm-review"),
    "the remaining routable skill is still selected",
  );
});
