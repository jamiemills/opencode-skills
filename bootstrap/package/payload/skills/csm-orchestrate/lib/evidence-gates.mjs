"use strict";

const FAILURE_CLASSES = new Set([
  "missing",
  "stale",
  "contradicted",
  "unavailable",
  "infrastructure",
  "technical",
  "functional",
  "policy",
]);
const INFRA_CODES = new Set([
  "edge-opt-in-required",
  "resource-limit",
  "discovery-failed",
  "unavailable-host",
]);

const failure = (failureClass, code, message, extra = {}) => ({
  class: FAILURE_CLASSES.has(failureClass) ? failureClass : "policy",
  code,
  message,
  ...extra,
});

function resultFor(kind, status, scenarioIds, evidenceRefs) {
  return {
    status,
    scenarioIds: [...new Set(scenarioIds)],
    evidenceRefs: [...new Set(evidenceRefs)],
  };
}

function classifyResolution(resolution) {
  if (resolution?.status === "resolved") return null;
  const code = resolution?.code ?? "unavailable";
  if (code === "missing") return failure("missing", code, resolution.message);
  if (code === "edge-opt-in-required" || code === "unavailable-host")
    return failure("unavailable", code, resolution.message);
  if (INFRA_CODES.has(code)) return failure("infrastructure", code, resolution.message);
  if (
    [
      "digest-mismatch",
      "source-digest-mismatch",
      "source-identity-mismatch",
      "source-run-mismatch",
      "ownership-mismatch",
      "schema-invalid",
      "unknown-revision",
      "ambiguous-legacy-digest",
      "projection-history",
      "legacy-markdown-history",
      "migration-required",
    ].includes(code)
  )
    return failure("policy", code, resolution.message);
  return failure("infrastructure", code, resolution?.message ?? "artifact resolution failed");
}

function currentStatus(ref, record) {
  if (ref.status && ref.status !== "available" && ref.status !== "current") return ref.status;
  if (
    ref.current === false ||
    record?.lifecycleStatus === "superseded" ||
    record?.lifecycleStatus === "stale"
  )
    return "stale";
  return "current";
}

function bindingFailure(requirementId, ref, item) {
  if (ref.requirementId !== requirementId)
    return failure(
      "policy",
      "requirement-binding-mismatch",
      `evidence reference is not bound to requirement: ${requirementId}`,
      { requirementId, evidenceId: ref.evidenceId },
    );
  if (!item.requirementIds?.includes(requirementId))
    return failure(
      "policy",
      "evidence-binding-mismatch",
      `evidence is not explicitly bound to requirement: ${requirementId}`,
      { requirementId, evidenceId: ref.evidenceId },
    );
  return null;
}

function artifactFailure(ref, code, message) {
  return failure("policy", code, message, { evidenceId: ref.evidenceId, path: ref.path });
}

export async function reconcileChildArtifacts({
  refs = [],
  artifactRefs = refs,
  resolver,
  expectedOwner,
  expectedRunId,
  consumerRevision,
  schemaRegistry,
  asOf = new Date(),
} = {}) {
  if (!resolver || typeof resolver.resolve !== "function")
    throw new TypeError("artifact resolver is required");
  if (
    !schemaRegistry ||
    typeof schemaRegistry.validate !== "function" ||
    typeof schemaRegistry.resolve !== "function"
  )
    throw new TypeError("schema registry is required for artifact reconciliation");
  const reconciled = [];
  const failures = [];
  const seen = new Map();
  for (const ref of artifactRefs) {
    const resolution = await resolver.resolve(ref.path, {
      expectedFileDigest: ref.fileDigest ?? ref.digest,
      expectedSourceDigest: ref.sourceDigest,
      expectedSourceArtifactId: ref.sourceArtifactId,
      expectedSourceRunId: ref.sourceRunId,
      expectedOwner: ref.owner ?? expectedOwner,
      expectedArtifactId: ref.artifactId,
      consumerRevision,
    });
    const blocked = classifyResolution(resolution);
    if (blocked) {
      failures.push({ ...blocked, evidenceId: ref.evidenceId, path: ref.path });
      reconciled.push({
        ...ref,
        status: blocked.class === "policy" ? "unavailable" : blocked.class,
        resolution,
      });
      continue;
    }
    const record = resolution.value;
    if (!record || typeof record !== "object") {
      const invalid = artifactFailure(ref, "schema-invalid", "resolved artifact has no record");
      failures.push(invalid);
      reconciled.push({ ...ref, status: "unavailable", resolution });
      continue;
    }
    const resolvedEvidenceId = record.evidenceId ?? record.artifact?.evidenceId;
    const resolvedOwner = resolution.owner ?? record.owner ?? record.artifact?.owner;
    const resolvedRunId = record.runId ?? record.artifact?.runId;
    const resolvedSchema = record.schema ?? record.artifact?.schema;
    const resolvedDigest = resolution.fileDigest ?? record.digest ?? record.artifact?.digest;
    if (!ref.evidenceId || !ref.owner || !ref.sourceRunId || !ref.schema || !ref.fileDigest) {
      const invalid = artifactFailure(
        ref,
        "schema-invalid",
        "resolved artifact identity, owner, run, schema, and digest are required",
      );
      failures.push(invalid);
      reconciled.push({ ...ref, status: "unavailable", resolution });
      continue;
    }
    try {
      schemaRegistry.resolve(ref.schema, Number(ref.schema.split("/").at(-1)));
      const schemaResult = schemaRegistry.validate(ref.schema, record);
      if (!schemaResult.valid) {
        const invalid = artifactFailure(
          ref,
          "schema-invalid",
          "resolved artifact value does not match its registered schema",
        );
        failures.push(invalid);
        reconciled.push({ ...ref, status: "unavailable", resolution });
        continue;
      }
    } catch (error) {
      const invalid = artifactFailure(ref, "schema-invalid", error.message);
      failures.push(invalid);
      reconciled.push({ ...ref, status: "unavailable", resolution });
      continue;
    }
    const identityFailure =
      resolvedEvidenceId !== ref.evidenceId
        ? artifactFailure(
            ref,
            "source-identity-mismatch",
            "resolved evidence identity does not match",
          )
        : resolvedOwner !== ref.owner || resolvedRunId !== ref.sourceRunId
          ? artifactFailure(
              ref,
              "ownership-mismatch",
              "resolved artifact owner or run does not match",
            )
          : resolvedSchema !== ref.schema
            ? artifactFailure(ref, "schema-invalid", "resolved artifact schema does not match")
            : resolvedDigest !== ref.fileDigest
              ? artifactFailure(ref, "digest-mismatch", "resolved artifact digest does not match")
              : null;
    if (identityFailure) {
      failures.push(identityFailure);
      reconciled.push({ ...ref, status: "unavailable", resolution });
      continue;
    }
    if (
      (expectedOwner && resolvedOwner !== expectedOwner) ||
      (expectedRunId && resolvedRunId !== expectedRunId)
    ) {
      const mismatch = failure(
        "policy",
        "ownership-mismatch",
        "resolved artifact identity does not match consumer",
      );
      failures.push(mismatch);
      reconciled.push({ ...ref, status: "unavailable", resolution });
      continue;
    }
    const id = ref.evidenceId ?? record.evidenceId ?? record.artifact?.artifactId;
    const status = currentStatus(ref, record);
    const item = {
      evidenceId: id,
      kind: ref.kind ?? record.kind,
      status,
      owner: resolvedOwner,
      runId: resolvedRunId,
      digest: resolvedDigest,
      source: {
        path: resolution.path,
        artifactId: record.artifactId ?? record.artifact?.artifactId ?? ref.artifactId,
        digest: resolvedDigest,
        schema: record.schema,
        ...(record.sourceDigest ? { sourceDigest: record.sourceDigest } : {}),
        ...(record.sourceRunId ? { sourceRunId: record.sourceRunId } : {}),
      },
      ...(ref.requirementIds ? { requirementIds: ref.requirementIds } : {}),
      ...(ref.acceptanceSignalId ? { acceptanceSignalId: ref.acceptanceSignalId } : {}),
      resolution,
    };
    if (status !== "current")
      failures.push(
        failure(status, `evidence-${status}`, `evidence ${id} is ${status}`, {
          evidenceId: id,
          path: resolution.path,
        }),
      );
    const prior = seen.get(id);
    if (prior && prior.digest !== item.digest) {
      item.status = "contradicted";
      failures.push(
        failure(
          "contradicted",
          "evidence-digest-conflict",
          `evidence ${id} has conflicting digests`,
          { evidenceId: id },
        ),
      );
    }
    seen.set(id, item);
    reconciled.push(item);
  }
  if (artifactRefs.length === 0)
    failures.push(failure("missing", "no-artifacts", "no child artifacts were supplied"));
  return {
    status: failures.length ? "incomplete" : "resolved",
    evidence: reconciled,
    failures,
    asOf: new Date(asOf).toISOString(),
  };
}

export function reconcileRequirementEvidence(ledger, evidenceResult, { now = new Date() } = {}) {
  if (!ledger?.requirements) throw new TypeError("requirement ledger is required");
  const byId = new Map((evidenceResult?.evidence ?? []).map((item) => [item.evidenceId, item]));
  const failures = [...(evidenceResult?.failures ?? [])];
  const requirements = ledger.requirements.map((requirement) => {
    const refs = requirement.evidenceRefs.map((ref) => {
      const item = byId.get(ref.evidenceId);
      if (!item) return { ...ref, status: "missing" };
      const binding = bindingFailure(requirement.requirementId, ref, item);
      if (binding) {
        failures.push(binding);
        return { ...ref, status: "contradicted" };
      }
      if (ref.digest !== item.digest) return { ...ref, status: "contradicted" };
      const declaredSignals = requirement.acceptanceSignalIds ?? [];
      if (
        requirement.criticality === "critical" &&
        declaredSignals.length > 0 &&
        (!declaredSignals.includes(ref.acceptanceSignalId) ||
          item.acceptanceSignalId !== ref.acceptanceSignalId)
      ) {
        failures.push(
          failure(
            "policy",
            "acceptance-signal-mismatch",
            `evidence signal is not declared for requirement: ${requirement.requirementId}`,
            { requirementId: requirement.requirementId, evidenceId: ref.evidenceId },
          ),
        );
        return { ...ref, status: "contradicted" };
      }
      return { ...ref, status: item.status === "current" ? "available" : item.status };
    });
    const current = refs.some((ref) => ref.status === "available");
    const waived = typeof requirement.waiver === "string" && requirement.waiver.length > 0;
    if (requirement.criticality === "critical" && !current && !waived) {
      const status = refs.some((ref) => ref.status === "contradicted")
        ? "contradicted"
        : refs.some((ref) => ref.status === "stale")
          ? "stale"
          : refs.some((ref) => ref.status === "unavailable")
            ? "unavailable"
            : "missing";
      failures.push(
        failure(
          status,
          `critical-evidence-${status}`,
          `critical requirement lacks current evidence: ${requirement.requirementId}`,
          { requirementId: requirement.requirementId },
        ),
      );
      return { ...requirement, status: "unverified", evidenceRefs: refs };
    }
    return {
      ...requirement,
      status: waived ? "waived" : current ? "verified" : requirement.status,
      evidenceRefs: refs,
    };
  });
  return {
    schema: ledger.schema,
    ledgerId: ledger.ledgerId,
    requirements,
    failures,
    checkedAt: new Date(now).toISOString(),
  };
}

function aggregateOne(kind, values = []) {
  const validStatuses = new Set(["pass", "fail", "incomplete", "blocked", "unavailable"]);
  if (values.some((value) => !validStatuses.has(value?.status)))
    return resultFor(kind, "blocked", [], []);
  const scenarios = values.map((value) => value.scenarioId ?? value.id).filter(Boolean);
  const evidenceRefs = values.flatMap((value) => value.evidenceRefs ?? []).filter(Boolean);
  if (values.some((value) => value.status === "fail"))
    return resultFor(kind, "fail", scenarios, evidenceRefs);
  if (values.some((value) => ["blocked", "unavailable"].includes(value.status)))
    return resultFor(
      kind,
      values.some((value) => value.status === "blocked") ? "blocked" : "unavailable",
      scenarios,
      evidenceRefs,
    );
  if (values.some((value) => value.status === "incomplete"))
    return resultFor(kind, "incomplete", scenarios, evidenceRefs);
  if (values.length === 0) return resultFor(kind, "incomplete", scenarios, evidenceRefs);
  return resultFor(kind, "pass", scenarios, evidenceRefs);
}

export function aggregateGates({
  runId,
  phaseId,
  gateId = `gate-${phaseId?.replace(/^phase-/, "") ?? "result"}`,
  technical = [],
  functional = [],
  evidence = [],
  requirementResult,
} = {}) {
  const technicalResult = aggregateOne("technical", technical);
  const functionalResult = aggregateOne("functional", functional);
  const failures = [];
  if (requirementResult?.failures) failures.push(...requirementResult.failures);
  if (technicalResult.status !== "pass")
    failures.push(
      failure(
        technicalResult.status === "fail"
          ? "technical"
          : technicalResult.status === "incomplete"
            ? "missing"
            : technicalResult.status,
        "technical-gate-failed",
        "technical gate did not pass",
      ),
    );
  if (functionalResult.status !== "pass")
    failures.push(
      failure(
        functionalResult.status === "fail"
          ? "functional"
          : functionalResult.status === "incomplete"
            ? "missing"
            : functionalResult.status,
        "functional-gate-failed",
        "functional scenario gate did not pass",
      ),
    );
  const status = failures.some((item) => item.class === "policy" || item.class === "contradicted")
    ? "BLOCKED"
    : failures.some((item) => item.class === "functional" || item.class === "technical")
      ? "FAILED"
      : failures.length
        ? "INCOMPLETE"
        : "VERIFIED";
  return {
    schema: "csm-orchestrate-gate/1",
    gateId,
    runId,
    phaseId,
    technical: technicalResult,
    functional: functionalResult,
    status,
    failures,
    sourceLineage: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      path: item.source?.path ?? item.path,
      digest: item.digest,
      owner: item.owner,
      schema: item.source?.schema ?? item.schema,
      ...(item.source?.sourceDigest ? { sourceDigest: item.source.sourceDigest } : {}),
      ...(item.source?.sourceRunId ? { sourceRunId: item.source.sourceRunId } : {}),
    })),
  };
}

export const reconcileEvidence = reconcileChildArtifacts;
export const aggregateTechnicalFunctionalGates = aggregateGates;

export function validateEvidenceArtifact(artifact, schemaRegistry) {
  if (!schemaRegistry || typeof schemaRegistry.validate !== "function")
    throw new TypeError("schema registry is required");
  const result = schemaRegistry.validate("csm-orchestrate-evidence/1", artifact);
  if (!result.valid) return result;
  return { valid: true, errors: [] };
}

export function validateGateReceipt(receipt, schemaRegistry) {
  if (!schemaRegistry || typeof schemaRegistry.validate !== "function")
    throw new TypeError("schema registry is required");
  return schemaRegistry.validate("csm-orchestrate-gate/1", receipt);
}
