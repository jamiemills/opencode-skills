import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DisposableExportStore } from "../lib/publication/index.mjs";
import { createFindingsRenderModel } from "../csm-review/lib/findings-render.mjs";
import { publishHumanFindings } from "../csm-review/lib/human-projection.mjs";

const fixturePath = join(process.cwd(), "tests/fixtures/review-json/review-valid.json");
const generatedAt = "2026-08-29T09:00:00.000Z";

test("projects validated review findings through concrete publication", async () => {
  const payload = JSON.parse(await readFile(fixturePath, "utf8"));
  const model = await createFindingsRenderModel(payload);
  const root = await mkdtemp(join(tmpdir(), "csm-review-render-"));

  try {
    const store = new DisposableExportStore({ root });
    const result = await publishHumanFindings({
      payload,
      share: "both",
      generatedAt,
      projectionId: "proj-review-e2e",
      publication: { store },
    });
    const markdown = result.outputs.markdown;
    const html = result.outputs.html;

    assert.equal(model.sourceDescriptor.artifactId, payload.artifact.artifactId);
    assert.equal(model.sourceDescriptor.digest, payload.artifact.digest);
    assert.match(markdown.content, /severity: high/);
    assert.match(markdown.content, /status: upheld/);
    assert.match(markdown.content, /evidenceClass: E2/);
    assert.ok(markdown.content.includes("locations: src/app\\.js:12 \\(run\\)"));
    assert.ok(markdown.content.includes("The cited path permits an invalid result\\."));
    assert.ok(markdown.content.includes("Users can receive incorrect output\\."));
    assert.ok(markdown.content.includes("Validate the result before returning it\\."));
    assert.match(markdown.content, /challenge-one: agree/);
    assert.match(markdown.content, /challengeRationale: \\\[REDACTED\\\]/);
    assert.doesNotMatch(markdown.content, /The citation reproduces the issue/);
    assert.doesNotMatch(markdown.content, /retracted/);

    const retractedPayload = structuredClone(payload);
    retractedPayload.findings.unshift({
      ...structuredClone(payload.findings[0]),
      id: "F-002",
      title: "Retracted finding",
      locations: [{ path: "README.md", line: 4 }],
      status: "retracted",
      statusNote: "Retracted after challenge.",
      sortKey: "3:2:2:F-002",
    });
    const retracted = await publishHumanFindings({
      payload: retractedPayload,
      share: "markdown",
      generatedAt,
      projectionId: "proj-review-retracted",
    });
    assert.match(retracted.outputs.markdown.content, /Retracted finding/);
    assert.match(retracted.outputs.markdown.content, /status: retracted/);

    assert.match(html.content, /<h1>Rendered projection<\/h1>/);
    assert.match(html.content, /<h2[^>]*>Findings<\/h2>/);
    assert.match(html.content, /<table[^>]*>[\s\S]*<th scope="col">severity<\/th>/);
    assert.match(html.content, /<th scope="col">status<\/th>/);
    assert.match(html.content, /challenge-one: agree/);
    assert.match(html.content, /\[REDACTED\]/);
    assert.match(html.content, /default-src &#39;none&#39;/);
    assert.match(html.content, /role="status"/);
    assert.doesNotMatch(html.content, /The citation reproduces the issue/);
    assert.doesNotMatch(html.content, /<script|\son[a-z]+=/i);

    for (const [kind, output] of Object.entries({ markdown, html })) {
      assert.equal(output.projection.source.artifactId, payload.artifact.artifactId);
      assert.equal(output.projection.source.digest, payload.artifact.digest);
      assert.equal(output.projection.sourceRunId, payload.artifact.runId);
      assert.equal(output.projection.sourceOwner, payload.artifact.owner);
      assert.equal(output.projection.generatedAt, generatedAt);
      assert.equal(output.projection.status, "untrusted-presentation");
      assert.equal(output.projection.approval.status, "pending");
      assert.match(output.outputDigest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(output.outputDigest, output.projection.outputDigest);
      assert.equal(output.projection.mediaType, kind === "html" ? "text/html" : "text/markdown");
      assert.equal((await store.get(output.storage.key)).content.toString(), output.content);
    }
    assert.equal(markdown.projection.mediaType, "text/markdown");
    assert.equal(html.projection.mediaType, "text/html");
    assert.notEqual(markdown.projection.projectionId, html.projection.projectionId);
    assert.notEqual(markdown.projection.rendererDigest, html.projection.rendererDigest);
    assert.equal(markdown.projection.profileDigest, html.projection.profileDigest);
    assert.equal(markdown.projection.source.digest, html.projection.source.digest);

    const repeated = await publishHumanFindings({
      payload: structuredClone(payload),
      share: "both",
      generatedAt,
      projectionId: "proj-review-e2e",
    });
    assert.deepEqual(
      {
        markdown: [markdown.content, markdown.outputDigest, markdown.projection],
        html: [html.content, html.outputDigest, html.projection],
      },
      {
        markdown: [
          repeated.outputs.markdown.content,
          repeated.outputs.markdown.outputDigest,
          repeated.outputs.markdown.projection,
        ],
        html: [
          repeated.outputs.html.content,
          repeated.outputs.html.outputDigest,
          repeated.outputs.html.projection,
        ],
      },
    );

    for (const share of ["none", "markdown", "html", "both"]) {
      const shared = await publishHumanFindings({
        payload,
        share,
        generatedAt,
        projectionId: `proj-review-${share}`,
      });
      assert.deepEqual(
        Object.keys(shared.outputs).toSorted(),
        share === "none" ? [] : share === "both" ? ["html", "markdown"] : [share],
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
