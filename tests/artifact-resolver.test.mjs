import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertPathWithinRoot, createArtifactResolver } from "../lib/artifact-resolver/index.mjs";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const schemaRegistry = await loadSchemaRegistry();
const base = {
  schema: "csm-artifact/1",
  artifact: {
    artifactId: "art-resolver-fixture",
    kind: "resolver.fixture",
    owner: "csm-test",
    runId: "run-resolver-fixture",
    digest: digest({ fixture: true }),
    createdAt: "2026-08-25T00:00:00.000Z",
    revision: 1,
  },
  contentType: "application/json",
  location: "artifact.json",
  lifecycleStatus: "completed",
};
async function fixture(value = base, name = "artifact.json") {
  const root = await mkdtemp(join(tmpdir(), "csm-artifact-resolver-"));
  await writeFile(join(root, name), JSON.stringify(value));
  return { root, name };
}
const resolver = (root, enabled = true, owner = "csm-test") =>
  createArtifactResolver({ root, schemaRegistry, edge: { id: "test-edge", enabled }, owner });

test("resolves registered JSON and checks digest, owner, and terminal status", async () => {
  const item = await fixture();
  const result = await resolver(item.root).resolve(item.name, {
    expectedDigest: `sha256:${(await import("node:crypto")).createHash("sha256").update(JSON.stringify(base)).digest("hex")}`,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.owner, "csm-test");
  assert.equal(result.terminal, true);
  assert.equal(result.readOnly, true);
  assert.equal(
    (await resolver(item.root).resolve(item.name, { replace: true })).code,
    "terminal-immutable",
  );
  assert.equal(result.records[0].artifact.artifactId, base.artifact.artifactId);
});
test("rejects invalid JSON, unknown versions, projections, and raw text", async () => {
  const item = await fixture("not json");
  assert.equal((await resolver(item.root).resolve(item.name)).code, "invalid-json");
  const unknown = { ...base, schema: "csm-artifact/99" };
  const other = await fixture(unknown);
  assert.equal((await resolver(other.root).resolve(other.name)).code, "unknown-revision");
  assert.equal(resolver(other.root).classify("projection.html").code, "projection-history");
  assert.equal(resolver(other.root).classify("notes.txt").code, "unsupported-format");
});
test("rejects duplicate JSON object keys", async () => {
  const item = await fixture();
  await writeFile(
    join(item.root, item.name),
    `{"schema":"csm-artifact/1","schema":"csm-artifact/1"}`,
  );
  assert.equal((await resolver(item.root).resolve(item.name)).code, "invalid-json");
});
test("rejects owner mismatch, digest mismatch, and identity collisions", async () => {
  const item = await fixture();
  assert.equal(
    (await resolver(item.root, true, "other-owner").resolve(item.name)).code,
    "ownership-mismatch",
  );
  assert.equal(
    (await resolver(item.root).resolve(item.name, { expectedDigest: "sha256:bad" })).code,
    "digest-mismatch",
  );
  const second = { ...base, location: "other.json" };
  await writeFile(join(item.root, "other.json"), JSON.stringify(second));
  assert.equal((await resolver(item.root).discover()).code, "collision");
});
test("rejects traversal, symlinks, and keeps disabled edges opt-in", async () => {
  const item = await fixture();
  assert.equal((await resolver(item.root).resolve("../artifact.json")).code, "path-traversal");
  await symlink(item.name, join(item.root, "link.json"));
  assert.equal((await resolver(item.root).resolve("link.json")).code, "symlink");
  await writeFile(join(item.root, "replacement.json"), JSON.stringify(base));
  await symlink(item.name, join(item.root, "replacement-link.json"));
  assert.equal((await resolver(item.root).resolve("replacement-link.json")).code, "symlink");
  assert.equal((await resolver(item.root, false).resolve(item.name)).code, "edge-opt-in-required");
  assert.equal((await resolver(item.root, false).discover()).status, "disabled");
});

test("rejects symlinked resolver roots and validates legacy path syntax at the boundary", async () => {
  const item = await fixture();
  const rootLink = `${item.root}-link`;
  await symlink(item.root, rootLink);
  assert.equal((await resolver(rootLink).resolve(item.name)).code, "symlink");
  assert.equal((await resolver(item.root).resolve("../history.md")).code, "path-traversal");
  assert.equal(
    (await resolver(item.root).resolve(join(item.root, "history.md"))).code,
    "path-traversal",
  );
});

test("rejects opened paths outside the configured root", async () => {
  const item = await fixture();
  assert.throws(() => assertPathWithinRoot(item.root, join(item.root, "..", "outside.json")), {
    code: "path-containment",
  });
});

test("discover rejects a rejected child instead of returning a resolved set", async () => {
  const item = await fixture();
  await writeFile(join(item.root, "broken.json"), "{not-json");
  const result = await resolver(item.root).discover();
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "invalid-json");
});

test("rejects empty and mixed-owner JSONL while allowing an ownerless journal", async () => {
  const item = await fixture();
  await writeFile(join(item.root, "empty.jsonl"), "\n  \n");
  assert.equal((await resolver(item.root).resolve("empty.jsonl")).code, "invalid-empty-artifact");

  const ownershipRegistry = {
    resolve: () => true,
    validate: () => ({ valid: true, errors: [] }),
  };
  const ownershipResolver = (expectedOwner = null) =>
    createArtifactResolver({
      root: item.root,
      schemaRegistry: ownershipRegistry,
      edge: { id: "ownership-edge", enabled: true },
      owner: expectedOwner,
    });
  const first = { ...base, contentType: "application/jsonl", artifact: { ...base.artifact } };
  const second = {
    ...first,
    eventId: "event-owner-two",
    artifact: { ...first.artifact, artifactId: "art-owner-two", owner: "other-owner" },
  };
  await writeFile(
    join(item.root, "mixed.jsonl"),
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
  );
  assert.equal((await ownershipResolver().resolve("mixed.jsonl")).code, "ownership-mismatch");

  const ownerless = { ...first, artifact: { ...first.artifact } };
  delete ownerless.artifact.owner;
  await writeFile(join(item.root, "ownerless.jsonl"), `${JSON.stringify(ownerless)}\n`);
  const result = await ownershipResolver().resolve("ownerless.jsonl");
  assert.equal(result.status, "resolved");
  assert.equal(result.owner, null);
});
