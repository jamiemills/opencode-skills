import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";

const manifest = await loadCapabilities();
const matrix = JSON.parse(
  await readFile(
    new URL(
      "../.agents/docs/2026-08-30-remove-opencode-proper-t001-route-coverage.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("route matrix covers every manifest skill exactly once", () => {
  const expected = manifest.skills.map(({ skill }) => skill);
  const actual = matrix.routes.map(({ skill }) => skill);
  assert.deepEqual([...new Set(actual)].toSorted(), [...new Set(expected)].toSorted());
  assert.equal(actual.length, expected.length);
  for (const skill of expected) assert.equal(actual.filter((name) => name === skill).length, 1);
});

test("helper-only exports are never declared callable", () => {
  for (const route of matrix.routes) {
    if (!route.entrypoint.helperOnly) continue;
    assert.deepEqual(
      route.entrypoint.callableExports,
      [],
      `${route.skill} exposes a helper as callable`,
    );
    assert.equal(route.complete, false, `${route.skill} helper-only route is complete`);
  }
});

test("unsupported routes cannot be falsely treated as complete", () => {
  for (const route of matrix.routes) {
    if (route.classification !== "unsupported") continue;
    assert.equal(route.complete, false, `${route.skill} unsupported route is complete`);
    assert.notEqual(
      route.runtimeStatus,
      "registered",
      `${route.skill} unsupported route is registered`,
    );
  }
  assert.equal(matrix.coverageDecision.complete, false);
  assert.notEqual(matrix.coverageDecision.status, "COMPLETE");
});

test("coverage classifications and required route evidence are explicit", () => {
  const classifications = new Set([
    "procedural-callable",
    "adapter-required",
    "csm-build-owned",
    "unsupported",
  ]);
  for (const route of matrix.routes) {
    assert.ok(
      classifications.has(route.classification),
      `${route.skill} has unknown classification`,
    );
    assert.ok(route.entrypoint.paths.length > 0, `${route.skill} has no entrypoint inventory`);
    assert.ok(Array.isArray(route.inputSchemas) && route.inputSchemas.length > 0);
    assert.ok(Array.isArray(route.outputSchemas) && route.outputSchemas.length > 0);
    assert.ok(Array.isArray(route.effects) && route.effects.length > 0);
    assert.equal(typeof route.artifactOwnership, "string");
    assert.equal(typeof route.cancellation, "string");
    assert.equal(typeof route.reviewRole, "string");
    assert.equal(typeof route.migrationNotes, "string");
    assert.equal(typeof route.subprocessNetworkBrowser, "object");
  }
});
