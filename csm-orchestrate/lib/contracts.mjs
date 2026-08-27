import { readFile } from "node:fs/promises";
import { createSchemaValidator, parseJson } from "../../lib/schema-runtime/index.mjs";

const SCHEMA_FILES = [
  "approval.schema.json",
  "invocation.schema.json",
  "receipt.schema.json",
  "evidence.schema.json",
  "gate.schema.json",
  "adversarial-review.schema.json",
  "final-review.schema.json",
  "phase.schema.json",
  "requirement.schema.json",
  "cursor.schema.json",
];
let validatorPromise;

export async function orchestrateValidator() {
  validatorPromise ??= Promise.all(
    SCHEMA_FILES.map(async (file) =>
      parseJson(await readFile(new URL(`../schemas/${file}`, import.meta.url), "utf8")),
    ),
  ).then((schemas) => {
    const byId = new Map(schemas.map((schema) => [schema.$id, schema]));
    for (const schema of schemas) {
      if (schema.$id === "csm-orchestrate-invocation/1") {
        const approval = { ...byId.get("csm-orchestrate-approval/1") };
        delete approval.$id;
        schema.properties.approval = approval;
      }
      if (schema.$id === "csm-orchestrate-final-review/1") {
        const review = { ...byId.get("csm-orchestrate-adversarial-review/1") };
        delete review.$id;
        schema.properties.finalReview = review;
      }
    }
    return createSchemaValidator({ schemas });
  });
  return validatorPromise;
}

export async function assertSchema(schemaId, value) {
  const result = (await orchestrateValidator()).validate(schemaId, value);
  if (!result.valid)
    throw new TypeError(
      `invalid ${schemaId}: ${result.errors
        .map((error) => error.instancePath || error.message)
        .join("; ")}`,
    );
  return value;
}

export async function validSchema(schemaId, value) {
  return (await orchestrateValidator()).validate(schemaId, value).valid;
}

export function validatePhaseGraph(phases) {
  const ids = new Set();
  const byId = new Map();
  for (const phase of phases) {
    if (ids.has(phase.phaseId)) throw new Error(`duplicate phase ID: ${phase.phaseId}`);
    ids.add(phase.phaseId);
    byId.set(phase.phaseId, phase);
  }
  for (const phase of phases) {
    const seen = new Set([phase.phaseId]);
    let parent = phase.parentPhaseId;
    while (parent !== null) {
      if (!byId.has(parent)) throw new Error(`unknown parent phase: ${parent}`);
      if (seen.has(parent)) throw new Error(`phase cycle: ${phase.phaseId}`);
      seen.add(parent);
      parent = byId.get(parent).parentPhaseId;
    }
  }
  return true;
}

export function validateApproval(approval, digest, now = new Date()) {
  if (approval.status !== "approved") throw new Error("approval is not approved");
  if (approval.approvedDigest !== digest) throw new Error("approval digest mismatch");
  if (new Date(approval.expiresAt).getTime() <= new Date(now).getTime())
    throw new Error("approval expired");
  return true;
}

export function validateRequirementLedger(ledger) {
  for (const requirement of ledger.requirements) {
    const usable = requirement.evidenceRefs.some((evidence) => evidence.status === "available");
    if (
      requirement.criticality === "critical" &&
      requirement.status === "verified" &&
      !usable &&
      !requirement.waiver
    )
      throw new Error(`critical requirement lacks evidence: ${requirement.requirementId}`);
  }
  return true;
}

export function validateFinalOutcome(ledger, outcome) {
  if (outcome.status !== "VERIFIED") return true;
  const unresolved = ledger.requirements.filter(
    (requirement) => requirement.criticality === "critical" && requirement.status !== "verified",
  );
  if (unresolved.length > 0) throw new Error("unresolved critical requirements");
  return true;
}

export function createContractValidator(schemas) {
  return createSchemaValidator({ schemas });
}
