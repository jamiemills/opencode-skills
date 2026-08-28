import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import compatibilityMatrix from "../schemas/compatibility-matrix.json" with { type: "json" };
import { createCompatibilityRuntime } from "../lib/compatibility-runtime/index.mjs";
import { ORCHESTRATE_COMPATIBILITY_ADAPTERS } from "../csm-orchestrate/lib/compatibility.mjs";
import {
  completeBuild,
  createBuildState,
  transitionBuildState,
  validateBuildState,
} from "../csm-build/lib/state.mjs";

const schemaRegistry = await loadSchemaRegistry();
const compatibility = createCompatibilityRuntime({
  schemaRegistry,
  matrix: compatibilityMatrix,
  adapters: ORCHESTRATE_COMPATIBILITY_ADAPTERS,
});

test("Markdown is immutable history and returns a migration-required result without parsing", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-legacy-"));
  const path = join(root, "history.md");
  await writeFile(path, "# legacy\nnot machine input");
  const resolver = createArtifactResolver({
    root,
    schemaRegistry,
    compatibility,
    edge: { id: "legacy-edge", enabled: true },
    owner: "csm-test",
  });
  const result = await resolver.resolve("history.md");
  assert.deepEqual(
    { status: result.status, code: result.code, readOnly: result.readOnly },
    { status: "migration-required", code: "legacy-markdown-history", readOnly: true },
  );
  assert.equal(result.path, "history.md");
});
test("legacy classification preserves path and owner and does not change global defaults", () => {
  const resolver = createArtifactResolver({
    root: ".",
    schemaRegistry,
    compatibility,
    owner: "csm-test",
  });
  const result = resolver.classify("journals/old.md", { owner: "csm-test" });
  assert.equal(result.status, "migration-required");
  assert.equal(result.owner, "csm-test");
  assert.equal(resolver.classify("old.html").readOnly, true);
});
test("JSONL is opt-in and uses compatibility negotiation when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-jsonl-"));
  const event = {
    schema: "csm-journal-event/1",
    eventId: "evt-resolver-fixture",
    runId: "run-resolver-fixture",
    sequence: 0,
    eventType: "run.started",
    occurredAt: "2026-08-25T00:00:00.000Z",
    lifecycleStatus: "active",
  };
  await writeFile(join(root, "journal.jsonl"), `${JSON.stringify(event)}\n`);
  const resolver = createArtifactResolver({
    root,
    schemaRegistry,
    compatibility,
    edge: { id: "journal-edge", enabled: true },
    requireSourceDigest: false,
  });
  const result = await resolver.resolve("journal.jsonl", { consumerRevision: 1 });
  assert.equal(result.status, "resolved");
  assert.equal(result.records.length, 1);
});
test("nested Markdown paths are still rejected as machine inputs without parsing", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-legacy-nested-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "old-notes.md"), "# deeper legacy\n");
  const resolver = createArtifactResolver({
    root,
    schemaRegistry,
    compatibility,
    edge: { id: "legacy-edge", enabled: true },
    owner: "csm-test",
  });
  const result = await resolver.resolve("docs/old-notes.md");
  assert.deepEqual(
    { status: result.status, code: result.code, readOnly: result.readOnly },
    { status: "migration-required", code: "legacy-markdown-history", readOnly: true },
  );
  assert.equal(result.path, "docs/old-notes.md");
});
test("terminal build artifacts remain immutable", async () => {
  const plan = {
    artifactId: "art-plan",
    path: ".agents/plans/plan.json",
    digest: "sha256:" + "a".repeat(64),
  };
  let state = createBuildState({ runId: "run-terminal", sourcePlan: plan });
  state = transitionBuildState(state, "VALIDATE", { evidence: "validated" });
  state = transitionBuildState(state, "SELECT", { evidence: "selected" });
  state = transitionBuildState(state, "CHECKPOINT", { evidence: "checkpoint" });
  const complete = completeBuild(state, { evidence: [] });
  assert.equal(validateBuildState(complete).valid, true);
  assert.equal(complete.control.currentState, "COMPLETE");
  assert.equal(complete.control.nextTransition, "none (terminal)");
  assert.throws(
    () => transitionBuildState(complete, "SELECT", { evidence: "reopen attempt" }),
    (error) => error.code === "terminal-immutable",
  );
  const blocked = transitionBuildState(state, "BLOCKED", { evidence: "blocked" });
  assert.equal(validateBuildState(blocked).valid, true);
  assert.throws(
    () => transitionBuildState(blocked, "RECOVER", { evidence: "reopen attempt" }),
    (error) => error.code === "terminal-immutable",
  );
});
