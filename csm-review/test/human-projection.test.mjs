import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { publishHumanFindings } from "../lib/human-projection.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const generatedAt = "2026-08-29T09:00:00.000Z";
const readFixture = async () =>
  JSON.parse(await readFile(join(root, "../tests/fixtures/review-json/review-valid.json"), "utf8"));

async function publishFixture(share) {
  return publishHumanFindings({
    payload: await readFixture(),
    share,
    generatedAt,
    projectionId: "proj-review-human",
  });
}

test("share none does not render or publish output", async () => {
  const result = await publishFixture("none");
  assert.equal(result.share, "none");
  assert.deepEqual(result.outputs, {});
  assert.equal(result.persisted, false);
});

test("share markdown and html return their concrete descriptors", async () => {
  const markdown = await publishFixture("markdown");
  const html = await publishFixture("html");
  assert.deepEqual(Object.keys(markdown.outputs), ["markdown"]);
  assert.deepEqual(Object.keys(html.outputs), ["html"]);
  assert.equal(markdown.outputs.markdown.projection.mediaType, "text/markdown");
  assert.equal(html.outputs.html.projection.mediaType, "text/html");
  assert.equal(markdown.outputs.markdown.projection.generatedAt, generatedAt);
  assert.equal(html.outputs.html.projection.generatedAt, generatedAt);
  assert.equal(
    markdown.outputs.markdown.projection.source.digest,
    html.outputs.html.projection.source.digest,
  );
  assert.notEqual(
    markdown.outputs.markdown.projection.renderer.id,
    html.outputs.html.projection.renderer.id,
  );
  assert.notEqual(
    markdown.outputs.markdown.projection.rendererDigest,
    html.outputs.html.projection.rendererDigest,
  );
  assert.notEqual(markdown.outputs.markdown.outputDigest, html.outputs.html.outputDigest);
});

test("share both returns separate linked format descriptors", async () => {
  const result = await publishFixture("both");
  const markdown = result.outputs.markdown.projection;
  const html = result.outputs.html.projection;
  assert.deepEqual(Object.keys(result.outputs).toSorted(), ["html", "markdown"]);
  assert.notEqual(markdown.projectionId, html.projectionId);
  assert.equal(markdown.source.artifactId, "art-review-demo-1");
  assert.equal(markdown.source.digest, html.source.digest);
  assert.equal(markdown.profileDigest, html.profileDigest);
  assert.equal(markdown.generatedAt, html.generatedAt);
  assert.equal(markdown.approval.status, "pending");
  assert.equal(html.approval.status, "pending");
  assert.equal(markdown.status, "untrusted-presentation");
  assert.equal(html.status, "untrusted-presentation");
});

test("identical inputs produce identical output and descriptor bytes", async () => {
  const first = await publishFixture("both");
  const second = await publishFixture("both");
  assert.deepEqual(first, second);
});

test("requires explicit timestamp, IDs, and share mode", async () => {
  const payload = await readFixture();
  await assert.rejects(
    () => publishHumanFindings({ payload, share: "markdown", projectionId: "proj-x" }),
    /generatedAt/,
  );
  await assert.rejects(
    () => publishHumanFindings({ payload, share: "markdown", generatedAt }),
    /projectionId/,
  );
  await assert.rejects(
    () => publishHumanFindings({ payload, generatedAt, projectionId: "proj-x" }),
    /share/,
  );
});
