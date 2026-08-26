import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  descriptorDigest,
  digestBytes,
  legacyDigestAdapter,
  payloadDigest,
  validateDigestTaxonomy,
} from "../lib/digest-taxonomy/index.mjs";
import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const registry = await loadSchemaRegistry();
const sha = (value) => `sha256:${value === "wrong" ? "b" : "a"}`.padEnd(71, "0");

function record(overrides = {}) {
  const value = {
    schema: "csm-artifact/1",
    artifact: {
      artifactId: "art-taxonomy",
      kind: "taxonomy.fixture",
      owner: "csm-test",
      runId: "run-taxonomy",
      createdAt: "2026-08-26T00:00:00.000Z",
      revision: 1,
    },
    contentType: "application/json",
    location: "artifact.json",
    lifecycleStatus: "active",
    sourceArtifactIds: ["art-source"],
    sourceDigest: sha("source"),
    ...overrides,
  };
  value.payloadDigest = payloadDigest(value);
  value.descriptorDigest = descriptorDigest(value);
  return value;
}

test("payload and descriptor digests ignore only their own field, not whitespace or key order", () => {
  const first = { b: 2, a: { z: true } };
  const second = { a: { z: true }, b: 2 };
  assert.equal(payloadDigest(first), payloadDigest(second));
  assert.equal(
    descriptorDigest({ ...first, descriptorDigest: "ignored" }),
    descriptorDigest(first),
  );
  assert.notEqual(payloadDigest({ ...first, b: 3 }), payloadDigest(first));
});

test("taxonomy rejects digest confusion, embedded payload mutation, and descriptor metadata mutation", () => {
  const value = record();
  assert.equal(
    validateDigestTaxonomy(value, {
      required: ["payloadDigest", "sourceDigest", "descriptorDigest"],
    }).valid,
    true,
  );
  assert.equal(
    validateDigestTaxonomy({ ...value, payloadDigest: value.sourceDigest }).valid,
    false,
  );
  assert.equal(validateDigestTaxonomy({ ...value, embedded: { changed: true } }).valid, false);
  assert.equal(validateDigestTaxonomy({ ...value, kind: "taxonomy.changed" }).valid, false);
});

test("resolver binds exact file bytes and upstream artifact identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-digest-taxonomy-"));
  const value = record();
  const text = JSON.stringify(value);
  await writeFile(join(root, "artifact.json"), text);
  const resolver = createArtifactResolver({ root, schemaRegistry: registry, owner: "csm-test" });
  const expectedFileDigest = digestBytes(Buffer.from(text));
  assert.equal(
    (
      await resolver.resolve("artifact.json", {
        expectedFileDigest,
        expectedSourceDigest: value.sourceDigest,
        expectedSourceArtifactId: "art-source",
      })
    ).status,
    "resolved",
  );
  await writeFile(join(root, "artifact.json"), `${text} `);
  assert.equal(
    (await resolver.resolve("artifact.json", { expectedFileDigest })).code,
    "digest-mismatch",
  );
  assert.equal(
    (await resolver.resolve("artifact.json", { expectedSourceArtifactId: "art-other" })).code,
    "source-identity-mismatch",
  );
});

test("legacy digest meaning requires an explicit migration adapter", () => {
  assert.equal(legacyDigestAdapter("fileDigest").code, "ambiguous-legacy-digest");
});

test("taxonomy is registered and ambiguous legacy source digests fail by default", () => {
  assert.equal(registry.resolve("csm-digest-taxonomy", 1).schema.$id, "csm-digest-taxonomy/1");
  assert.equal(validateDigestTaxonomy(record(), { required: ["sourceDigest"] }).valid, true);
  assert.equal(
    validateDigestTaxonomy({ digest: sha("legacy") }, { required: ["sourceDigest"] }).valid,
    false,
  );
});

test("resolver rejects missing and incorrect digest fields independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-digest-mutations-"));
  const value = record();
  const write = async (next) => writeFile(join(root, "artifact.json"), JSON.stringify(next));
  const resolve = (options = {}) =>
    createArtifactResolver({ root, schemaRegistry: registry, owner: "csm-test" }).resolve(
      "artifact.json",
      { expectedSourceDigest: value.sourceDigest, ...options },
    );

  const missingPayload = { ...value };
  delete missingPayload.payloadDigest;
  await write(missingPayload);
  assert.equal((await resolve()).code, "payload-digest-required");

  await write({ ...value, payloadDigest: value.sourceDigest });
  assert.equal((await resolve()).code, "payload-digest-mismatch");

  await write({ ...value, descriptorDigest: value.sourceDigest });
  assert.equal((await resolve()).code, "descriptor-digest-mismatch");

  await write(value);
  assert.equal(
    (await resolve({ expectedSourceDigest: sha("wrong") })).code,
    "source-digest-mismatch",
  );
  assert.equal((await resolve({ expectedFileDigest: sha("wrong") })).code, "digest-mismatch");
});

test("default resolver rejects every ambiguous legacy digest alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-legacy-digest-"));
  const value = record();
  for (const legacy of [
    { digest: sha("legacy") },
    { artifact: { digest: sha("legacy") } },
    { provenance: { sourceDigest: sha("legacy") } },
    { sourcePlan: { planDigest: sha("legacy") } },
  ]) {
    await writeFile(join(root, "artifact.json"), JSON.stringify({ ...value, ...legacy }));
    const result = await createArtifactResolver({
      root,
      schemaRegistry: registry,
      owner: "csm-test",
    }).resolve("artifact.json");
    assert.equal(result.code, "ambiguous-legacy-digest");
  }
});
