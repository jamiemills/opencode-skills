import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  NORMS_PRODUCER_DESCRIPTOR,
  createNormsEnvelope,
  createNormsArtifact,
  serializeNormsArtifact,
  validateNormsArtifact,
} from "../csm-scan/lib/scan/norms.mjs";
import { assertCanonicalOutputPath } from "../csm-scan/lib/scan/write.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dimensions = NORMS_PRODUCER_DESCRIPTOR.dimensions;

function findings() {
  return {
    generated: "2026-08-25",
    repos: [
      {
        overview: { name: "fixture", path: "/tmp/fixture", gitRoot: "/tmp/fixture" },
        deep: dimensions.map(({ id }) => ({
          dimension: id.replace(/^DIM-/, "").replace(/-v1$/, ""),
          signal: "low",
          confidence: "observed",
          coverage: 100,
          findings: {},
        })),
      },
    ],
    global: null,
  };
}

test("csm-scan publishes a strict, complete norms JSON contract", async () => {
  const schema = JSON.parse(
    await readFile(join(ROOT, "csm-scan/schemas/csm-norms.schema.json"), "utf8"),
  );
  assert.equal(schema.$id, "csm-norms/1");
  assert.equal(schema.properties.repositories.items.properties.dimensions.minItems, 17);
  const artifact = createNormsArtifact(findings(), { sourceCommits: ["abcdef12"] });
  assert.equal(validateNormsArtifact(artifact).valid, true);
  assert.equal(
    JSON.parse(serializeNormsArtifact(artifact)).artifactDigest,
    artifact.artifactDigest,
  );
  const envelope = await createNormsEnvelope(artifact);
  const runtime = await import("../lib/schema-runtime/index.mjs").then(({ loadSchemaRegistry }) =>
    loadSchemaRegistry(),
  );
  assert.equal(runtime.validate("csm-envelope/1", envelope).valid, true);
  assert.equal(envelope.contentType, "application/json");
  assert.equal(envelope.payloadSchema.id, "csm-norms/1");
  assert.equal(envelope.artifact.runId, envelope.run.runId);
  assert.equal(artifact.repositories[0].dimensions.length, 17);
  assert.deepEqual(
    artifact.repositories[0].dimensions.map(({ id }) => id),
    dimensions.map(({ id }) => id),
  );
  assert.equal(artifact.source.repositoryCount, 1);
  assert.equal(artifact.repositories[0].source.commit, "abcdef12");
  assert.match(artifact.repositories[0].source.rootIdentity, /^root-[a-f0-9]{24}$/);
  assert.equal(NORMS_PRODUCER_DESCRIPTOR.legacyStatus, "history-only");
});

test("norms validation rejects stale digests and incomplete dimension sets", () => {
  const artifact = createNormsArtifact(findings());
  assert.equal(
    validateNormsArtifact({ ...artifact, artifactDigest: "sha256:" + "0".repeat(64) }).valid,
    false,
  );
  assert.equal(validateNormsArtifact({ ...artifact, repositories: [] }).valid, false);
});

test("norms rejects duplicate, missing, and misordered source dimensions", () => {
  const base = findings();
  for (const mutate of [
    (deep) => deep.splice(0, 1),
    (deep) => deep.splice(1, 0, deep[0]),
    (deep) => deep.splice(0, deep.length, ...deep.toReversed()),
  ]) {
    const broken = structuredClone(base);
    mutate(broken.repos[0].deep);
    assert.throws(() => createNormsArtifact(broken), /dimension/);
  }
});

test("producer descriptor is connected to the registered payload schema", async () => {
  const descriptor = JSON.parse(await readFile(join(ROOT, "csm-scan/norms-producer.json"), "utf8"));
  const registry = JSON.parse(await readFile(join(ROOT, "schemas/registry.json"), "utf8"));
  const entry = registry.entries.find(({ id }) => id === descriptor.schema);
  assert.ok(entry);
  assert.equal(entry.schemaPath, "csm-scan/schemas/csm-norms.schema.json");
  assert.equal(descriptor.canonicalPath, "NORMS.json");
  assert.deepEqual(descriptor.dimensions, undefined);
  assert.equal(descriptor.dimensionCount, NORMS_PRODUCER_DESCRIPTOR.dimensions.length);
});

test("legacy Markdown and HTML paths are rejected as persistence targets", () => {
  for (const path of ["NORMS.md", "NORMS.html"]) {
    assert.throws(
      () => assertCanonicalOutputPath(path),
      (error) => error.code === "unsupported-output-format",
    );
  }
});
