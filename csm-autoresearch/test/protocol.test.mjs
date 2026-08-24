"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeResponse, parseLine, validateResponse } from "../lib/protocol/index.mjs";

const hash = "sha256:" + "a".repeat(64);
const request = {
  format: "csm-autoresearch-evaluator-request/1",
  requestId: "r",
  runId: "run",
  candidate: { id: "c", parentId: null, sourceHash: hash, patchHash: hash },
  limits: { timeoutMs: 1000, maxOutputBytes: 100, network: "disabled" },
};
const response = {
  format: "csm-autoresearch-evaluator-response/1",
  requestId: "r",
  runId: "run",
  status: "ok",
  valid: true,
  metrics: { score: 1 },
  provenance: {
    evaluatorHash: hash,
    environmentHash: hash,
    limits: request.limits,
    redacted: true,
  },
};

test("protocol accepts one bounded request and emits one newline", () => {
  assert.deepEqual(parseLine(JSON.stringify(request)), request);
  assert.equal(encodeResponse(response).endsWith("\n"), true);
});

test("protocol rejects unknown fields, malformed frames, and status mismatches", () => {
  assert.throws(() => parseLine(`${JSON.stringify({ ...request, extra: true })}`), /unknown field/);
  assert.throws(() => parseLine("{}\n{}"), /exactly one line/);
  assert.throws(
    () => validateResponse({ ...response, status: "timed_out" }),
    /valid does not match/,
  );
  assert.throws(
    () => encodeResponse({ ...response, diagnostics: ["x".repeat(2001)] }),
    /diagnostics/,
  );
});
