import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchemaRegistry, digest, parseJson } from "../../../lib/schema-runtime/index.mjs";
import { loadMachineInput } from "../../../lib/publication/index.mjs";
import { resolveArtifactFile } from "../../../lib/artifact-resolver/index.mjs";
import { validatePlanArtifact } from "./plan.mjs";

const INPUTS = Object.freeze({
  plan: { schema: "csm-plan/1", owner: "csm-plan" },
  approach: { schema: "csm-approach/1", owner: "csm-grill" },
  research: { schema: "csm-research/1", owner: "csm-deep-research" },
  review: { schema: "csm-review-findings/1", owner: "csm-review" },
  doctrine: { schema: "csm-doctrine-findings/1", owner: "csm-review-python" },
  norms: { schema: "csm-norms/1", owner: "csm-scan" },
});

function rejected(code, message, details = {}) {
  return Object.freeze({ status: "rejected", code, message, ...details });
}

async function registry() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = parseJson(await readFile(resolve(root, "schemas/registry.json"), "utf8"));
  const schemas = await Promise.all(
    manifest.entries.map(async (entry) => {
      const schema = parseJson(await readFile(resolve(root, entry.schemaPath), "utf8"));
      Object.defineProperty(schema, "registryPath", { value: entry.schemaPath, enumerable: false });
      return schema;
    }),
  );
  return createSchemaRegistry({ registry: manifest, schemas, root });
}

function candidateValue(input) {
  if (input && typeof input === "object" && !Array.isArray(input) && input.value !== undefined)
    return input.value;
  return input;
}

function descriptorPath(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input.path : undefined;
}

async function load(input, { root = process.cwd() } = {}) {
  if (typeof input === "string" && /\.jsonl?$/i.test(input)) {
    const resolved = await resolveArtifactFile(input, {
      root,
      schemaRegistry: await registry(),
      consumerRevision: 1,
    });
    if (resolved.status !== "resolved") return resolved;
    return { value: resolved.value, path: resolved.path };
  }
  const loaded = await loadMachineInput(input, { root });
  if (loaded.status !== "loaded") return loaded;
  const value = candidateValue(loaded.value);
  return { value, path: loaded.path ?? descriptorPath(input) };
}

function verifyDigests(value) {
  const checks = [];
  if (typeof value?.digest === "string") {
    const candidate = structuredClone(value);
    delete candidate.digest;
    checks.push([value.digest, digest(candidate)]);
  }
  if (typeof value?.artifact?.digest === "string") {
    if (value.payload && typeof value.payload === "object")
      checks.push([value.artifact.digest, digest(value.payload)]);
    else {
      const candidate = structuredClone(value);
      delete candidate.artifact.digest;
      checks.push([value.artifact.digest, digest(candidate)]);
    }
  }
  return checks.every(([expected, actual]) => expected === actual);
}

export async function resolvePlanInput(
  kind,
  input,
  { expectedOwner = INPUTS[kind]?.owner, root = process.cwd() } = {},
) {
  const expected = INPUTS[kind];
  if (!expected) return rejected("unknown-input-kind", `unknown plan input kind: ${kind}`);
  const loaded = await load(input, { root });
  if (loaded.status) return loaded;
  const value = loaded.value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return rejected("invalid-json", "plan machine input must be an object", { path: loaded.path });
  if (value.schema !== expected.schema)
    return rejected("unknown-or-mismatched-schema", `expected ${expected.schema}`, {
      path: loaded.path,
    });
  const schemas = await registry();
  const validation = schemas.validate(expected.schema, value);
  if (!validation.valid)
    return rejected("schema-invalid", `input does not validate as ${expected.schema}`, {
      path: loaded.path,
      errors: validation.errors,
    });
  if (kind === "plan") {
    const planValidation = validatePlanArtifact(value);
    if (!planValidation.valid)
      return rejected("schema-invalid", "input does not validate as csm-plan/1", {
        path: loaded.path,
        errors: planValidation.errors,
      });
  }
  if (!verifyDigests(value))
    return rejected("digest-mismatch", "input digest does not match its payload", {
      path: loaded.path,
    });
  const owner =
    value.artifact?.owner ?? value.owner ?? value.ownership?.owner ?? value.provenance?.producer;
  if (expectedOwner && owner !== expectedOwner)
    return rejected("ownership-mismatch", `expected owner ${expectedOwner}`, {
      path: loaded.path,
      owner,
    });
  return Object.freeze({
    status: "resolved",
    kind,
    schema: expected.schema,
    path: loaded.path ?? null,
    value,
  });
}

export async function resolvePlanInputs({
  approach,
  research = [],
  reviews = [],
  doctrine = [],
  norms = [],
} = {}) {
  const entries = [
    ["approach", approach],
    ...research.map((value) => ["research", value]),
    ...reviews.map((value) => ["review", value]),
    ...doctrine.map((value) => ["doctrine", value]),
    ...norms.map((value) => ["norms", value]),
  ];
  const resolved = await Promise.all(entries.map(([kind, value]) => resolvePlanInput(kind, value)));
  const rejectedInput = resolved.find((result) => result.status !== "resolved");
  if (rejectedInput) return rejectedInput;
  return Object.freeze({
    status: "resolved",
    approach: resolved[0],
    research: resolved.slice(1, research.length + 1),
    reviews: resolved.slice(research.length + 1, research.length + reviews.length + 1),
    doctrine: resolved.slice(
      research.length + reviews.length + 1,
      research.length + reviews.length + doctrine.length + 1,
    ),
    norms: resolved.slice(research.length + reviews.length + doctrine.length + 1),
  });
}

export { INPUTS };
