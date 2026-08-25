"use strict";

import { canonicalize, digest, loadSchemaRegistry } from "../schema-runtime/index.mjs";
import { createHash } from "node:crypto";

const RENDERER = { id: "csm-render-markdown/1", revision: 1 };
const RENDERER_DIGEST = "sha256:414d5b31b467f39b7b0dd74b99e5fb3d72725aa2c6243ca0b6c498f52df2ea97";
const HTML = /<\/?[A-Za-z][^>]*>/;
const MARKDOWN = /([\\`*_[\]<>#+.!|{}()~])/g;

function fail(message, code = "invalid-markdown-render-request") {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function text(value) {
  if (typeof value !== "string") fail("Markdown text must be a string");
  if (HTML.test(value)) fail("raw HTML is not supported");
  return value
    .replaceAll("\r\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll(MARKDOWN, "\\$1");
}

function jsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every((key) => jsonValue(value[key]))
  );
}

function scalar(value) {
  if (value === null) return "null";
  if (typeof value === "string") return text(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (jsonValue(value)) return text(canonicalize(value));
  fail("list and table values must be JSON values");
}

function safeUrl(value, policy) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("invalid link URL");
  }
  const schemes = new Set(policy.schemes.map((scheme) => `${scheme}:`));
  if (
    policy.mode !== "allowlist" ||
    !schemes.has(url.protocol) ||
    !url.hostname ||
    url.hostname.startsWith(".") ||
    url.hostname.endsWith(".") ||
    url.hostname.includes("..") ||
    url.username ||
    url.password
  )
    fail("unsafe link URL");
  return url.href;
}

function refLabel(value) {
  return value.id.endsWith(`/${value.revision}`) ? value.id : `${value.id}/${value.revision}`;
}

function codeBlock(value, language) {
  if (typeof value !== "string" || typeof language !== "string") fail("invalid code item");
  if (HTML.test(value)) fail("raw HTML is not supported");
  const runs = [...value.matchAll(/`+/g)].map(([run]) => run.length);
  const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
  return `${fence}${text(language)}\n${value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")}\n${fence}`;
}

function table(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const rows = value.map((row) =>
    Array.isArray(row)
      ? row.map(scalar)
      : Object.keys(row)
          .toSorted()
          .map((key) => `${text(key)}: ${scalar(row[key])}`),
  );
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
  return [
    `| ${padded[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function itemValue(item, urlPolicy) {
  if (item.kind === "redacted") return item.value === undefined ? null : "[REDACTED]";
  if (item.kind === "code") return codeBlock(item.value, item.language);
  if (item.kind === "list") {
    if (!Array.isArray(item.value)) fail("list value must be an array");
    return item.value.map((entry) => `- ${scalar(entry)}`).join("\n");
  }
  if (item.kind === "table") return table(item.value);
  if (item.kind === "link") {
    const label = text(item.value);
    if (item.presentation === "text-only") return label;
    const url = safeUrl(item.url, urlPolicy);
    return `[${label}](<${url}>)`;
  }
  return scalar(item.value);
}

function metadataLines(projection, model) {
  const source = projection.source;
  return [
    `> Projection: ${text(projection.projectionId)}`,
    `> Source: ${text(source.artifactId)} (${text(source.digest)})`,
    `> Source schema: ${text(refLabel(source.schema))}`,
    `> Source run: ${text(projection.sourceRunId)}`,
    `> Source owner: ${text(projection.sourceOwner)}`,
    `> Renderer: ${text(refLabel(projection.renderer))} (${text(projection.rendererDigest)})`,
    `> Profile: ${text(refLabel(projection.profile))} (${text(projection.profileDigest)})`,
    `> Model: ${text(model.schema)}`,
    `> Generated: ${text(projection.generatedAt)}`,
    "> Status: untrusted-presentation",
  ];
}

function validateProfileInput(profile, model, projection, registry) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    fail("validated render profile is required");
  const result = registry.validate("csm-render-profile/1", profile);
  if (!result.valid) fail("render profile failed schema validation", "invalid-render-profile");
  if (
    profile.profile.id !== model.profile.id ||
    profile.profile.revision !== model.profile.revision
  )
    fail("render profile does not match render model");
  if (
    projection &&
    (projection.profile?.id !== profile.profile.id ||
      projection.profile?.revision !== profile.profile.revision)
  )
    fail("render profile does not match projection");
}

function validateProjectionInput(projection, model, profile) {
  if (!projection || typeof projection !== "object" || Array.isArray(projection))
    fail("projection metadata is required");
  const required = [
    "projectionId",
    "source",
    "sourceRunId",
    "sourceOwner",
    "rendererDigest",
    "profileDigest",
    "generatedAt",
  ];
  const allowed = new Set([...required, "renderer", "profile"]);
  if (Object.keys(projection).some((key) => !allowed.has(key)))
    fail("projection metadata contains unsupported fields");
  for (const key of required)
    if (!Object.hasOwn(projection, key)) fail(`projection.${key} is required`);
  if (
    !projection.renderer ||
    projection.renderer.id !== RENDERER.id ||
    projection.renderer.revision !== RENDERER.revision ||
    Object.keys(projection.renderer).length !== 2
  )
    fail("projection renderer does not match Markdown renderer");
  if (
    !projection.profile ||
    projection.profile.id !== profile.profile.id ||
    projection.profile.revision !== profile.profile.revision ||
    Object.keys(projection.profile).length !== 2
  )
    fail("projection profile does not match render model");
  if (
    !projection.source ||
    Array.isArray(projection.source) ||
    projection.source.schema?.id !== model.source.id ||
    projection.source.schema?.revision !== model.source.revision ||
    Object.keys(projection.source).length !== 3 ||
    !projection.source.schema ||
    Object.keys(projection.source.schema).length !== 2
  )
    fail("projection source schema does not match render model");
  if (!/^art-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.source.artifactId))
    fail("invalid source artifact ID");
  if (!/^run-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.sourceRunId)) fail("invalid source run ID");
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(projection.sourceOwner)) fail("invalid source owner");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.source.digest)) fail("invalid source digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.rendererDigest)) fail("invalid renderer digest");
  if (!/^sha256:[a-f0-9]{64}$/.test(projection.profileDigest)) fail("invalid profile digest");
  if (projection.rendererDigest !== RENDERER_DIGEST)
    fail("projection renderer digest does not match Markdown renderer");
  if (projection.profileDigest !== digest(profile))
    fail("projection profile digest does not match validated render profile");
  if (!/^proj-[a-z0-9][a-z0-9-]{1,127}$/.test(projection.projectionId))
    fail("invalid projection ID");
  if (
    typeof projection.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(projection.generatedAt) ||
    Number.isNaN(Date.parse(projection.generatedAt))
  )
    fail("invalid generated timestamp");
}

export async function renderMarkdown({ model, profile, projection, sourceMetadata } = {}) {
  if (sourceMetadata !== undefined) {
    if (projection !== undefined) fail("use projection or sourceMetadata, not both");
    projection = sourceMetadata;
  }
  if (
    !model ||
    typeof model !== "object" ||
    Array.isArray(model) ||
    model.schema !== "csm-render-model/1"
  )
    fail("renderer accepts only a validated csm-render-model/1 object", "machine-input-required");
  const registry = await loadSchemaRegistry();
  const result = registry.validate("csm-render-model/1", model);
  if (!result.valid) fail("render model failed schema validation", "invalid-render-model");
  validateProfileInput(profile, model, projection, registry);
  validateProjectionInput(projection, model, profile);
  const renderer = projection.renderer;
  const descriptor = {
    schema: "csm-projection/1",
    projectionId: projection.projectionId,
    source: projection.source,
    sourceRunId: projection.sourceRunId,
    sourceOwner: projection.sourceOwner,
    mediaType: "text/markdown",
    renderer,
    profile: projection.profile,
    rendererDigest: projection.rendererDigest,
    profileDigest: projection.profileDigest,
    generatedAt: projection.generatedAt,
    status: "untrusted-presentation",
    approval: { binding: null, status: "pending" },
  };
  const lines = [...metadataLines(descriptor, model), ""];
  for (const section of model.sections) {
    lines.push(`## ${text(section.label)}`, "");
    for (const item of section.items) {
      const value = itemValue(item, profile.urlPolicy);
      if (value === null) continue;
      lines.push(`### ${text(item.label)}`, "", value, "");
    }
  }
  const markdown = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const outputDigest = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
  const binding = {
    source: descriptor.source,
    sourceRunId: descriptor.sourceRunId,
    sourceOwner: descriptor.sourceOwner,
    renderer: descriptor.renderer,
    rendererDigest: descriptor.rendererDigest,
    profile: descriptor.profile,
    profileDigest: descriptor.profileDigest,
    outputDigest,
  };
  const finalProjection = { ...descriptor, outputDigest, approval: { binding, status: "pending" } };
  const projectionResult = registry.validate("csm-projection/1", finalProjection);
  if (!projectionResult.valid)
    fail(
      `projection descriptor failed schema validation: ${projectionResult.errors[0]?.message ?? "unknown error"}`,
      "invalid-projection",
    );
  return { markdown, outputDigest, projection: finalProjection };
}

export { RENDERER, RENDERER_DIGEST };
