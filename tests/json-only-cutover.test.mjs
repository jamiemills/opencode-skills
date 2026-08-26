import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadMachineInput } from "../lib/publication/index.mjs";
import { loadSchemaRegistry, digest } from "../lib/schema-runtime/index.mjs";
import { payloadDigest, descriptorDigest } from "../lib/digest-taxonomy/index.mjs";

const registry = await loadSchemaRegistry();
const artifact = {
  schema: "csm-artifact/1",
  artifact: {
    artifactId: "art-cutover-fixture",
    kind: "cutover.fixture",
    owner: "csm-test",
    runId: "run-cutover-fixture",
    digest: digest({ source: "cutover" }),
    createdAt: "2026-08-25T00:00:00.000Z",
    revision: 1,
  },
  contentType: "application/json",
  location: "artifact.json",
  sourceDigest: digest({ source: "source-lineage" }),
  lifecycleStatus: "completed",
};
artifact.payloadDigest = payloadDigest(artifact);
artifact.descriptorDigest = descriptorDigest(artifact);

test("global discovery resolves registered JSON by default and requires source provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-cutover-"));
  await writeFile(join(root, "artifact.json"), JSON.stringify(artifact));
  const result = await createArtifactResolver({
    root,
    schemaRegistry: registry,
    owner: "csm-test",
  }).discover();
  assert.equal(result.status, "resolved");
  assert.equal(result.artifacts[0].value.artifact.artifactId, artifact.artifact.artifactId);

  await writeFile(
    join(root, "missing-digest.json"),
    JSON.stringify({ ...artifact, artifact: { ...artifact.artifact, digest: undefined } }),
  );
  assert.equal(
    (
      await createArtifactResolver({ root, schemaRegistry: registry }).resolve(
        "missing-digest.json",
      )
    ).code,
    "payload-digest-mismatch",
  );
});

test("machine-input boundary rejects every projection and legacy representation", async () => {
  for (const value of [
    "# markdown",
    "<p>html</p>",
    "plain text",
    { schema: "csm-projection/1" },
    { mediaType: "text/html" },
  ]) {
    const result = await loadMachineInput(value);
    assert.equal(result.status, "rejected");
    assert.ok(
      [
        "migration-required",
        "unsupported-format",
        "projection-input",
        "machine-input-rejected",
      ].includes(result.code),
    );
  }
});

test("explicitly disabled edge is the resolver rollback switch", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-cutover-rollback-"));
  await writeFile(join(root, "artifact.json"), JSON.stringify(artifact));
  const result = await createArtifactResolver({
    root,
    schemaRegistry: registry,
    edge: { id: "rollback", enabled: false },
  }).discover();
  assert.equal(result.code, "edge-opt-in-required");
});
