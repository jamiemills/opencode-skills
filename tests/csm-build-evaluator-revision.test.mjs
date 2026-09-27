import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuildState, completeBuild } from "../csm-build/lib/state.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const ID = "csm-evaluator-receipt/1";

test("both in-loop producers declare the frozen /1 evaluator receipt", () => {
  for (const rel of ["csm-build/lib/loop-guard.mjs", "csm-review/lib/loop-closure.mjs"]) {
    assert.match(
      read(rel),
      /EVALUATOR_RECEIPT_SCHEMA\s*=\s*"csm-evaluator-receipt\/1"/,
      `${rel} must pin the /1 receipt`,
    );
  }
});

test("the /1 evaluator receipt is registered immutable and schema-pinned", () => {
  const registry = JSON.parse(read("schemas/registry.json"));
  const entry = registry.entries.find((e) => e.id === ID);
  assert.ok(entry, `${ID} is not registered`);
  assert.equal(entry.revision, 1);
  assert.equal(entry.immutable, true);
  const schema = JSON.parse(read(entry.schemaPath));
  assert.equal(schema.$id, ID);
  assert.ok(schema.properties.verdict.enum.includes("complete"));
});

test("csm-build documents the binding evaluated-completion contract", () => {
  const skill = read("csm-build/SKILL.md");
  assert.match(skill, /independent evaluator/);
  assert.match(skill, /loop-guard\.mjs/);
});

const sourcePlan = { digest: `sha256:${"a".repeat(64)}`, artifactId: "plan-t011" };

test("the /1 path is guard-only: it never demands an evaluator receipt", () => {
  const state = createBuildState({ sourcePlan, schemaRevision: 1 });
  let err = null;
  try {
    completeBuild(state, { tasks: [] });
  } catch (e) {
    err = e;
  }
  // A /1 build may be rejected by the pure state machine, but never by the
  // evaluator-receipt rule; flipping requireEvaluator to always-on breaks this.
  if (err) assert.notEqual(err.code, "evaluator-verdict-required");
});

test("the /2 build refuses completion without a binding receipt", () => {
  const state = createBuildState({ sourcePlan, schemaRevision: 2 });
  assert.equal(state.schema, "csm-build-state/2");
  assert.throws(
    () => completeBuild(state, { tasks: [] }),
    (e) => e?.code === "evaluator-verdict-required",
  );
});
