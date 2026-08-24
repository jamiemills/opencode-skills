#!/usr/bin/env node
"use strict";

import { stdin, stdout } from "node:process";
import { MAX_LINE_BYTES, encodeResponse, parseLine } from "../lib/protocol/index.mjs";

let input = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  if (Buffer.byteLength(input) <= MAX_LINE_BYTES) input += chunk;
});
stdin.on("end", () => {
  let request;
  try {
    const lines = input.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length !== 1) throw new TypeError("exactly one JSONL request is required");
    request = parseLine(lines[0]);
    stdout.write(
      encodeResponse({
        format: "csm-autoresearch-evaluator-response/1",
        requestId: request.requestId,
        runId: request.runId,
        status: "blocked",
        valid: false,
        metrics: {},
        diagnostics: ["no candidate executor is configured"],
        provenance: {
          evaluatorHash: "sha256:" + "0".repeat(64),
          environmentHash: "sha256:" + "0".repeat(64),
          limits: request.limits,
          redacted: true,
        },
      }),
    );
  } catch (error) {
    const requestId = request?.requestId ?? "protocol-error";
    const runId = request?.runId ?? "protocol-error";
    stdout.write(
      encodeResponse({
        format: "csm-autoresearch-evaluator-response/1",
        requestId,
        runId,
        status: "protocol_error",
        valid: false,
        metrics: {},
        diagnostics: [String(error.message).slice(0, 2000)],
        provenance: {
          evaluatorHash: "sha256:" + "0".repeat(64),
          environmentHash: "sha256:" + "0".repeat(64),
          limits: {},
          redacted: true,
        },
      }),
    );
    process.exitCode = 0;
  }
});
