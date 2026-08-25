import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../lib/schema-runtime/index.mjs";
import { renderMarkdown, RENDERER_DIGEST } from "../lib/render-markdown/index.mjs";

const model = {
  schema: "csm-render-model/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  source: { id: "csm-artifact/1", revision: 1 },
  sections: [
    {
      id: "main",
      label: "Main & unsafe",
      items: [
        {
          path: "/text",
          kind: "text",
          label: "Text *",
          accessibleLabel: "Text",
          value: "a * b [c] _d_",
        },
        { path: "/number", kind: "number", label: "Count", accessibleLabel: "Count", value: 2 },
        { path: "/bool", kind: "boolean", label: "Ready", accessibleLabel: "Ready", value: true },
        {
          path: "/date",
          kind: "date",
          label: "Date",
          accessibleLabel: "Date",
          value: "2026-08-25",
        },
        {
          path: "/list",
          kind: "list",
          label: "Items",
          accessibleLabel: "Items",
          value: ["one", "two"],
        },
        {
          path: "/table",
          kind: "table",
          label: "Rows",
          accessibleLabel: "Rows",
          value: [{ z: "last", a: { nested: "first" } }, ["x", "y"]],
        },
        {
          path: "/code",
          kind: "code",
          label: "Code",
          accessibleLabel: "Code",
          language: "js",
          value: "const x = `tick`;",
        },
        {
          path: "/link",
          kind: "link",
          label: "Docs",
          accessibleLabel: "Docs",
          presentation: "text-and-url",
          value: "Docs [here]",
          url: "https://example.test/docs",
        },
        {
          path: "/secret",
          kind: "redacted",
          label: "Secret",
          accessibleLabel: "Secret",
          redacted: true,
        },
      ],
    },
  ],
};
const profile = {
  schema: "csm-render-profile/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  sourceSchema: { id: "csm-artifact/1", revision: 1 },
  fields: [],
  sections: [],
  urlPolicy: { mode: "allowlist", schemes: ["https"] },
};
const projection = {
  projectionId: "proj-markdown-fixture",
  source: {
    artifactId: "art-fixture",
    digest: digest({ fixture: true }),
    schema: { id: "csm-artifact/1", revision: 1 },
  },
  renderer: { id: "csm-render-markdown/1", revision: 1 },
  profile: { id: "csm-render-profile/1", revision: 1 },
  sourceRunId: "run-fixture",
  sourceOwner: "tests",
  rendererDigest: "sha256:414d5b31b467f39b7b0dd74b99e5fb3d72725aa2c6243ca0b6c498f52df2ea97",
  profileDigest: digest(profile),
  generatedAt: "2026-08-25T00:00:00Z",
};

test("renders deterministic typed Markdown and metadata", async () => {
  const first = await renderMarkdown({ model, profile, projection });
  const second = await renderMarkdown({
    model: structuredClone(model),
    profile: structuredClone(profile),
    projection: structuredClone(projection),
  });
  assert.equal(first.markdown, second.markdown);
  assert.match(first.markdown, /> Source: art-fixture \(sha256:/);
  assert.match(first.markdown, /## Main & unsafe/);
  assert.match(first.markdown, /### Text \\\*\n\na \\\* b \\\[c\\] \\_d\\_/);
  assert.match(first.markdown, /```js[\s\S]+```/);
  assert.match(first.markdown, /\[Docs \\\[here\\\]\]\(<https:\/\/example\.test\/docs>\)/);
  assert.match(first.markdown, /nested.*first/);
  assert.doesNotMatch(first.markdown, /Secret\n\n\[REDACTED\]/);
  assert.equal(first.outputDigest, first.projection.outputDigest);
  assert.equal(first.projection.rendererDigest, RENDERER_DIGEST);
  assert.equal(
    first.projection.rendererDigest,
    "sha256:414d5b31b467f39b7b0dd74b99e5fb3d72725aa2c6243ca0b6c498f52df2ea97",
  );
  assert.equal(first.projection.profileDigest, digest(profile));
  assert.deepEqual(first.projection.approval.binding, {
    source: first.projection.source,
    sourceRunId: first.projection.sourceRunId,
    sourceOwner: first.projection.sourceOwner,
    renderer: first.projection.renderer,
    rendererDigest: first.projection.rendererDigest,
    profile: first.projection.profile,
    profileDigest: first.projection.profileDigest,
    outputDigest: first.outputDigest,
  });
});

test("supports marker redaction and text-only links", async () => {
  const result = await renderMarkdown({
    model: {
      ...model,
      sections: [
        {
          ...model.sections[0],
          items: [
            { ...model.sections[0].items[8], value: "[REDACTED]" },
            { ...model.sections[0].items[7], presentation: "text-only", url: undefined },
          ],
        },
      ],
    },
    profile,
    projection,
  });
  assert.match(result.markdown, /### Secret\n\n\[REDACTED\]/);
  assert.match(result.markdown, /### Docs\n\nDocs \\\[here\\\]/);
});

test("rejects hostile HTML, unsafe links, Markdown input, and invalid models", async () => {
  await assert.rejects(
    () =>
      renderMarkdown({
        model: {
          ...model,
          sections: [{ ...model.sections[0], label: "<script>alert(1)</script>" }],
        },
        profile,
        projection,
      }),
    /raw HTML/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model: {
          ...model,
          sections: [
            {
              ...model.sections[0],
              items: [{ ...model.sections[0].items[7], url: "javascript:alert(1)" }],
            },
          ],
        },
        profile,
        projection,
      }),
    /unsafe link/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model: {
          ...model,
          sections: [
            { ...model.sections[0], items: [{ ...model.sections[0].items[7], url: "http://.." }] },
          ],
        },
        profile,
        projection,
      }),
    /unsafe link/,
  );
  await assert.rejects(
    () => renderMarkdown({ model: "# Markdown", profile, projection }),
    /validated csm-render-model/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({ model: { ...model, schema: "csm-render-model/2" }, profile, projection }),
    /validated csm-render-model/,
  );
});

test("requires authentic projection identities and safe ordinary newlines", async () => {
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile,
        projection: { ...projection, renderer: { ...projection.renderer, revision: 2 } },
      }),
    /renderer does not match/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile,
        projection: { ...projection, profile: { id: "csm-render-profile/2", revision: 1 } },
      }),
    /profile does not match/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile,
        projection: { ...projection, rendererDigest: `sha256:${"a".repeat(64)}` },
      }),
    /renderer digest does not match/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile,
        projection: { ...projection, profileDigest: `sha256:${"b".repeat(64)}` },
      }),
    /profile digest does not match/,
  );
  await assert.rejects(
    () => renderMarkdown({ model, profile, projection: { ...projection, sourceRunId: "forged" } }),
    /invalid source run ID/,
  );
  const result = await renderMarkdown({
    model: {
      ...model,
      sections: [
        {
          ...model.sections[0],
          label: "ok\n---",
          items: [{ ...model.sections[0].items[0], label: "label\n---", value: "ok\n---" }],
        },
      ],
    },
    profile,
    projection,
  });
  assert.doesNotMatch(result.markdown, /ok\n---/);
  assert.match(result.markdown, /ok ---/);
});

test("requires a validated profile and enforces its URL policy", async () => {
  await assert.rejects(
    () => renderMarkdown({ model, projection }),
    /validated render profile is required/,
  );
  await assert.rejects(
    () => renderMarkdown({ model, profile: { ...profile, fields: "invalid" }, projection }),
    /render profile failed schema validation/,
  );
  const deniedProfile = { ...profile, urlPolicy: { mode: "deny", schemes: [] } };
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile: deniedProfile,
        projection: { ...projection, profileDigest: digest(deniedProfile) },
      }),
    /unsafe link URL/,
  );
  await assert.rejects(
    () =>
      renderMarkdown({
        model,
        profile: { ...profile, urlPolicy: { mode: "allowlist", schemes: ["http"] } },
        projection,
      }),
    /profile digest does not match/,
  );
});

test("rejects non-JSON nested collection values", async () => {
  await assert.rejects(
    () =>
      renderMarkdown({
        model: {
          ...model,
          sections: [
            {
              ...model.sections[0],
              items: [{ ...model.sections[0].items[4], value: [{ bad: undefined }] }],
            },
          ],
        },
        profile,
        projection,
      }),
    /JSON values/,
  );
});
