"use strict";

import { digest, loadSchemaRegistry } from "../../lib/schema-runtime/index.mjs";
import { publish } from "../../lib/publication/index.mjs";
import { renderHtml, HTML_RENDERER_DIGEST } from "../../lib/render-html/index.mjs";
import { renderMarkdown, RENDERER_DIGEST } from "../../lib/render-markdown/index.mjs";
import { createFindingsRenderModel } from "./findings-render.mjs";
import { HUMAN_PROFILE, RUNTIME_PROFILE } from "./human-profile.mjs";

const MARKDOWN_RENDERER = { id: "csm-render-markdown/1", revision: 1 };
const HTML_RENDERER = { id: "csm-render-html/1", revision: 1 };
const SHARES = new Set(["none", "markdown", "html", "both"]);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message, code = "invalid-human-projection") {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function assertDateTime(value) {
  if (
    typeof value !== "string" ||
    !DATE_TIME.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value)
  )
    fail("generatedAt must be an explicit valid UTC timestamp");
}

function assertProjectionId(value, name) {
  if (typeof value !== "string" || !/^proj-[a-z0-9][a-z0-9-]{1,127}$/.test(value))
    fail(`${name} must be an explicit projection ID`);
  return value;
}

function resolveProjectionIds({ projectionId, projectionIds }, share) {
  const supplied = projectionIds ?? projectionId;
  if (typeof supplied === "string") {
    const seed = assertProjectionId(supplied, "projectionId");
    return {
      markdown: assertProjectionId(`${seed}-markdown`, "markdown projectionId"),
      html: assertProjectionId(`${seed}-html`, "html projectionId"),
    };
  }
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied))
    fail("projectionId or projectionIds is required");
  const ids = {
    markdown: assertProjectionId(supplied.markdown, "markdown projectionId"),
    html: assertProjectionId(supplied.html, "html projectionId"),
  };
  if (share === "both" && ids.markdown === ids.html)
    fail("Markdown and HTML projection IDs must be distinct");
  return ids;
}

function descriptor({ kind, id, source, generatedAt, profileDigest }) {
  const renderer = kind === "markdown" ? MARKDOWN_RENDERER : HTML_RENDERER;
  return {
    projectionId: id,
    source: {
      artifactId: source.artifactId,
      digest: source.digest,
      schema: source.schema,
    },
    sourceRunId: source.runId,
    sourceOwner: source.owner,
    renderer,
    profile: RUNTIME_PROFILE,
    rendererDigest: kind === "markdown" ? RENDERER_DIGEST : HTML_RENDERER_DIGEST,
    profileDigest,
    generatedAt,
  };
}

export async function publishHumanFindings({
  payload,
  share,
  generatedAt,
  projectionId,
  projectionIds,
  publication = {},
} = {}) {
  if (!SHARES.has(share)) fail("share must be explicitly set to none, markdown, html, or both");
  assertDateTime(generatedAt);
  const ids = resolveProjectionIds({ projectionId, projectionIds }, share);
  const schemaRegistry = await loadSchemaRegistry();
  const normalized = await createFindingsRenderModel(payload, { schemaRegistry });
  const profileDigest = digest(HUMAN_PROFILE);
  const descriptors = {
    markdown: descriptor({
      kind: "markdown",
      id: ids.markdown,
      source: normalized.sourceDescriptor,
      generatedAt,
      profileDigest,
    }),
    html: descriptor({
      kind: "html",
      id: ids.html,
      source: normalized.sourceDescriptor,
      generatedAt,
      profileDigest,
    }),
  };

  return publish({
    ...publication,
    source: normalized.sourceDescriptor,
    share,
    renderers: {
      markdown: async () =>
        renderMarkdown({
          model: normalized.model,
          profile: normalized.profile,
          projection: descriptors.markdown,
        }),
      html: () =>
        renderHtml({
          model: normalized.model,
          profile: normalized.profile,
          projection: descriptors.html,
          schemaRegistry,
        }),
    },
  });
}

export { descriptor as createProjectionDescriptor };
