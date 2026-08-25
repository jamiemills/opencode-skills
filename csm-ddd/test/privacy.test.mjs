"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyQuestionFile } from "../lib/ddd/clarify.mjs";
import { buildGraphEnvelopeObject, renderReport } from "../lib/ddd/render.mjs";
import { serializePrivacy } from "../lib/ddd/redact.mjs";

const SECRET = "ghp_A1b2C3d4E5f6G7h8I9j0";
const HOSTILE_PATH = "/home/alice/private/project";

test("bounded privacy serializer redacts hostile values and caps output fields", () => {
  const out = serializePrivacy({
    label: `${HOSTILE_PATH}/${SECRET}`,
    huge: "x".repeat(10_000),
    items: Array(500).fill(SECRET),
  });
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /alice|ghp_A1b2/);
  assert.doesNotMatch(text, new RegExp(HOSTILE_PATH.replaceAll("/", "\\/")));
  assert.ok(Buffer.byteLength(out.huge) <= 4096);
  assert.equal(out.items.length, 200);
});

test("clarification rejects malformed and oversized answers and artifacts contain no canaries", () => {
  assert.throws(
    () =>
      applyQuestionFile(
        [{ id: "q-1" }],
        { answers: [{ questionId: "q-1", value: "x".repeat(4097) }] },
        [],
        "fixture",
      ),
    /exceeds/,
  );
  const synthesis = {
    capabilities: [
      { dir: `${HOSTILE_PATH}/${SECRET}`, classification: "core", inbound: 1, outbound: 0 },
    ],
    terms: [],
    edges: [],
    seams: [],
    ordering: [],
    nodes: [{ id: "node-1", label: `${HOSTILE_PATH}/node` }],
    claims: [],
    evidence: [{ id: "e-1", locator: `${HOSTILE_PATH}/evidence.txt` }],
  };
  const extraction = {
    caps: {
      filesScanned: 1,
      bytesScanned: 1,
      maxFiles: 2,
      maxBytes: 2,
      truncatedByFiles: false,
      truncatedByBytes: false,
    },
    git: null,
    norms: { loaded: false },
    claims: [],
    evidence: [],
  };
  const clarification = { questions: [], answers: [], gaps: [], claims: [], evidence: [] };
  const markdown = renderReport({
    runId: "run-1",
    generatedAt: "now",
    repoName: HOSTILE_PATH,
    extraction,
    synthesis,
    clarification,
  });
  const graph = JSON.stringify(
    buildGraphEnvelopeObject({
      runId: "run-1",
      generatedAt: "now",
      extraction,
      synthesis,
      clarification,
    }),
  );
  const artifacts = `${markdown}\n${graph}`;
  assert.doesNotMatch(artifacts, /alice|ghp_A1b2/);
  assert.doesNotMatch(artifacts, new RegExp(HOSTILE_PATH.replaceAll("/", "\\/")));
  assert.doesNotMatch(artifacts, /(?:^|\n)\/(?:home|Users|tmp|var|etc|opt|usr)\//m);
});

test("renderers reject run IDs that could escape Markdown or JSON fields", () => {
  const extraction = {
    caps: {
      filesScanned: 0,
      bytesScanned: 0,
      maxFiles: 1,
      maxBytes: 1,
      truncatedByFiles: false,
      truncatedByBytes: false,
    },
    git: null,
    norms: { loaded: false },
    claims: [],
    evidence: [],
  };
  const synthesis = {
    capabilities: [],
    terms: [],
    edges: [],
    seams: [],
    ordering: [],
    nodes: [],
    claims: [],
    evidence: [],
  };
  const clarification = { questions: [], answers: [], gaps: [], claims: [], evidence: [] };
  for (const runId of ["../leak", "run\nrun", "/tmp/leak", "x".repeat(101)]) {
    assert.throws(
      () =>
        renderReport({
          runId,
          generatedAt: "now",
          repoName: "fixture",
          extraction,
          synthesis,
          clarification,
        }),
      /runId must be/,
    );
    assert.throws(
      () =>
        buildGraphEnvelopeObject({
          runId,
          generatedAt: "now",
          extraction,
          synthesis,
          clarification,
        }),
      /runId must be/,
    );
  }
});
