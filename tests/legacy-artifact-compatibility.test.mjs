import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import compatibilityMatrix from "../schemas/compatibility-matrix.json" with { type: "json" };
import { createCompatibilityRuntime } from "../lib/compatibility-runtime/index.mjs";

const schemaRegistry = await loadSchemaRegistry();
const compatibility = createCompatibilityRuntime({ schemaRegistry, matrix: compatibilityMatrix });

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
  });
  const result = await resolver.resolve("journal.jsonl", { consumerRevision: 1 });
  assert.equal(result.status, "resolved");
  assert.equal(result.records.length, 1);
});
