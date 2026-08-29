"use strict";

import { canonicalize, digest } from "../schema-runtime/index.mjs";

const KINDS = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "table",
  "list",
  "code",
  "link",
  "redacted",
]);
const POINTER = /^(?:$|(?:\/([^~]|~[01])*)+)$/;

function fail(message, path = "", code = "invalid-render-profile") {
  const error = new TypeError(path ? `${message} at ${path}` : message);
  error.code = code;
  error.path = path;
  error.errors = [{ code, path, message }];
  throw error;
}

function pointerParts(path) {
  if (typeof path !== "string" || !POINTER.test(path)) fail("invalid schema path", path);
  return path === ""
    ? []
    : path
        .slice(1)
        .split("/")
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function select(root, path) {
  let value = root;
  for (const part of pointerParts(path)) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part))
      fail("schema path does not exist", path);
    value = value[part];
  }
  return value;
}

function selectOptional(root, path) {
  let value = root;
  for (const part of pointerParts(path)) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part))
      return { present: false, value: undefined };
    value = value[part];
  }
  return { present: true, value };
}

function ensureUniqueOrdered(items, label) {
  const paths = new Set();
  const orders = new Set();
  for (const item of items) {
    if (paths.has(item.path)) fail("duplicate field path", item.path);
    if (orders.has(item.order)) fail(`duplicate ${label} order`, String(item.order));
    paths.add(item.path);
    orders.add(item.order);
  }
}

function resolveRef(registry, ref) {
  const base = ref.id.includes("/") ? ref.id.slice(0, ref.id.lastIndexOf("/")) : ref.id;
  registry.resolve(base, ref.revision);
}

function sourceSchemaIdentity(sourceSchema) {
  if (typeof sourceSchema?.$id !== "string")
    fail("source schema must have a canonical $id", "/$id", "invalid-source-schema-identity");
  if (!Number.isInteger(sourceSchema.revision) || sourceSchema.revision < 1)
    fail(
      "source schema revision must be a positive integer",
      "/revision",
      "invalid-source-schema-identity",
    );
  const match = /^(csm-[a-z0-9][a-z0-9-]*)\/([1-9][0-9]*)$/.exec(sourceSchema.$id);
  if (!match)
    fail("source schema must have a canonical $id", "/$id", "invalid-source-schema-identity");
  if (Number(match[2]) !== sourceSchema.revision)
    fail(
      "source schema $id and revision must match",
      "/revision",
      "invalid-source-schema-identity",
    );
  return { id: sourceSchema.$id, revision: sourceSchema.revision };
}

function sameIdentity(left, right) {
  return (
    left &&
    right &&
    typeof left === "object" &&
    !Array.isArray(left) &&
    Object.keys(left).length === 2 &&
    left.id === right.id &&
    left.revision === right.revision
  );
}

function validHostname(hostname) {
  return (
    hostname && !hostname.startsWith(".") && !hostname.endsWith(".") && !hostname.includes("..")
  );
}

export function validateRenderProfile(profile, { sourceSchema, schemaRegistry } = {}) {
  if (!schemaRegistry || typeof schemaRegistry.validate !== "function")
    fail("schema registry is required");
  if (!sourceSchema || typeof sourceSchema !== "object" || Array.isArray(sourceSchema))
    fail("source schema is required");
  if (!profile || profile.schema !== "csm-render-profile/1")
    fail("unsupported render profile schema");
  if (!profile.profile || profile.profile.id !== "csm-render-profile/1")
    fail("unsupported render profile identity", "/profile");
  if (
    !profile.urlPolicy ||
    (profile.urlPolicy.mode !== "deny" && profile.urlPolicy.mode !== "allowlist")
  )
    fail("unsafe URL policy", "/urlPolicy");
  if (
    profile.urlPolicy.mode === "allowlist" &&
    (!profile.urlPolicy.schemes?.length ||
      profile.urlPolicy.schemes.some((scheme) => !["http", "https"].includes(scheme)))
  )
    fail("unsafe URL policy", "/urlPolicy/schemes");
  if (!Array.isArray(profile.fields) || !Array.isArray(profile.sections))
    fail("profile fields and sections are required");
  const firstSection = profile.sections[0]?.id;
  const fields = profile.fields.map((field) =>
    field.section === undefined ? { ...field, section: firstSection } : field,
  );
  const normalizedProfile = { ...profile, fields };
  const sourceSchemaRef = sourceSchemaIdentity(sourceSchema);
  if (!sameIdentity(profile.sourceSchema, sourceSchemaRef))
    fail(
      "profile source schema does not match supplied source schema",
      "/sourceSchema",
      "source-schema-mismatch",
    );
  normalizedProfile.sourceSchema = { ...profile.sourceSchema };
  if (fields.length === 0 || profile.sections.length === 0)
    fail("render profile must contain fields and sections", "", "empty-render-profile");
  if (fields.every((field) => field.visibility === "never"))
    fail("render profile has no visible fields", "/fields", "empty-render-profile");
  const fieldsBySection = new Map();
  for (const field of fields) {
    const section = field.section;
    if (!fieldsBySection.has(section)) fieldsBySection.set(section, []);
    fieldsBySection.get(section).push(field);
  }
  for (const sectionFields of fieldsBySection.values()) ensureUniqueOrdered(sectionFields, "field");
  const sectionIds = new Set();
  const sectionOrders = new Set();
  for (const section of profile.sections) {
    if (sectionIds.has(section.id) || sectionOrders.has(section.order))
      fail("duplicate section ordering", section.id);
    sectionIds.add(section.id);
    sectionOrders.add(section.order);
  }
  for (const field of fields) {
    if (!KINDS.has(field.kind)) fail("unsupported render construct", `/fields/${field.path}`);
    if (field.section && !sectionIds.has(field.section)) fail("unknown section", field.section);
    if (field.kind === "link" && profile.urlPolicy.mode !== "allowlist")
      fail("link requires safe URL policy", field.path);
    if (field.kind === "code" && !field.codeLanguage) fail("code requires a language", field.path);
    if (field.kind === "redacted" && !field.redaction)
      fail("redaction presentation is required", field.path);
    if (sourceSchema) select(sourceSchema, field.path);
  }
  const result = schemaRegistry.validate("csm-render-profile/1", normalizedProfile);
  if (!result.valid)
    fail("render profile does not match its schema", result.errors[0]?.instancePath);
  resolveRef(schemaRegistry, normalizedProfile.profile);
  resolveRef(schemaRegistry, normalizedProfile.sourceSchema);
  return normalizedProfile;
}

export function createRenderModel({ source, sourceSchema, profile, sourceRef, schemaRegistry }) {
  const validatedProfile = validateRenderProfile(profile, { sourceSchema, schemaRegistry });
  if (!sameIdentity(sourceRef, validatedProfile.sourceSchema))
    fail(
      "source schema reference does not match profile source schema",
      "/sourceRef",
      "source-ref-mismatch",
    );
  resolveRef(schemaRegistry, sourceRef);
  const sections = [...validatedProfile.sections]
    .toSorted((a, b) => a.order - b.order)
    .map((section) => ({
      id: section.id,
      label: section.label,
      items: validatedProfile.fields
        .filter((field) => field.section === section.id)
        .toSorted((a, b) => a.order - b.order)
        .flatMap((field) => {
          if (field.visibility === "never") return [];
          const selected =
            field.visibility === "if-present"
              ? selectOptional(source, field.path)
              : { present: true, value: select(source, field.path) };
          if (!selected.present || (field.visibility === "if-present" && selected.value === null))
            return [];
          const value = selected.value;
          const item = {
            path: field.path,
            kind: field.kind,
            label: field.label,
            accessibleLabel: field.accessibleLabel ?? field.label,
            value,
          };
          if (field.kind === "redacted") {
            if (typeof value !== "string") fail("redacted value must be a string", field.path);
            item.value = field.redaction === "omit" ? undefined : "[REDACTED]";
            item.redacted = true;
          }
          if (["text", "date", "code"].includes(field.kind) && typeof value !== "string")
            fail(`${field.kind} value must be a string`, field.path);
          if (field.kind === "number" && (typeof value !== "number" || !Number.isFinite(value)))
            fail("number value must be a finite number", field.path);
          if (field.kind === "boolean" && typeof value !== "boolean")
            fail("boolean value must be a boolean", field.path);
          if (["list", "table"].includes(field.kind) && !Array.isArray(value))
            fail(`${field.kind} value must be an array`, field.path);
          if (
            field.kind === "table" &&
            value.some(
              (row) =>
                !row ||
                typeof row !== "object" ||
                (!Array.isArray(row) && row.constructor !== Object),
            )
          )
            fail("table rows must be objects or arrays", field.path);
          if (field.kind === "code") item.language = field.codeLanguage;
          if (field.kind === "link") {
            if (typeof value !== "string") fail("link value must be a URL", field.path);
            let url;
            try {
              url = new URL(value);
            } catch {
              fail("invalid URL", field.path);
            }
            const scheme = url.protocol.slice(0, -1);
            if (!validatedProfile.urlPolicy.schemes.includes(scheme))
              fail("URL rejected by policy", field.path);
            if (
              !/^https?:\/\/[^/]+/i.test(value) ||
              !validHostname(url.hostname) ||
              url.username ||
              url.password
            )
              fail("URL must have a hostname and no credentials", field.path);
            item.presentation = field.link ?? "text-and-url";
            item.value = url.href;
            if (item.presentation === "text-and-url") item.url = url.href;
          }
          if (item.value === undefined) delete item.value;
          return [item];
        }),
    }));
  if (!sections.some((section) => section.items.length > 0))
    fail("render profile resolves to no items", "/fields", "empty-render-model");
  const model = {
    schema: "csm-render-model/1",
    profile: validatedProfile.profile,
    source: sourceRef,
    sections,
  };
  const result = schemaRegistry.validate("csm-render-model/1", model);
  if (!result.valid) fail("render model does not match its schema", result.errors[0]?.instancePath);
  return { model, bytes: canonicalize(model), digest: digest(model) };
}

export { pointerParts };
