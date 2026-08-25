import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMachineInput, validateProjectionDescriptor } from "../lib/publication/index.mjs";

test("machine consumption rejects markdown, html, raw text, and projection descriptors", () => {
  for (const input of [
    "# legacy",
    { "report.md": "x" },
    { "page.html": "x" },
    { schema: "csm-projection/1" },
    { mediaType: "text/html" },
    { nested: { schema: "csm-projection/1" } },
    { nested: { mediaType: "text/markdown" } },
    { nested: { path: "exports/report.md" } },
    { nested: { "exports/page.html": "x" } },
  ])
    assert.throws(() => assertMachineInput(input), { code: "machine-input-rejected" });
});

test("projection descriptors are not discoverable as canonical artifacts", () => {
  assert.throws(() => validateProjectionDescriptor({ schema: "csm-projection/1" }), {
    code: "invalid-projection",
  });
  assert.doesNotThrow(() =>
    assertMachineInput({ schema: "csm-artifact/1", artifactId: "art-json" }),
  );
  assert.doesNotThrow(() =>
    assertMachineInput({ message: "ordinary canonical JSON payload", nested: ["not a file"] }),
  );
});

test("machine consumption rejects cyclic objects and arrays without overflowing the stack", () => {
  const object = {};
  object.nested = object;
  const array = [];
  array.push(array);
  for (const input of [object, { nested: array }])
    assert.throws(() => assertMachineInput(input), { code: "machine-input-rejected" });
});

test("cleanup expires one export without deleting a fresh sibling and ignores malformed metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-publication-negative-"));
  const { DisposableExportStore } = await import("../lib/publication/index.mjs");
  let now = Date.parse("2026-08-25T00:00:00.000Z");
  const store = new DisposableExportStore({ root, ttlMs: 1000, now: () => now });
  const old = await store.put({
    sourceDigest: `sha256:${"a".repeat(64)}`,
    schema: { id: "csm-artifact/1", revision: 1 },
    mediaType: "text/markdown",
    content: "old",
  });
  now += 500;
  const fresh = await store.put({
    sourceDigest: `sha256:${"a".repeat(64)}`,
    schema: { id: "csm-artifact/1", revision: 1 },
    mediaType: "text/html",
    content: "fresh",
  });
  await writeFile(join(root, "malformed.meta"), "not json");
  now += 501;
  assert.equal(await store.cleanup(), 1);
  assert.equal(await store.get(old.key), null);
  assert.equal((await store.get(fresh.key)).content.toString(), "fresh");
  assert.equal(createHash("sha256").update("fresh").digest("hex").length, 64);
});
