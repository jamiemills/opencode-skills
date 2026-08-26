import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveArtifactFile } from "../lib/artifact-resolver/index.mjs";
import { loadMachineInput } from "../lib/publication/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { resolveBddInput } from "../csm-build/lib/bdd-input-resolver.mjs";
import { resolveBuildInputs } from "../csm-build/lib/state.mjs";
import { resolvePlanInput } from "../csm-plan/lib/input-resolver.mjs";
import { readPublicationDescriptor } from "../csm-upload/lib/publication.mjs";

const projection = { schema: "csm-projection/1" };

const buildFixture = (name) => async () => {
  const result = await resolveBuildInputs({ [name]: projection });
  assert.equal(result.status, "rejected");
  return result;
};

const feasibleEdges = [
  ["scan -> plan", () => resolvePlanInput("norms", projection)],
  ["scan -> bdd", () => resolveBddInput(projection)],
  ["scan -> build", buildFixture("norms")],
  ["ddd -> build", buildFixture("ddd")],
  ["research -> plan", () => resolvePlanInput("research", projection)],
  ["review -> plan", () => resolvePlanInput("review", projection)],
  ["plan -> bdd", () => resolveBddInput(projection)],
  ["plan -> build", buildFixture("plan")],
  ["bdd-tdd -> build", buildFixture("bdd")],
  ["make-tests -> build", buildFixture("tests")],
  [
    "browse -> upload",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "csm-replay-upload-"));
      try {
        const path = join(root, "projection.json");
        await writeFile(path, JSON.stringify(projection));
        await assert.rejects(() => readPublicationDescriptor(path), {
          code: "invalid-publication",
        });
        return { status: "rejected", code: "invalid-publication" };
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  ],
];

const noRuntimeConsumerEdges = [
  ["scan -> review", "csm-review has no persisted norms input resolver"],
  ["ddd -> plan", "csm-plan consumes DDD pair validation outside a generic resolver"],
  ["research -> grill", "csm-grill has no persisted research input resolver"],
  ["research -> make-tests", "csm-make-tests has no persisted research input resolver"],
  ["review -> grill", "csm-grill has no persisted review input resolver"],
];

test("feasible producer-consumer edges invoke their actual resolver", async () => {
  for (const [edge, invoke] of feasibleEdges) {
    const result = await invoke();
    assert.equal(result.status, "rejected", `${edge} accepted projection input`);
    assert.ok(result.code, `${edge} returned no rejection code`);
  }
});

test("declared edges without runtime consumers reject at the shared boundary", async () => {
  assert.deepEqual(
    noRuntimeConsumerEdges.map(([edge]) => edge),
    [
      "scan -> review",
      "ddd -> plan",
      "research -> grill",
      "research -> make-tests",
      "review -> grill",
    ],
  );
  for (const [edge, reason] of noRuntimeConsumerEdges) {
    const result = await loadMachineInput(projection);
    assert.equal(result.status, "rejected", `${edge} (${reason}) accepted projection input`);
    assert.equal(result.code, "projection-input");
  }
});

test("shared persisted discovery rejects projection, legacy, and untyped paths", async () => {
  const registry = await loadSchemaRegistry();
  const root = await mkdtemp(join(tmpdir(), "csm-replay-boundary-"));
  try {
    await writeFile(join(root, "projection.json"), JSON.stringify(projection));
    await writeFile(join(root, "legacy.md"), "# history");
    await writeFile(join(root, "notes.txt"), "plain text");
    const resolver = (path) => resolveArtifactFile(path, { root, schemaRegistry: registry });
    assert.equal((await resolver("projection.json")).code, "machine-input-rejected");
    assert.equal((await resolver("legacy.md")).code, "legacy-markdown-history");
    assert.equal((await resolver("notes.txt")).code, "unsupported-format");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("raw machine inputs fail before consumer dispatch", async () => {
  for (const input of ["old.md", "old.html", "notes.txt", "plain text"])
    assert.equal((await loadMachineInput(input)).status, "rejected");
});
