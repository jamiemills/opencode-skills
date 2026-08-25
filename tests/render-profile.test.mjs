import assert from "node:assert/strict";
import test from "node:test";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { createRenderModel, validateRenderProfile } from "../lib/render-model/index.mjs";

const runtime = await loadSchemaRegistry();
const sourceSchema = {
  $id: "csm-artifact/1",
  revision: 1,
  title: { type: "object" },
  status: { type: "string" },
  secret: { type: "string" },
  rows: { type: "array" },
  url: { type: "string" },
  source: { type: "string" },
};
const profile = {
  schema: "csm-render-profile/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  sourceSchema: { id: "csm-artifact/1", revision: 1 },
  sections: [
    { id: "main", label: "Main", order: 0 },
    { id: "details", label: "Details", order: 1 },
  ],
  fields: [
    {
      path: "/status",
      kind: "text",
      label: "Status",
      visibility: "always",
      order: 0,
      section: "main",
      accessibleLabel: "Current status",
    },
    {
      path: "/secret",
      kind: "redacted",
      label: "Secret",
      visibility: "always",
      order: 1,
      section: "main",
      redaction: "marker",
    },
    {
      path: "/url",
      kind: "link",
      label: "Source",
      visibility: "if-present",
      order: 0,
      section: "details",
      link: "text-and-url",
    },
  ],
  urlPolicy: { mode: "allowlist", schemes: ["https"] },
};

test("registry contains immutable render profile and model schemas", () => {
  assert.equal(runtime.resolve("csm-render-profile", 1).id, "csm-render-profile/1");
  assert.equal(runtime.resolve("csm-render-model", 1).id, "csm-render-model/1");
});

test("valid profile selects visible fields in deterministic section and field order", () => {
  assert.doesNotThrow(() =>
    validateRenderProfile(profile, { sourceSchema, schemaRegistry: runtime }),
  );
  const result = createRenderModel({
    source: { status: "ok", secret: "do-not-show", url: "https://example.test/a" },
    sourceSchema,
    profile,
    sourceRef: { id: "csm-artifact/1", revision: 1 },
    schemaRegistry: runtime,
  });
  assert.deepEqual(
    result.model.sections.map((section) => section.items.map((item) => item.path)),
    [["/status", "/secret"], ["/url"]],
  );
  assert.equal(result.model.sections[0].items[1].value, "[REDACTED]");
  assert.equal(result.model.sections[0].items[0].accessibleLabel, "Current status");
  assert.equal(
    result.bytes,
    '{"profile":{"id":"csm-render-profile/1","revision":1},"schema":"csm-render-model/1","sections":[{"id":"main","items":[{"accessibleLabel":"Current status","kind":"text","label":"Status","path":"/status","value":"ok"},{"accessibleLabel":"Secret","kind":"redacted","label":"Secret","path":"/secret","redacted":true,"value":"[REDACTED]"}],"label":"Main"},{"id":"details","items":[{"accessibleLabel":"Source","kind":"link","label":"Source","path":"/url","presentation":"text-and-url","url":"https://example.test/a","value":"https://example.test/a"}],"label":"Details"}],"source":{"id":"csm-artifact/1","revision":1}}',
  );
  assert.equal(
    result.bytes,
    createRenderModel({
      source: { url: "https://example.test/a", secret: "x", status: "ok" },
      sourceSchema,
      profile,
      sourceRef: { id: "csm-artifact/1", revision: 1 },
      schemaRegistry: runtime,
    }).bytes,
  );
});

test("invalid profiles fail closed", () => {
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, profile: { id: "unknown/9", revision: 9 } },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /unsupported render profile identity/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, urlPolicy: { mode: "allowlist", schemes: ["javascript"] } },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /unsafe URL policy/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, fields: [...profile.fields, { ...profile.fields[0], path: "/title" }] },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /duplicate field order/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, fields: [{ ...profile.fields[0], path: "/missing" }] },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /schema path does not exist/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, fields: [{ ...profile.fields[0], kind: "raw-html" }] },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /unsupported render construct/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        {
          ...profile,
          fields: [{ ...profile.fields[0], kind: "link" }],
          urlPolicy: { mode: "deny", schemes: [] },
        },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /safe URL policy/,
  );
});

test("source schema and references must preserve their declared identity", () => {
  assert.throws(
    () =>
      validateRenderProfile(profile, {
        sourceSchema: { ...sourceSchema, $id: "csm-other/1" },
        schemaRegistry: runtime,
      }),
    (error) => error.code === "source-schema-mismatch" && error.path === "/sourceSchema",
  );
  assert.throws(
    () =>
      validateRenderProfile(profile, {
        sourceSchema: { ...sourceSchema, revision: 2 },
        schemaRegistry: runtime,
      }),
    (error) => error.code === "invalid-source-schema-identity" && error.path === "/revision",
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, sourceSchema: { id: "csm-other/1", revision: 1 } },
        { sourceSchema, schemaRegistry: runtime },
      ),
    (error) => error.code === "source-schema-mismatch" && error.path === "/sourceSchema",
  );
  assert.throws(
    () =>
      createRenderModel({
        source: { status: "ok" },
        sourceSchema,
        profile,
        sourceRef: { id: "csm-other/1", revision: 1 },
        schemaRegistry: runtime,
      }),
    (error) => error.code === "source-ref-mismatch" && error.path === "/sourceRef",
  );
});

test("no-op profiles fail closed with structured errors", () => {
  for (const candidate of [
    { ...profile, fields: [] },
    { ...profile, sections: [] },
    { ...profile, fields: profile.fields.map((field) => ({ ...field, visibility: "never" })) },
  ]) {
    assert.throws(
      () => validateRenderProfile(candidate, { sourceSchema, schemaRegistry: runtime }),
      (error) => error.code === "empty-render-profile" && Array.isArray(error.errors),
    );
  }
  assert.throws(
    () =>
      createRenderModel({
        source: {},
        sourceSchema,
        profile: {
          ...profile,
          fields: profile.fields.map((field) => ({ ...field, visibility: "if-present" })),
        },
        sourceRef: { id: "csm-artifact/1", revision: 1 },
        schemaRegistry: runtime,
      }),
    (error) => error.code === "empty-render-model" && error.path === "/fields",
  );
});

test("unsafe URLs and missing required accessibility/code metadata are rejected", () => {
  assert.throws(
    () =>
      createRenderModel({
        source: { status: "ok", secret: "x", url: "javascript:alert(1)" },
        sourceSchema,
        profile,
        sourceRef: { id: "csm-artifact/1", revision: 1 },
        schemaRegistry: runtime,
      }),
    /URL rejected/,
  );
  assert.throws(
    () =>
      validateRenderProfile(
        { ...profile, fields: [{ ...profile.fields[0], kind: "code" }] },
        { sourceSchema, schemaRegistry: runtime },
      ),
    /code requires/,
  );
});

test("omit redaction produces a schema-valid deterministic item without a value", () => {
  const result = createRenderModel({
    source: { status: "ok", secret: "x", url: "https://example.test/a" },
    sourceSchema,
    profile: {
      ...profile,
      fields: profile.fields.map((field) =>
        field.kind === "redacted" ? { ...field, redaction: "omit" } : field,
      ),
    },
    sourceRef: { id: "csm-artifact/1", revision: 1 },
    schemaRegistry: runtime,
  });
  const item = result.model.sections[0].items[1];
  assert.equal(Object.hasOwn(item, "value"), false);
  assert.equal(item.redacted, true);
  assert.equal(
    result.bytes,
    createRenderModel({
      source: { secret: "different", status: "ok", url: "https://example.test/a" },
      sourceSchema,
      profile: {
        ...profile,
        fields: profile.fields.map((field) =>
          field.kind === "redacted" ? { ...field, redaction: "omit" } : field,
        ),
      },
      sourceRef: { id: "csm-artifact/1", revision: 1 },
      schemaRegistry: runtime,
    }).bytes,
  );
});

test("typed fields fail before model validation", () => {
  for (const [kind, value] of [
    ["number", "1"],
    ["boolean", 1],
    ["list", {}],
    ["table", ["row"]],
  ]) {
    assert.throws(
      () =>
        createRenderModel({
          source: { status: "ok", secret: "x", url: "https://example.test/a", source: value },
          sourceSchema,
          profile: { ...profile, fields: [{ ...profile.fields[0], path: "/source", kind }] },
          sourceRef: { id: "csm-artifact/1", revision: 1 },
          schemaRegistry: runtime,
        }),
      new RegExp(`${kind} value|table rows`),
    );
  }
  assert.throws(
    () =>
      createRenderModel({
        source: { status: "ok", secret: 1, url: "https://example.test/a" },
        sourceSchema,
        profile,
        sourceRef: { id: "csm-artifact/1", revision: 1 },
        schemaRegistry: runtime,
      }),
    /redacted value/,
  );
});

test("link presentation and canonical URL handling are explicit", () => {
  const textOnly = createRenderModel({
    source: { status: "ok", secret: "x", url: "HTTPS://Example.TEST/a/../b" },
    sourceSchema,
    profile: {
      ...profile,
      fields: profile.fields.map((field) =>
        field.kind === "link" ? { ...field, link: "text-only" } : field,
      ),
    },
    sourceRef: { id: "csm-artifact/1", revision: 1 },
    schemaRegistry: runtime,
  });
  const item = textOnly.model.sections[1].items[0];
  assert.equal(item.presentation, "text-only");
  assert.equal(item.value, "https://example.test/b");
  assert.equal(Object.hasOwn(item, "url"), false);
  for (const url of [
    "https://user:pass@example.test/a",
    "https:///missing-host",
    "http://..",
    "javascript:alert(1)",
  ]) {
    assert.throws(
      () =>
        createRenderModel({
          source: { status: "ok", secret: "x", url },
          sourceSchema,
          profile,
          sourceRef: { id: "csm-artifact/1", revision: 1 },
          schemaRegistry: runtime,
        }),
      /URL|hostname|credentials/,
    );
  }
});

test("public render validation requires a schema registry", () => {
  assert.throws(
    () => validateRenderProfile(profile, { sourceSchema }),
    /schema registry is required/,
  );
  assert.throws(
    () =>
      createRenderModel({
        source: { status: "ok", secret: "x", url: "https://example.test/a" },
        sourceSchema,
        profile,
        sourceRef: { id: "csm-artifact/1", revision: 1 },
      }),
    /schema registry is required/,
  );
});

test("a profile cannot render a path without a source schema", () => {
  assert.throws(
    () =>
      createRenderModel({
        source: { missing: "present" },
        profile: { ...profile, fields: [{ ...profile.fields[0], path: "/missing" }] },
        sourceRef: { id: "csm-artifact/1", revision: 1 },
        schemaRegistry: runtime,
      }),
    /source schema is required/,
  );
});

test("unassigned fields normalize to the first section before uniqueness checks", () => {
  const unassigned = {
    ...profile,
    fields: profile.fields.map((field) =>
      field.path === "/status" ? { ...field, section: undefined, order: 2 } : field,
    ),
  };
  const normalized = validateRenderProfile(unassigned, { sourceSchema, schemaRegistry: runtime });
  assert.deepEqual(
    normalized.fields.map((field) => field.section),
    ["main", "main", "details"],
  );
});
