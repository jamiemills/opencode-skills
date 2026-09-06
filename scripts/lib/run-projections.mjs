"use strict";

// Human-readable projections for orchestrator run evidence. JSON stays the
// machine-authoritative exchange format; these HTML/Markdown renderings are
// untrusted presentation for operators (status: "untrusted-presentation"),
// built with the repository renderers (lib/render-model, lib/render-html,
// lib/render-markdown) so every rendering carries its source digest, renderer
// digest, and profile digest.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../../lib/schema-runtime/index.mjs";
import { createRenderModel } from "../../lib/render-model/index.mjs";
import { renderHtml, HTML_RENDERER_DIGEST } from "../../lib/render-html/index.mjs";
import { renderMarkdown, RENDERER_DIGEST } from "../../lib/render-markdown/index.mjs";

const field = (section, order, path, kind, label, visibility = "always") => ({
  section,
  order,
  path,
  kind,
  label,
  visibility,
});

export const RECEIPT_RENDER_PROFILE = {
  schema: "csm-render-profile/1",
  profile: { id: "csm-render-profile/1", revision: 1 },
  sourceSchema: { id: "csm-orchestrate-receipt/2", revision: 2 },
  fields: [
    field("outcome", 1, "/outcome/status", "text", "Outcome"),
    field("outcome", 2, "/outcome/accepted", "boolean", "Accepted"),
    field("outcome", 3, "/reason", "text", "Reason", "if-present"),
    field("identity", 1, "/runId", "text", "Run"),
    field("identity", 2, "/phaseId", "text", "Phase"),
    field("identity", 3, "/receiptId", "text", "Receipt"),
    field("statuses", 1, "/statuses/route", "text", "Route"),
    field("statuses", 2, "/statuses/child", "text", "Child"),
    field("statuses", 3, "/statuses/artifact", "text", "Artifact"),
    field("statuses", 4, "/statuses/verification", "text", "Verification"),
    field("statuses", 5, "/statuses/parent", "text", "Parent"),
    field("approval", 1, "/approval/approvalId", "text", "Approval", "if-present"),
    field("approval", 2, "/approval/status", "text", "Approval status", "if-present"),
    field("approval", 3, "/idempotencyKey", "text", "Idempotency key"),
  ],
  sections: [
    { id: "outcome", label: "Outcome", order: 1 },
    { id: "identity", label: "Identity", order: 2 },
    { id: "statuses", label: "Statuses", order: 3 },
    { id: "approval", label: "Approval", order: 4 },
  ],
  urlPolicy: { mode: "allowlist", schemes: ["https"] },
};

export function buildReceiptSourceSchema() {
  // structural mirror of csm-orchestrate-receipt/2 instances: every profile
  // field path must resolve against this mirror AND the receipt
  return {
    $id: "csm-orchestrate-receipt/2",
    revision: 2,
    receiptId: { type: "string" },
    runId: { type: "string" },
    phaseId: { type: "string" },
    reason: { type: "string" },
    idempotencyKey: { type: "string" },
    outcome: {
      status: { type: "string" },
      accepted: { type: "boolean" },
    },
    statuses: {
      route: { type: "string" },
      child: { type: "string" },
      artifact: { type: "string" },
      verification: { type: "string" },
      parent: { type: "string" },
    },
    approval: {
      approvalId: { type: "string" },
      status: { type: "string" },
    },
  };
}

export function buildReceiptProjectionDescriptor({ receipt, projectionId, runId, generatedAt }) {
  const profile = RECEIPT_RENDER_PROFILE;
  return {
    projectionId,
    source: {
      artifactId: `art-${receipt.receiptId ?? "receipt"}`,
      digest: digest(receipt),
      schema: { id: "csm-orchestrate-receipt/2", revision: 2 },
    },
    renderer: { id: "csm-render-markdown/1", revision: 1 },
    profile: { id: profile.profile.id, revision: profile.profile.revision },
    sourceRunId: runId,
    sourceOwner: "csm-orchestrate",
    rendererDigest: RENDERER_DIGEST,
    profileDigest: digest(profile),
    generatedAt,
  };
}

export async function emitRunProjections({
  dir,
  receipt,
  runId,
  schemaRegistry,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!dir) throw new TypeError("projection output directory is required");
  if (!receipt || typeof receipt !== "object") throw new TypeError("terminal receipt is required");
  if (!schemaRegistry?.validate) throw new TypeError("schemaRegistry is required");
  const profile = RECEIPT_RENDER_PROFILE;
  const sourceRef = { id: "csm-orchestrate-receipt/2", revision: 2 };
  const sourceSchema = buildReceiptSourceSchema();
  const { model } = createRenderModel({
    source: receipt,
    sourceSchema,
    profile,
    sourceRef,
    schemaRegistry,
  });
  const projection = buildReceiptProjectionDescriptor({
    receipt,
    projectionId: `proj-${runId ?? receipt.runId ?? "run"}`,
    runId: runId ?? receipt.runId,
    generatedAt,
  });
  const markdown = await renderMarkdown({ model, profile, projection });
  const htmlProjection = {
    ...projection,
    renderer: { id: "csm-render-html/1", revision: 1 },
    rendererDigest: HTML_RENDERER_DIGEST,
  };
  const html = renderHtml({
    model,
    schemaRegistry,
    profile,
    projection: htmlProjection,
    generatedAt,
  });
  await mkdir(dir, { recursive: true });
  const mdPath = join(dir, "receipt.md");
  const htmlPath = join(dir, "receipt.html");
  await writeFile(mdPath, `${markdown.markdown ?? markdown}\n`, { mode: 0o644 });
  await writeFile(htmlPath, `${html.html ?? html}\n`, { mode: 0o644 });
  return { markdownPath: mdPath, htmlPath, projection, modelDigest: digest(model) };
}
