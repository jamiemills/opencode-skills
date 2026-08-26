import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildInputs } from "../csm-build/lib/state.mjs";

test("build input replay rejects missing, malformed, unknown, projection, and legacy inputs", async () => {
  for (const inputs of [
    {},
    { plan: "plan.md", bdd: "bdd.json", tests: "tests.json", ddd: {}, norms: {} },
    { plan: { schema: "csm-projection/1" }, bdd: {}, tests: {}, ddd: {}, norms: {} },
    { plan: { schema: "csm-plan/99" }, bdd: {}, tests: {}, ddd: {}, norms: {} },
  ]) {
    const result = await resolveBuildInputs(inputs);
    assert.notEqual(result.status, "resolved");
    assert.ok(result.code);
  }
});

test("build input replay refuses untyped DDD and norms records before dispatch", async () => {
  const result = await resolveBuildInputs({
    plan: { schema: "csm-plan/1", artifactId: "plan", digest: `sha256:${"a".repeat(64)}` },
    bdd: { schema: "csm-bdd-tdd-package/1" },
    tests: { schema: "csm-test-package/1" },
    ddd: { artifactId: "ddd" },
    norms: { artifactId: "norms" },
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "input-validation-failed");
});
