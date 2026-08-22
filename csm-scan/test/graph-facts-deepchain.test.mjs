import assert from "node:assert/strict";
import { test } from "node:test";

import { tarjanStronglyConnectedComponents } from "../lib/scan/deep/architecture/graph-facts.mjs";

test("T201 graph facts: a 10k-deep linear import chain completes without stack overflow", () => {
  const depth = 10_000;
  const graph = {};
  for (let i = 0; i < depth; i += 1) {
    graph[`src/mod${i}.mjs`] = i + 1 < depth ? [`src/mod${i + 1}.mjs`] : [];
  }
  const result = tarjanStronglyConnectedComponents(graph);
  assert.equal(result.totalComponents, depth);
  assert.equal(result.singletonComponents, depth);
  assert.deepEqual(result.cyclicComponents, []);
});

test("T201 graph facts: cyclic components are still detected after the iterative rewrite", () => {
  const graph = {
    "src/a.mjs": ["src/b.mjs"],
    "src/b.mjs": ["src/c.mjs"],
    "src/c.mjs": ["src/a.mjs"],
    "src/d.mjs": [],
  };
  const result = tarjanStronglyConnectedComponents(graph);
  assert.equal(result.totalComponents, 2);
  assert.equal(result.singletonComponents, 1);
  assert.equal(result.cyclicComponents.length, 1);
  assert.equal(result.cyclicComponents[0].size, 3);
  assert.deepEqual(result.cyclicComponents[0].members, ["src/a.mjs", "src/b.mjs", "src/c.mjs"]);
});
