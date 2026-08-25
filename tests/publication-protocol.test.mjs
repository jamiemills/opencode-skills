import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DisposableExportStore,
  approveProjection,
  bindingFor,
  publish,
  resolveShare,
  validateApproval,
} from "../lib/publication/index.mjs";

const source = {
  artifactId: "art-demo",
  digest: `sha256:${"a".repeat(64)}`,
  schema: { id: "csm-artifact/1", revision: 1 },
};
const base = {
  schema: "csm-projection/1",
  projectionId: "proj-demo",
  source,
  sourceRunId: "run-demo",
  sourceOwner: "owner",
  mediaType: "text/markdown",
  renderer: { id: "csm-render-markdown/1", revision: 1 },
  profile: { id: "csm-render-profile/1", revision: 1 },
  rendererDigest: `sha256:${"b".repeat(64)}`,
  profileDigest: `sha256:${"c".repeat(64)}`,
  outputDigest: `sha256:${"d".repeat(64)}`,
  generatedAt: "2026-08-25T00:00:00.000Z",
  status: "untrusted-presentation",
};
base.approval = {
  status: "pending",
  binding: {
    source,
    sourceRunId: base.sourceRunId,
    sourceOwner: base.sourceOwner,
    renderer: base.renderer,
    rendererDigest: base.rendererDigest,
    profile: base.profile,
    profileDigest: base.profileDigest,
    outputDigest: base.outputDigest,
  },
};
const renderer = (mediaType, text = "projection") => ({
  content: text,
  projection: {
    ...base,
    mediaType,
    outputDigest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    approval: {
      ...base.approval,
      binding: {
        ...base.approval.binding,
        outputDigest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
      },
    },
  },
});
test("interaction and explicit share matrix is fail-closed", () => {
  assert.equal(resolveShare({ interactionMode: "interactive" }), "markdown");
  assert.equal(resolveShare({ interactionMode: "non-interactive" }), "none");
  assert.equal(resolveShare({ interactionMode: "unknown" }), "none");
  assert.equal(resolveShare({ interactionMode: "unknown", share: "both" }), "both");
  assert.equal(resolveShare({ interactionMode: "interactive", share: "none" }), "none");
  assert.equal(resolveShare({ destination: { mediaType: "text/html" } }), "html");
});

test("publication validates descriptors, renders callbacks, and keeps default output transient", async () => {
  const text = "projection";
  const outputDigest = `sha256:${(await import("node:crypto")).createHash("sha256").update(text).digest("hex")}`;
  const result = await publish({
    source,
    interactionMode: "interactive",
    renderers: {
      markdown: () => ({
        content: text,
        projection: {
          ...base,
          outputDigest,
          approval: {
            ...base.approval,
            binding: { ...base.approval.binding, outputDigest },
          },
        },
      }),
    },
  });
  assert.equal(result.persisted, false);
  assert.equal(result.outputs.markdown.outputDigest, outputDigest);
  const html = await publish({
    source,
    share: "html",
    renderers: { html: () => renderer("text/html") },
  });
  assert.equal(html.share, "html");
  const requestedHtml = await publish({
    source,
    htmlRequested: true,
    renderers: { html: () => renderer("text/html") },
  });
  assert.equal(requestedHtml.share, "html");
  assert.deepEqual(Object.keys(requestedHtml.outputs), ["html"]);
  const both = await publish({
    source,
    share: "both",
    renderers: {
      markdown: () => renderer("text/markdown"),
      html: () => renderer("text/html"),
    },
  });
  assert.deepEqual(Object.keys(both.outputs).toSorted(), ["html", "markdown"]);
});

test("approval binds source/schema/run/owner, renderer/profile, and exact output digest", () => {
  const approved = approveProjection({ ...base }, { approvedBy: "human" });
  assert.equal(validateApproval(approved, { ...base }), true);
  assert.equal(
    validateApproval(approved, { ...base, outputDigest: `sha256:${"e".repeat(64)}` }),
    false,
  );
  for (const mutation of [
    { source: { ...source, schema: { id: "csm-artifact/2", revision: 2 } } },
    { renderer: { id: "csm-render-other/1", revision: 1 } },
    { profileDigest: `sha256:${"e".repeat(64)}` },
  ]) {
    const mutated = { ...base, ...mutation };
    assert.equal(validateApproval(approved, mutated), false);
  }
  assert.deepEqual(approved.binding, bindingFor(base));
});

test("approval rejects invalid approvedAt values", () => {
  const approved = approveProjection({ ...base }, { approvedBy: "human" });
  for (const approvedAt of ["", "not-a-date", "2026-02-30T00:00:00.000Z", 0, true, null])
    assert.equal(validateApproval({ ...approved, approvedAt }, { ...base }), false);
});

test("store is digest/version/media keyed, expires, and rejects traversal/symlink reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-publication-"));
  let clock = Date.parse("2026-08-25T00:00:00.000Z");
  const store = new DisposableExportStore({ root, ttlMs: 1000, now: () => clock });
  const record = await store.put({
    sourceDigest: source.digest,
    schema: source.schema,
    mediaType: "text/markdown",
    content: "x",
  });
  assert.match(record.key, /csm-artifact-1-1\/text-markdown\//);
  assert.equal((await store.get(record.key)).content.toString(), "x");
  const metadataPath = `${record.path}.meta`;
  const originalMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
  for (const mutation of [
    { sourceDigest: `sha256:${"e".repeat(64)}` },
    { schema: { id: "csm-artifact/2", revision: 2 } },
    { mediaType: "text/html" },
    { outputDigest: `sha256:${"e".repeat(64)}` },
    { key: `${record.key}-tampered` },
  ]) {
    await writeFile(metadataPath, JSON.stringify({ ...originalMetadata, ...mutation }));
    await assert.rejects(() => store.get(record.key), { code: "path-integrity" });
  }
  await writeFile(metadataPath, JSON.stringify(originalMetadata));
  assert.equal((await store.get(record.key)).content.toString(), "x");
  await assert.rejects(
    () =>
      store.put({
        sourceDigest: source.digest,
        schema: source.schema,
        mediaType: "text/markdown",
        content: "x",
      }),
    { code: "EEXIST" },
  );
  assert.equal((await store.get(record.key)).content.toString(), "x");
  await assert.rejects(() => store.get("../outside"), { code: "path-containment" });
  const cleanupRecord = await store.put({
    sourceDigest: source.digest,
    schema: source.schema,
    mediaType: "text/html",
    content: "y",
  });
  clock += 1001;
  assert.equal(await store.get(record.key), null);
  assert.equal(await store.cleanup(), 1);
  assert.equal(await store.get(cleanupRecord.key), null);
  const link = join(root, "link");
  await symlink(root, link);
  await assert.rejects(() => store.get("link/output"), { code: "path-containment" });
  const symlinkRecord = await store.put({
    sourceDigest: source.digest,
    schema: source.schema,
    mediaType: "text/markdown",
    content: "z",
  });
  await rm(`${symlinkRecord.path}.meta`);
  await symlink(symlinkRecord.path, `${symlinkRecord.path}.meta`);
  await assert.rejects(() => store.get(symlinkRecord.key), { code: "path-containment" });
});

test("cleanup ignores forged expired metadata targeting a fresh sibling", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-publication-"));
  let clock = Date.parse("2026-08-25T00:00:00.000Z");
  const store = new DisposableExportStore({ root, ttlMs: 1000, now: () => clock });
  const fresh = await store.put({
    sourceDigest: source.digest,
    schema: source.schema,
    mediaType: "text/markdown",
    content: "fresh",
  });
  const expired = await store.put({
    sourceDigest: source.digest,
    schema: source.schema,
    mediaType: "text/html",
    content: "expired",
    ttlMs: 1,
  });
  const freshMetadataPath = `${fresh.path}.meta`;
  const freshMetadata = JSON.parse(await readFile(freshMetadataPath, "utf8"));
  await writeFile(
    freshMetadataPath,
    JSON.stringify({
      ...JSON.parse(await readFile(`${expired.path}.meta`, "utf8")),
      expiresAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  clock += 1001;

  assert.equal(await store.cleanup(), 1);
  assert.equal(await readFile(fresh.path, "utf8"), "fresh");
  assert.notDeepEqual(JSON.parse(await readFile(freshMetadataPath, "utf8")), freshMetadata);
});

test("cleanup rejects symlinked descendant directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-publication-"));
  const outside = await mkdtemp(join(tmpdir(), "csm-publication-"));
  const store = new DisposableExportStore({ root });
  await writeFile(join(outside, "marker"), "untouched");
  await mkdir(join(root, "branch"));
  await symlink(outside, join(root, "branch", "descendant"));

  await assert.rejects(() => store.cleanup(), { code: "path-containment" });
  assert.equal(await readFile(join(outside, "marker"), "utf8"), "untouched");
});

test("store rejects a symlinked root before put, get, or cleanup", async () => {
  const target = await mkdtemp(join(tmpdir(), "csm-publication-"));
  const root = join(target, "root-link");
  await symlink(target, root);
  const store = new DisposableExportStore({ root });

  await assert.rejects(
    () =>
      store.put({
        sourceDigest: source.digest,
        schema: source.schema,
        mediaType: "text/markdown",
        content: "x",
      }),
    { code: "path-containment" },
  );
  await assert.rejects(() => store.get("anything"), { code: "path-containment" });
  await assert.rejects(() => store.cleanup(), { code: "path-containment" });
});
