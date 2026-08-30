import assert from "node:assert/strict";
import test from "node:test";
import { digest, loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { HTML_RENDERER_DIGEST, renderHtml } from "../lib/render-html/index.mjs";
import securityFixture from "./fixtures/render-html-security.json" with { type: "json" };

const runtime = await loadSchemaRegistry();
const profile = {
  schema: "csm-render-profile/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  sourceSchema: { id: "csm-artifact/1", revision: 1 },
  fields: [],
  sections: [],
  urlPolicy: { mode: "allowlist", schemes: ["https"] },
};
const model = {
  schema: "csm-render-model/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  source: { id: "csm-artifact/1", revision: 1 },
  sections: [
    {
      id: "__proto__",
      label: "<Section>",
      items: [
        {
          path: "/text",
          kind: "text",
          label: "Text",
          accessibleLabel: "Text value",
          value: "<script>alert(1)</script>",
        },
        { path: "/number", kind: "number", label: "Count", accessibleLabel: "Count", value: 3 },
        {
          path: "/boolean",
          kind: "boolean",
          label: "Enabled",
          accessibleLabel: "Enabled",
          value: true,
        },
        {
          path: "/date",
          kind: "date",
          label: "Date",
          accessibleLabel: "Date",
          value: "2026-08-25",
        },
        {
          path: "/code",
          kind: "code",
          label: "Code",
          accessibleLabel: "Code",
          language: "js",
          value: "</code><script>",
        },
        { path: "/list", kind: "list", label: "List", accessibleLabel: "List", value: ["a", "b"] },
        {
          path: "/table",
          kind: "table",
          label: "Table",
          accessibleLabel: "Table",
          value: [{ name: "A" }],
        },
        {
          path: "/link",
          kind: "link",
          label: "Link",
          accessibleLabel: "Link",
          presentation: "text-and-url",
          value: "https://example.test/a",
          url: "https://example.test/a",
        },
        {
          path: "/redacted",
          kind: "redacted",
          label: "Secret",
          accessibleLabel: "Secret",
          redacted: true,
          value: "[REDACTED]",
        },
      ],
    },
  ],
};

function projectionInput(overrides = {}, renderProfile = profile) {
  return {
    projectionId: "proj-render-html-fixture",
    source: {
      artifactId: securityFixture.sourceArtifactId,
      schema: { id: "csm-artifact/1", revision: 1 },
      digest: securityFixture.sourceDigest,
    },
    sourceRunId: "run-render-html-fixture",
    sourceOwner: "security-test",
    renderer: { id: "csm-render-html/1", revision: 1 },
    profile: renderProfile.profile,
    rendererDigest: HTML_RENDERER_DIGEST,
    profileDigest: digest(renderProfile),
    generatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function render(candidate = model, projection = projectionInput(), renderProfile = profile) {
  return renderHtml({
    model: candidate,
    schemaRegistry: runtime,
    profile: renderProfile,
    projection,
    generatedAt: "2026-08-25T00:00:00.000Z",
  });
}

test("HTML output is deterministic and carries source/profile/renderer metadata", () => {
  const first = render();
  const second = render(structuredClone(model));
  assert.equal(first.html, second.html);
  assert.equal(first.digest, second.digest);
  assert.match(
    first.html,
    new RegExp(`content="${securityFixture.sourceDigest}" name="csm-source-digest"`),
  );
  assert.match(first.html, /content="art-render-html-security" name="csm-source-artifact"/);
  assert.match(first.html, /content="csm-artifact\/1\/1" name="csm-source-schema"/);
  assert.match(first.html, /content="text\/html" name="csm-output-media-type"/);
  assert.match(first.html, /name="csm-profile"/);
  assert.match(first.html, /content="csm-render-profile\/1\/1"/);
  assert.match(first.html, /name="csm-renderer"/);
  assert.match(first.html, /content="csm-render-html\/1\/1"/);
  assert.equal(first.metadata.status, "untrusted-presentation");
});

test("text, attributes, code, and typed values are escaped without raw HTML", () => {
  const { html } = render();
  assert.doesNotMatch(html, /<script|<\/script|onerror=|onload=/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;\/code&gt;&lt;script&gt;/);
  assert.match(html, />true<|>3<|>2026-08-25</);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<table[^>]*>/);
  assert.match(html, /<table aria-labelledby="csm-label-proto-0-table-6">/);
});

test("URL policy rejects unsafe schemes and credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:pass@example.test/private",
    "http://..",
  ]) {
    assert.throws(
      () =>
        render({
          ...model,
          sections: [
            { ...model.sections[0], items: [{ ...model.sections[0].items[7], value: url, url }] },
          ],
        }),
      /unsafe URL/,
    );
  }
  assert.throws(
    () =>
      render({
        ...model,
        sections: [
          {
            ...model.sections[0],
            items: [
              { ...model.sections[0].items[7], value: "//example.test/a", url: "//example.test/a" },
            ],
          },
        ],
      }),
    /schema validation/,
  );
});

test("DOM-clobbering section identifiers are prefixed and attributes are allowlisted", () => {
  const { html } = render();
  assert.match(html, /id="csm-section-proto-0-section-0"/);
  assert.match(html, /id="csm-label-proto-0-text-0"/);
  assert.doesNotMatch(html, /id="__proto__"|name="__proto__"/);
  assert.doesNotMatch(html, /\s(?:onclick|onerror|style|srcdoc)=/i);
});

test("long section and item identities keep readable, collision-resistant IDs", () => {
  const longSection = "section-" + "a".repeat(80);
  const first = render({
    ...model,
    sections: [{ ...model.sections[0], id: longSection + "-one" }],
  });
  const second = render({
    ...model,
    sections: [{ ...model.sections[0], id: longSection + "-two" }],
  });
  const firstId = first.html.match(/<section[^>]*id="([^"]+)"/)?.[1];
  const secondId = second.html.match(/<section[^>]*id="([^"]+)"/)?.[1];
  assert.notEqual(firstId, secondId);
  assert.match(firstId, /^csm-section-section-a{40}-[a-f0-9]{12}$/);
});

test("generated section, heading, and label IDs are unique for duplicate long identities", () => {
  const longSection = "section-" + "a".repeat(80);
  const repeatedItem = { ...model.sections[0].items[0], path: "/" + "b".repeat(80) };
  const result = render({
    ...model,
    sections: [
      { ...model.sections[0], id: longSection, items: [repeatedItem, repeatedItem] },
      { ...model.sections[0], id: longSection, items: [repeatedItem, repeatedItem] },
    ],
  });
  const ids = [...result.html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 9);
  assert.equal(ids.filter((id) => /-[a-f0-9]{12}$/.test(id)).length, 8);
});

test("redaction, CSP, and accessibility structure are explicit", () => {
  const { html } = render();
  assert.match(html, /\[REDACTED\]/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src &#39;none&#39;/);
  assert.match(html, /<title>Rendered projection<\/title>/);
  assert.match(html, /<h1>Rendered projection<\/h1><p[^>]*role="status">/);
  assert.match(html, /<h2 id="csm-heading-proto-0-heading-0">&lt;Section&gt;<\/h2>/);
  assert.match(html, /aria-labelledby="csm-heading-proto-0-heading-0"/);
  assert.match(html, /role="status"/);
});

test("profile omit redaction suppresses its label and value while marker remains visible", () => {
  const renderProfile = {
    ...profile,
    sections: [{ id: "main", label: "Main", order: 0 }],
    fields: [
      {
        path: "/redacted",
        kind: "redacted",
        label: "Secret",
        visibility: "always",
        order: 0,
        section: "main",
        redaction: "omit",
      },
    ],
  };
  const redactedItem = model.sections[0].items[8];
  const omitResult = render(
    {
      ...model,
      sections: [
        { ...model.sections[0], id: "main", items: [{ ...redactedItem, value: undefined }] },
      ],
    },
    projectionInput({}, renderProfile),
    renderProfile,
  );
  assert.doesNotMatch(omitResult.html, /Secret|\[REDACTED\]/);
  assert.doesNotMatch(omitResult.html, /<dt|<dd/);

  const markerProfile = {
    ...renderProfile,
    fields: [{ ...renderProfile.fields[0], redaction: "marker" }],
  };
  const markerResult = render(
    { ...model, sections: [{ ...model.sections[0], id: "main", items: [redactedItem] }] },
    projectionInput({}, markerProfile),
    markerProfile,
  );
  assert.match(markerResult.html, /<dt[^>]*>Secret<\/dt>/);
  assert.match(markerResult.html, /\[REDACTED\]/);
});

test("projection generatedAt is used consistently over the renderer default", () => {
  const projectionGeneratedAt = "2026-08-29T12:34:56.000Z";
  const result = render(model, projectionInput({ generatedAt: projectionGeneratedAt }));
  assert.equal(result.metadata.generatedAt, projectionGeneratedAt);
  assert.equal(result.projection.generatedAt, projectionGeneratedAt);
});

test("only a validated direct render model is accepted", () => {
  assert.throws(
    () => renderHtml({ model: "# Markdown", schemaRegistry: runtime }),
    /render-model object/,
  );
  assert.throws(
    () => renderHtml({ model: { schema: "csm-render-model/2" }, schemaRegistry: runtime }),
    /csm-render-model\/1/,
  );
  assert.throws(
    () => renderHtml({ model: { ...model, extra: true }, schemaRegistry: runtime }),
    /schema validation/,
  );
});

test("projection descriptor is bound to exact HTML bytes and supplied artifact digest", () => {
  const result = render();
  assert.equal(result.outputDigest, result.projection.outputDigest);
  assert.equal(result.digest, result.outputDigest);
  assert.equal(result.projection.source.digest, securityFixture.sourceDigest);
  assert.equal(result.projection.approval.binding.outputDigest, result.outputDigest);
  assert.equal(result.bytes.equals(Buffer.from(result.html, "utf8")), true);
  assert.notEqual(result.projection.source.digest, digest(model));
});

test("projection profile digest must match the validated profile", () => {
  assert.throws(
    () =>
      renderHtml({
        model,
        schemaRegistry: runtime,
        profile,
        projection: {
          ...projectionInput(),
          profileDigest: `sha256:${"0".repeat(64)}`,
        },
      }),
    /profile digest does not match validated render profile/,
  );
});

test("projection renderer digest must match the HTML renderer policy", () => {
  assert.throws(
    () =>
      renderHtml({
        model,
        schemaRegistry: runtime,
        profile,
        projection: {
          ...projectionInput(),
          rendererDigest: `sha256:${"0".repeat(64)}`,
        },
      }),
    /renderer digest does not match HTML renderer policy/,
  );
});

test("projection metadata is strict and uses exact renderer and source references", () => {
  for (const projection of [
    { ...projectionInput(), extra: true },
    { ...projectionInput(), renderer: { id: "csm-render-html/1", revision: 2 } },
    { ...projectionInput(), renderer: { id: "csm-render-html/1", revision: 1, extra: true } },
    { ...projectionInput(), profile: { id: "csm-render-profile/1", revision: 1, extra: true } },
    { ...projectionInput(), source: { ...projectionInput().source, extra: true } },
    {
      ...projectionInput(),
      source: { ...projectionInput().source, schema: { id: "csm-other/1", revision: 1 } },
    },
  ]) {
    assert.throws(
      () => renderHtml({ model, schemaRegistry: runtime, profile, projection }),
      /projection|renderer|profile|source/,
    );
  }
});

test("profile URL policy is required and controls links", () => {
  assert.throws(
    () => renderHtml({ model, schemaRegistry: runtime, projection: undefined }),
    /validated render profile is required/,
  );
  assert.throws(
    () =>
      renderHtml({
        model,
        schemaRegistry: runtime,
        profile: { ...profile, urlPolicy: { mode: "deny", schemes: [] } },
        projection: {
          projectionId: "proj-render-html-fixture",
          source: {
            artifactId: securityFixture.sourceArtifactId,
            schema: { id: "csm-artifact/1", revision: 1 },
            digest: securityFixture.sourceDigest,
          },
          sourceRunId: "run-render-html-fixture",
          sourceOwner: "security-test",
          renderer: { id: "csm-render-html/1", revision: 1 },
          profile: profile.profile,
          rendererDigest: HTML_RENDERER_DIGEST,
          profileDigest: digest({ ...profile, urlPolicy: { mode: "deny", schemes: [] } }),
          generatedAt: "2026-08-25T00:00:00.000Z",
        },
      }),
    /unsafe URL/,
  );
});
