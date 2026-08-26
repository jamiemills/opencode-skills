import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createArtifactResolver,
  DEFAULT_ARTIFACT_RESOLVER_LIMITS,
} from "../lib/artifact-resolver/index.mjs";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";

const schemaRegistry = await loadSchemaRegistry();
const base = {
  schema: "csm-artifact/1",
  artifact: {
    artifactId: "art-limit-fixture",
    kind: "resolver.limit-fixture",
    owner: "csm-test",
    runId: "run-limit-fixture",
    digest: digest({ limit: true }),
    createdAt: "2026-08-25T00:00:00.000Z",
    revision: 1,
  },
  contentType: "application/json",
  location: "artifact.json",
  lifecycleStatus: "completed",
};

async function fixture() {
  return mkdtemp(join(tmpdir(), "csm-artifact-resolver-limits-"));
}

function resolver(root, limits = {}) {
  return createArtifactResolver({
    root,
    schemaRegistry,
    edge: { id: "limit-edge", enabled: true },
    owner: "csm-test",
    migrationMode: true,
    limits,
  });
}

async function deterministicFailure(action, code) {
  const results = await Promise.all([action(), action(), action()]);
  assert.ok(results.every((result) => result.code === code));
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
}

async function artifact(root, name, value = base) {
  await writeFile(join(root, name), JSON.stringify(value));
}

test("exports the bounded discovery policy defaults", () => {
  assert.deepEqual(DEFAULT_ARTIFACT_RESOLVER_LIMITS, {
    maxDepth: 8,
    maxFiles: 256,
    maxTotalBytes: 64 * 1024 * 1024,
    maxPerFileBytes: 8 * 1024 * 1024,
    maxJsonlRecords: 1024,
    maxInFlightResolutions: 8,
  });
});

test("rejects limit overrides above the bounded defaults", () => {
  assert.throws(() => resolver("/tmp", { maxPerFileBytes: 64 * 1024 * 1024 }), /bounded default/);
});

test("rejects an oversized tree with deterministic resource-limit", async () => {
  const root = await fixture();
  await artifact(root, "a.json");
  await artifact(root, "b.json");
  await deterministicFailure(() => resolver(root, { maxFiles: 1 }).discover(), "resource-limit");
  const result = await resolver(root, { maxFiles: 1 }).discover();
  assert.equal(result.uncertainty, "capped");
  assert.equal(result.coverage, "unverified");
});

test("rejects JSONL records beyond the configured bound", async () => {
  const root = await fixture();
  const first = { ...base, artifact: { ...base.artifact, artifactId: "one" } };
  const second = { ...base, artifact: { ...base.artifact, artifactId: "two" } };
  await writeFile(
    join(root, "journal.jsonl"),
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
  );
  await deterministicFailure(
    () => resolver(root, { maxJsonlRecords: 1 }).resolve("journal.jsonl"),
    "resource-limit",
  );
});

test("enforces depth, per-file, and total-byte limits", async () => {
  const root = await fixture();
  let nested = root;
  for (let index = 0; index < 3; index += 1) {
    nested = join(nested, `level-${index}`);
    await mkdir(nested);
  }
  await artifact(nested, "deep.json");
  await deterministicFailure(() => resolver(root, { maxDepth: 2 }).discover(), "resource-limit");

  await writeFile(join(root, "large.json"), "x".repeat(20));
  await deterministicFailure(
    () => resolver(root, { maxPerFileBytes: 10 }).resolve("large.json"),
    "resource-limit",
  );

  const totalRoot = await fixture();
  await artifact(totalRoot, "a.json");
  await artifact(totalRoot, "b.json");
  const total = await resolver(totalRoot, {
    maxTotalBytes: JSON.stringify(base).length,
  }).discover();
  await deterministicFailure(
    () => resolver(totalRoot, { maxTotalBytes: JSON.stringify(base).length }).discover(),
    "resource-limit",
  );
  assert.equal(total.code, "resource-limit");
});

test("reports bounded scheduler configuration and preserves normal discovery", async () => {
  const root = await fixture();
  await artifact(root, "b.json", {
    ...base,
    artifact: { ...base.artifact, artifactId: "art-bb" },
  });
  await artifact(root, "a.json", {
    ...base,
    artifact: { ...base.artifact, artifactId: "art-aa" },
  });
  let active = 0;
  let observed = 0;
  let release;
  const barrier = new Promise((resolve) => (release = resolve));
  const resultPromise = createArtifactResolver({
    root,
    schemaRegistry,
    edge: { id: "limit-edge", enabled: true },
    owner: "csm-test",
    migrationMode: true,
    limits: { maxInFlightResolutions: 2 },
    onResolutionStart: async () => {
      active += 1;
      observed = Math.max(observed, active);
      await barrier;
      active -= 1;
    },
  }).discover();
  // The callback mutates observed from the bounded worker pool.
  // oxlint-disable-next-line no-unmodified-loop-condition
  while (observed < 2) await new Promise((resolve) => setImmediate(resolve));
  release();
  const result = await resultPromise;
  assert.equal(result.status, "resolved");
  assert.equal(result.coverage, "complete");
  assert.equal(result.files, 2);
  assert.equal(result.limits.maxInFlightResolutions, 2);
  assert.deepEqual(
    result.artifacts.map(({ path }) => path),
    ["a.json", "b.json"],
  );
  assert.equal(observed, 2);
});

test("preserves symlink rejection and deterministic errors across runs", async () => {
  const root = await fixture();
  await artifact(root, "artifact.json");
  await symlink("artifact.json", join(root, "link.json"));
  const first = await resolver(root).discover();
  const second = await resolver(root).discover();
  assert.equal(first.code, "symlink");
  assert.deepEqual(second, first);
});
