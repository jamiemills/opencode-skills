import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createSchemaRegistry,
  digest,
  loadSchemaRegistry,
  parseJson,
} from "../lib/schema-runtime/index.mjs";

const root = new URL("../", import.meta.url);
const runtime = await loadSchemaRegistry();
const registry = runtime.registry;

test("registry verifies immutable IDs, paths, digests, policies, and aliases", () => {
  assert.equal(registry.revisionPolicy, "immutable");
  assert.equal(registry.unknownRevisionPolicy, "reject");
  assert.equal(new Set(registry.entries.map((entry) => entry.id)).size, registry.entries.length);
  for (const entry of registry.entries) {
    assert.equal(entry.id, `${entry.id.split("/")[0]}/${entry.revision}`);
    assert.match(entry.id, /^csm-[a-z0-9][a-z0-9-]*\/[1-9][0-9]*$/);
    assert.match(entry.schemaContentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(["reject", "opaque-extension"].includes(entry.unknownFieldPolicy));
    if (entry.unknownFieldPolicy === "opaque-extension")
      assert.ok(entry.opaqueExtensionPoints.length > 0);
  }
});

test("registry rejects content changes, duplicate aliases, escaped paths, and unknown revisions", async () => {
  const entries = await Promise.all(
    registry.entries.map(async (entry) => {
      const schema = parseJson(await readFile(new URL(entry.schemaPath, root), "utf8"));
      Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
      return schema;
    }),
  );
  const changed = structuredClone(entries);
  for (const [index, entry] of registry.entries.entries())
    Object.defineProperty(changed[index], "registryPath", {
      value: entry.schemaPath,
      enumerable: false,
    });
  changed[0].title = "tampered";
  assert.throws(
    () => createSchemaRegistry({ registry, schemas: changed, root: process.cwd() }),
    /digest mismatch/,
  );
  assert.throws(() => runtime.resolve("csm-envelope", 2), /unknown schema revision/);
  const duplicate = structuredClone(registry);
  duplicate.entries[1].aliases = [duplicate.entries[0].id];
  assert.throws(
    () => createSchemaRegistry({ registry: duplicate, schemas: entries, root: process.cwd() }),
    /alias collides|duplicate registry alias/,
  );
  const escaped = structuredClone(registry);
  escaped.entries[0].schemaPath = "../outside.json";
  assert.throws(
    () => createSchemaRegistry({ registry: escaped, schemas: entries, root: process.cwd() }),
    /escapes registry root|missing schema/,
  );
  const nonCanonical = structuredClone(registry);
  nonCanonical.entries[0].id = "Csm-envelope/1";
  assert.throws(
    () => createSchemaRegistry({ registry: nonCanonical, schemas: entries, root: process.cwd() }),
    /not canonical/,
  );
});

test("schema loader rejects escaped and absolute paths before schema reads", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "csm-schema-loader-"));
  try {
    const registryPath = join(rootPath, "schemas", "registry.json");
    await mkdir(join(rootPath, "schemas"));
    await writeFile(
      registryPath,
      JSON.stringify({
        format: "csm-schema-registry/1",
        revisionPolicy: "immutable",
        unknownRevisionPolicy: "reject",
        entries: [
          {
            id: "csm-test/1",
            revision: 1,
            schemaPath: "../outside.json",
            aliases: [],
            immutable: true,
            unknownFieldPolicy: "reject",
            schemaContentDigest: `sha256:${"a".repeat(64)}`,
          },
        ],
      }),
    );
    await assert.rejects(
      loadSchemaRegistry({ root: rootPath }),
      /schema path escapes registry root/,
    );

    await writeFile(
      registryPath,
      JSON.stringify({
        format: "csm-schema-registry/1",
        revisionPolicy: "immutable",
        unknownRevisionPolicy: "reject",
        entries: [
          {
            id: "csm-test/1",
            revision: 1,
            schemaPath: "/outside.json",
            aliases: [],
            immutable: true,
            unknownFieldPolicy: "reject",
            schemaContentDigest: `sha256:${"a".repeat(64)}`,
          },
        ],
      }),
    );
    await assert.rejects(
      loadSchemaRegistry({ root: rootPath }),
      /schema path escapes registry root/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("schema loader rejects invalid registry metadata before attempting schema reads", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "csm-schema-loader-"));
  try {
    const registryPath = join(rootPath, "schemas", "registry.json");
    await mkdir(join(rootPath, "schemas"));
    await writeFile(
      registryPath,
      JSON.stringify({
        format: "csm-schema-registry/1",
        revisionPolicy: "immutable",
        unknownRevisionPolicy: "reject",
        entries: [
          {
            id: "csm-invalid/1",
            revision: 1,
            schemaPath: "schemas/does-not-exist.json",
            aliases: [],
            immutable: true,
            unknownFieldPolicy: "reject",
            schemaContentDigest: "not-a-digest",
          },
        ],
      }),
    );
    await assert.rejects(loadSchemaRegistry({ root: rootPath }), /invalid schema content digest/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("registered schema identities resolve exactly and schema digests are canonical", () => {
  for (const entry of runtime.entries) {
    assert.equal(runtime.resolve(entry.id.split("/")[0], entry.revision).id, entry.id);
    assert.equal(entry.schemaContentDigest, digest(entry.schema));
  }
});

test("duplicated shared definitions remain byte-for-byte structurally aligned", () => {
  const byId = new Map(runtime.entries.map((entry) => [entry.id, entry.schema]));
  const envelope = byId.get("csm-envelope/1");
  assert.deepEqual(
    byId.get("csm-artifact/1").$defs.artifactIdentity,
    envelope.$defs.artifactIdentity,
  );
  assert.deepEqual(byId.get("csm-journal-event/1").$defs.diagnostic, envelope.$defs.diagnostic);
  assert.deepEqual(byId.get("csm-diagnostics/1").$defs.diagnostic, envelope.$defs.diagnostic);
  assert.deepEqual(byId.get("csm-projection/1").$defs.runId, envelope.$defs.runId);
});
