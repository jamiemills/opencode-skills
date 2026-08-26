"use strict";

import { dirname, resolve } from "node:path";
import { resolveArtifactFile } from "../artifact-resolver/index.mjs";
import { digest, loadSchemaRegistry } from "../schema-runtime/index.mjs";
import { loadMachineInput } from "../publication/index.mjs";
import { readPublishedPair } from "../../csm-ddd/lib/ddd/pipeline.mjs";

const EDGES = Object.freeze({
  "scan->review": { schema: "csm-norms/1", owner: "csm-scan", consumer: "csm-review" },
  "ddd->plan": { schema: "csm-ddd-graph/1", owner: "csm-ddd", consumer: "csm-plan" },
  "research->grill": {
    schema: "csm-research/1",
    owner: "csm-deep-research",
    consumer: "csm-grill",
  },
  "research->make-tests": {
    schema: "csm-research/1",
    owner: "csm-deep-research",
    consumer: "csm-make-tests",
  },
  "review->grill": { schema: "csm-review-findings/1", owner: "csm-review", consumer: "csm-grill" },
});

const reject = (code, message, details = {}) =>
  Object.freeze({ status: "rejected", code, message, ...details });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

async function loadInput(input, root) {
  if (typeof input === "string" && /\.jsonl?$/i.test(input)) {
    const registry = await loadSchemaRegistry();
    return resolveArtifactFile(input, {
      root,
      schemaRegistry: registry,
      requireSourceDigest: false,
    });
  }
  if (typeof input === "string" && /\.md$/i.test(input))
    return reject("migration-required", "Markdown input requires explicit migration");
  const result = await loadMachineInput(input, { root });
  return result.status === "loaded"
    ? { status: "resolved", value: result.value, path: result.path }
    : result;
}

function lifecycle(envelope) {
  if (envelope.lifecycleStatus === "failed" || envelope.lifecycleStatus === "blocked")
    return reject("failed-input", "failed or blocked consumer input cannot be dispatched");
  if (envelope.lifecycleStatus !== "completed")
    return reject("nonterminal-input", "consumer input is not terminal");
  if (envelope.verificationStatus !== "verified")
    return reject("unverified-input", "consumer input is not verified");
  return null;
}

async function validateEnvelope(edge, envelope, expectedSourceDigest) {
  const expected = EDGES[edge];
  if (envelope?.schema !== "csm-envelope/1")
    return reject("bare-payload", "consumer input must be a csm-envelope/1 envelope");
  const registry = await loadSchemaRegistry();
  const checked = registry.validate("csm-envelope/1", envelope);
  if (!checked.valid)
    return reject("schema-invalid", "consumer envelope does not validate", {
      errors: checked.errors,
    });
  if (envelope.payloadSchema.id !== expected.schema || envelope.payloadSchema.revision !== 1)
    return reject("unknown-or-mismatched-schema", `expected ${expected.schema}`);
  if (envelope.artifact.owner !== expected.owner)
    return reject("ownership-mismatch", `expected owner ${expected.owner}`, {
      owner: envelope.artifact.owner,
    });
  if (envelope.artifact.runId !== envelope.run.runId)
    return reject("lineage-mismatch", "artifact and run IDs do not match");
  if (expectedSourceDigest && envelope.artifact.digest !== expectedSourceDigest)
    return reject("digest-mismatch", "source digest does not match expected lineage");
  const payloadDigest =
    envelope.payload.schema === "csm-norms/1"
      ? envelope.payload.artifactDigest
      : digest(envelope.payload);
  if (envelope.artifact.digest !== payloadDigest)
    return reject("digest-mismatch", "artifact digest does not match payload");
  const terminal = lifecycle(envelope);
  if (terminal) return terminal;
  return {
    payload: envelope.payload,
    envelope,
    owner: envelope.artifact.owner,
    runId: envelope.run.runId,
    sourceDigest: envelope.artifact.digest,
  };
}

async function resolveDddPair(input, root) {
  if (!isObject(input) || input.schema === "csm-envelope/1")
    return reject("pair-required", "ddd->plan requires a published report/graph pair descriptor");
  const registry = await loadSchemaRegistry();
  const descriptor = input.value ?? input;
  const descriptorCheck = registry.validate("csm-ddd-pair/1", descriptor);
  if (!descriptorCheck.valid)
    return reject("schema-invalid", "DDD pair descriptor does not validate", {
      errors: descriptorCheck.errors,
    });
  const report = resolve(root, descriptor.report.path);
  const graph = resolve(root, descriptor.graph.path);
  const pair = await readPublishedPair(report, graph, root);
  if (!pair.ok)
    return reject("pair-invalid", "published DDD report/graph pair is invalid", {
      errors: pair.errors,
    });
  if (
    descriptor.runId !== pair.pointer.runId ||
    descriptor.report.sha256 !== pair.pointer.reportSha256 ||
    descriptor.graph.sha256 !== pair.pointer.graphSha256 ||
    resolve(root, descriptor.manifest) !== resolve(dirname(report), pair.pointer.manifest)
  )
    return reject("pair-mismatch", "DDD pair descriptor does not match the published pointer");
  return {
    payload: pair.graphObject,
    pair: { descriptor, ...pair },
    owner: "csm-ddd",
    runId: pair.pointer.runId,
    sourceDigest: pair.pointer.graphSha256,
  };
}

export async function resolveConsumerInput(
  edge,
  input,
  { root = process.cwd(), expectedSourceDigest } = {},
) {
  if (!EDGES[edge]) return reject("unknown-edge", `unknown consumer edge: ${edge}`);
  const loaded = await loadInput(input, root);
  if (loaded.status !== "resolved") return loaded;
  const checked =
    edge === "ddd->plan"
      ? await resolveDddPair(loaded.value, root)
      : await validateEnvelope(edge, loaded.value, expectedSourceDigest);
  if (checked.status) return checked;
  return Object.freeze({
    status: "resolved",
    edge,
    consumer: EDGES[edge].consumer,
    schema: EDGES[edge].schema,
    path: loaded.path ?? null,
    value: checked.payload,
    envelope: checked.envelope ?? null,
    pair: checked.pair ?? null,
    lineage: { owner: checked.owner, runId: checked.runId, digest: checked.sourceDigest },
    owner: checked.owner,
    runId: checked.runId,
    sourceDigest: checked.sourceDigest,
    terminal: true,
    rollback: { available: Boolean(checked.pair?.pointer), required: false },
  });
}

export const CONSUMER_EDGES = EDGES;
