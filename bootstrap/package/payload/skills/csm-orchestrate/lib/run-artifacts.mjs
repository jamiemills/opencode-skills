"use strict";

// Artifact handoff and reconciliation for the orchestration run loop.
// Extracted from index.mjs (quality-delivery item 4).
import { validateHandoffRef } from "./invocation.mjs";
import { reconcileChildArtifacts } from "./evidence-gates.mjs";
import { compileApproach } from "./phase-compiler.mjs";

function upstreamRefsFor(node, phase, outputsByNode) {
  return phase.handoffEdges
    .filter((edge) => edge.consumerNodeId === node.nodeId)
    .flatMap((edge) => {
      const refs = outputsByNode.get(edge.producerNodeId) ?? [];
      const compatible = refs.filter(
        (ref) =>
          ref.outputName === edge.producerOutput &&
          !validateHandoffRef(ref, {
            owner: edge.producerSkill,
            schema: edge.schema,
            schemaRevision: edge.schemaRevision,
          }),
      );
      if (!compatible.length) throw new TypeError(`missing compatible handoff for ${edge.edgeId}`);
      return compatible.map(({ outputName: _outputName, ...ref }) => ref);
    });
}

async function externalRefsFor(node, refs, artifactResolver, schemaRegistry) {
  const relevant = refs.filter((ref) =>
    node.inputs.some(
      (input) =>
        (ref.inputName ?? ref.name) === input.name &&
        (ref.kind ?? "artifact") === input.kind &&
        (!input.schema || ref.schema === input.schema),
    ),
  );
  for (const ref of relevant) {
    const input = node.inputs.find(
      (candidate) =>
        (ref.inputName ?? ref.name) === candidate.name &&
        (ref.kind ?? "artifact") === candidate.kind &&
        (!candidate.schema || ref.schema === candidate.schema),
    );
    const error = validateHandoffRef(ref, {
      owner: ref.sourceOwner,
      runId: ref.sourceRunId,
      artifactId: ref.sourceArtifactId,
      schema: input.schema ?? undefined,
      schemaRevision: input.schemaRevision ?? undefined,
    });
    if (error)
      throw new TypeError(`invalid external input ${ref.sourceArtifactId ?? ref.name}: ${error}`);
    if (!schemaRegistry?.resolve || !artifactResolver?.resolve)
      throw new TypeError("resolver-backed external inputs are required");
    schemaRegistry.resolve(ref.schema, ref.schemaRevision);
    const resolved = await artifactResolver.resolve(ref.path, {
      expectedOwner: ref.sourceOwner,
      expectedSourceRunId: ref.sourceRunId,
      ...(ref.recordType === "receipt" ? {} : { expectedArtifactId: ref.sourceArtifactId }),
      expectedFileDigest: ref.digest,
    });
    if (
      resolved?.status !== "resolved" ||
      resolved.owner !== ref.sourceOwner ||
      resolved.fileDigest !== ref.digest ||
      resolved.value?.artifactId !== ref.sourceArtifactId ||
      resolved.value?.sourceRunId !== ref.sourceRunId
    )
      throw new TypeError(`external input resolver identity mismatch: ${ref.sourceArtifactId}`);
  }
  return relevant;
}

async function reconcileResult(result, node, childRunId, artifactResolver, schemaRegistry) {
  const refs = [...(result?.outputArtifactRefs ?? [])].map((ref) => ({
    ...ref,
    fileDigest: ref.fileDigest ?? ref.digest,
    sourceRunId: ref.sourceRunId ?? ref.runId,
    requirementIds: [...node.requirementIds],
    acceptanceSignalId: ref.acceptanceSignalId ?? node.acceptanceSignalIds[0],
  }));
  if (!refs.length)
    refs.push(
      ...(result?.evidence ?? []).map((item) => ({
        ...item.source,
        evidenceId: item.evidenceId,
        kind: item.kind,
        owner: item.owner,
        sourceRunId: item.sourceRunId ?? item.runId,
        fileDigest: item.source?.digest ?? item.digest,
        requirementIds: item.requirementIds ?? [...node.requirementIds],
        acceptanceSignalId: item.acceptanceSignalId ?? node.acceptanceSignalIds[0],
      })),
    );
  const resolver = artifactResolver;
  if (!resolver || typeof resolver.resolve !== "function")
    return {
      status: "incomplete",
      evidence: [],
      failures: [
        {
          class: "missing",
          code: "artifact-resolver-required",
          message: "production evidence requires resolver-backed artifact validation",
        },
      ],
    };
  if (
    !schemaRegistry ||
    typeof schemaRegistry.validate !== "function" ||
    typeof schemaRegistry.resolve !== "function"
  )
    return {
      status: "incomplete",
      evidence: [],
      failures: [
        {
          class: "policy",
          code: "schema-registry-required",
          message: "production evidence requires the registered schema registry",
        },
      ],
    };
  for (const ref of result?.outputArtifactRefs ?? []) {
    const declared = node.evidence.find((entry) => entry.kind === ref.kind)?.schema;
    if (declared && ref.schema !== declared)
      return {
        status: "incomplete",
        evidence: [],
        failures: [
          { class: "policy", code: "schema-invalid", message: "artifact schema is not declared" },
        ],
      };
    if (declared && schemaRegistry?.resolve) {
      const match = declared.match(/^(.*)\/(\d+)$/);
      schemaRegistry.resolve(match?.[1] ?? declared, Number(match?.[2] ?? 1));
    }
  }
  return reconcileChildArtifacts({
    artifactRefs: refs,
    resolver,
    expectedOwner: node.skill,
    expectedRunId: childRunId,
    consumerRevision: 1,
    schemaRegistry,
  });
}

async function validateReviewArtifacts(reviewResult, artifactResolver, schemaRegistry) {
  const refs = reviewResult?.reviewArtifactRefs;
  if (!Array.isArray(refs) || refs.length !== 3)
    throw new TypeError("independent review persisted record references are required");
  const recordTypes = new Set(refs.map((ref) => ref?.recordType));
  if (
    recordTypes.size !== 3 ||
    !["review", "artifact", "receipt"].every((type) => recordTypes.has(type))
  )
    throw new TypeError("independent review persisted record references are incomplete");
  const expectedSchemas = {
    review: "csm-orchestrate-adversarial-review/2",
    artifact: "csm-artifact/1",
    receipt: "csm-review-receipt/1",
  };
  const resolvedRecords = new Map();
  for (const ref of refs) {
    if (
      !ref?.recordType ||
      !ref.recordId ||
      !ref.schema ||
      !ref.path ||
      !ref.digest ||
      !ref.sourceDigest ||
      !ref.sourceArtifactId ||
      !ref.sourceRunId ||
      !ref.sourceOwner
    )
      throw new TypeError("independent review artifact reference is incomplete");
    if (ref.schema !== expectedSchemas[ref.recordType])
      throw new TypeError(`independent review reference schema mismatch: ${ref.recordId}`);
    const schemaMatch = ref.schema.match(/^(.*)\/(\d+)$/);
    schemaRegistry.resolve(schemaMatch?.[1] ?? ref.schema, Number(schemaMatch?.[2] ?? 1));
    const resolved = await artifactResolver.resolve(ref.path, {
      expectedOwner: ref.sourceOwner,
      expectedSourceRunId: ref.sourceRunId,
      expectedSourceDigest: ref.sourceDigest,
      ...(ref.recordType === "artifact" ? { expectedArtifactId: ref.sourceArtifactId } : {}),
      expectedFileDigest: ref.digest,
    });
    const value = resolved?.value;
    const identity =
      ref.recordType === "review"
        ? value?.reviewId
        : ref.recordType === "artifact"
          ? value?.artifact?.artifactId
          : value?.receiptId;
    if (
      resolved?.status !== "resolved" ||
      resolved.owner !== ref.sourceOwner ||
      resolved.fileDigest !== ref.digest ||
      value?.schema !== ref.schema ||
      identity !== ref.recordId ||
      (value?.sourceRunId ?? value?.artifact?.runId) !== ref.sourceRunId ||
      (value?.sourceArtifactIds ?? []).includes(ref.sourceArtifactId) !== true ||
      (value?.sourceDigest ?? value?.artifact?.sourceDigest) !== ref.sourceDigest
    ) {
      throw new TypeError(`independent review resolver identity mismatch: ${ref.recordId}`);
    }
    resolvedRecords.set(ref.recordType, value);
  }
  const review = resolvedRecords.get("review");
  const artifact = resolvedRecords.get("artifact");
  const receipt = resolvedRecords.get("receipt");
  const artifactId = artifact?.artifact?.artifactId;
  const sourceArtifactIds = new Set(refs.map((ref) => ref.sourceArtifactId));
  const childRunId = review?.provenance?.reviewerChildRunId;
  if (
    sourceArtifactIds.size !== 1 ||
    !sourceArtifactIds.has(artifactId) ||
    review?.runId !== reviewResult?.review?.runId ||
    review?.owner !== refs.find((ref) => ref.recordType === "review")?.sourceOwner ||
    review?.provenance?.owner !== review?.owner ||
    review?.provenance?.reviewerChildRunId !==
      refs.find((ref) => ref.recordType === "review")?.sourceRunId ||
    review?.sourceDigest !== refs.find((ref) => ref.recordType === "review")?.sourceDigest ||
    review?.provenance?.artifact?.artifactId !== artifactId ||
    review?.provenance?.artifact?.digest !== artifact?.artifact?.digest ||
    review?.provenance?.artifact?.runId !== childRunId ||
    review?.provenance?.artifact?.owner !== review?.owner ||
    review?.provenance?.receipt?.artifactId !== receipt?.receiptId ||
    review?.provenance?.receipt?.digest !==
      refs.find((ref) => ref.recordType === "receipt")?.digest ||
    review?.provenance?.receipt?.owner !== review?.owner ||
    artifact?.artifact?.owner !== review?.owner ||
    receipt?.owner !== review?.owner ||
    receipt?.reviewId !== review?.reviewId ||
    receipt?.reviewArtifactId !== artifactId ||
    receipt?.reviewDigest !== artifact?.artifact?.digest ||
    receipt?.inputDigest !== review?.inputDigest ||
    receipt?.sourceRunId !== childRunId ||
    receipt?.sourceDigest !== review?.sourceDigest
  )
    throw new TypeError("independent review persisted provenance is not bound to final review");
}

export { upstreamRefsFor, externalRefsFor, reconcileResult, validateReviewArtifacts };

/**
 * F-014: compile the remediation approach, splice the remediation phase into
 * the graph at the coordinated insertion point, register it with the progress
 * tracker, and append the lineage record. Shared by the host-review and
 * injected-review final-review paths (previously duplicated verbatim).
 */
export async function spliceRemediationPhase({
  coordinated,
  capabilities,
  signals,
  runId,
  progressTracker,
  remediationLineage,
} = {}) {
  const rawRemediation = coordinated.remediation;
  const insertAt = coordinated.graph.phases.findIndex(
    (phase) => phase.phaseId === rawRemediation.phaseId,
  );
  const remediationGraph = await compileApproach(
    {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId,
      ideaSlug: "remediation",
      phases: [
        {
          phaseId: "P1",
          title: rawRemediation.outcome?.title ?? "Remediate review finding",
          goal: rawRemediation.outcome?.goal ?? rawRemediation.acceptanceSignals.join("; "),
          deliverables: rawRemediation.outcome?.deliverables ?? ["review gap closed"],
          scope: rawRemediation.scope?.include ?? ["declared review gap"],
          outOfScope: rawRemediation.scope?.exclude ?? [],
          constraints: [],
          acceptanceHints: rawRemediation.acceptanceSignals,
          context: [],
          dependencies: [],
        },
      ],
    },
    {
      capabilities,
      signals: { ...signals, capabilities: [rawRemediation.route] },
      graphRevision: coordinated.graph.graphRevision,
      parentPhaseId: rawRemediation.parentPhaseId,
      phaseIdOverride: rawRemediation.phaseId,
    },
  );
  const graph = {
    ...coordinated.graph,
    phases: [
      ...coordinated.graph.phases.slice(0, insertAt),
      Object.freeze({
        ...rawRemediation,
        ...remediationGraph.phases[0],
        graphRevision: rawRemediation.graphRevision,
        parentPhaseId: rawRemediation.parentPhaseId,
        insertion: rawRemediation.insertion,
        order: rawRemediation.order,
        remediationBudget: rawRemediation.remediationBudget,
        requirementDelta: rawRemediation.requirementDelta,
        reviewFindings: rawRemediation.reviewFindings,
        sourceReviewId: rawRemediation.sourceReviewId,
        acceptanceContract: rawRemediation.acceptanceContract,
      }),
      ...coordinated.graph.phases.slice(insertAt + 1),
    ],
  };
  const remediationPhase = graph.phases[insertAt];
  await progressTracker.addPhase(remediationPhase);
  remediationLineage.push({
    sourceReviewId: remediationPhase.sourceReviewId,
    findings: remediationPhase.reviewFindings,
    requirementDelta: remediationPhase.requirementDelta,
    phaseId: remediationPhase.phaseId,
    parentPhaseId: remediationPhase.parentPhaseId,
    acceptanceContract: remediationPhase.acceptanceContract,
  });
  return { graph, insertAt, remediationPhase };
}
