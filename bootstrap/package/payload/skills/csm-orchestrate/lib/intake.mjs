"use strict";

import { readFile } from "node:fs/promises";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const ENTRY_ENVELOPE = "csm-orchestrate-request/1";

function routerHint(detail) {
  return new TypeError(
    `intake: ${detail} New work must enter the router through the ${ENTRY_ENVELOPE} entry envelope.`,
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyStringField(artifact, field) {
  const value = artifact[field];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`intake: ${field} must be a non-empty string`);
  return value;
}

function assertCanonicalRunId(artifact) {
  const runId = nonEmptyStringField(artifact, "runId");
  if (!RUN_ID.test(runId))
    throw new TypeError(`intake: runId "${runId}" must match ^run-[a-z0-9][a-z0-9-]{1,127}$`);
}

function kindForMarker(marker) {
  switch (marker) {
    case "csm-approach/1":
      return "approach";
    case "csm-plan/1":
      return "plan";
    case ENTRY_ENVELOPE:
      return "request";
    default:
      return undefined;
  }
}

async function resolveInput(input) {
  if (typeof input === "string") {
    let text;
    try {
      text = await readFile(input, "utf8");
    } catch (error) {
      throw new TypeError(`intake: cannot read artifact file "${input}": ${error.message}`, {
        cause: error,
      });
    }
    try {
      return { artifact: JSON.parse(text), path: input };
    } catch (error) {
      throw new TypeError(`intake: artifact file "${input}" is not valid JSON: ${error.message}`, {
        cause: error,
      });
    }
  }
  return { artifact: input, path: null };
}

export async function intakeArtifact(input) {
  const { artifact, path } = await resolveInput(input);
  if (!isPlainObject(artifact)) throw routerHint("artifact is not a JSON object.");
  const marker = artifact.schema;
  const kind = kindForMarker(marker);
  if (kind === undefined)
    throw routerHint(
      marker === undefined
        ? "artifact has no schema marker."
        : `unsupported schema marker "${String(marker)}".`,
    );
  switch (kind) {
    case "approach":
      assertCanonicalRunId(artifact);
      break;
    case "plan":
      nonEmptyStringField(artifact, "planId");
      assertCanonicalRunId(artifact);
      break;
    case "request":
      nonEmptyStringField(artifact, "requestId");
      nonEmptyStringField(artifact, "kind");
      nonEmptyStringField(artifact, "prompt");
      assertCanonicalRunId(artifact);
      break;
  }
  return { kind, artifact, path };
}
