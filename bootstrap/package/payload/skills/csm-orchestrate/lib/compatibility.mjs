"use strict";

import { digest } from "../../../lib/schema-runtime/index.mjs";

const signalId = (phaseId, signal) =>
  `sig-${String(phaseId)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()}-${digest(String(signal)).slice(7, 19)}`;

const clone = (value) => structuredClone(value);

export const ORCHESTRATE_COMPATIBILITY_ADAPTERS = Object.freeze([
  {
    id: "orchestrate-approval-1-to-2",
    version: "1",
    schema: "csm-orchestrate-approval",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      return { ...clone(value), schema: "csm-orchestrate-approval/2" };
    },
  },
  {
    id: "orchestrate-invocation-1-to-2",
    version: "1",
    schema: "csm-orchestrate-invocation",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      return {
        ...clone(value),
        schema: "csm-orchestrate-invocation/2",
        upstreamArtifactRefs: [],
        ...(value.acceptanceSignalIds?.length
          ? { acceptanceSignalIds: [...value.acceptanceSignalIds] }
          : {}),
        approval: value.approval
          ? { ...clone(value.approval), schema: "csm-orchestrate-approval/2" }
          : value.approval,
      };
    },
  },
  {
    id: "orchestrate-evidence-1-to-2",
    version: "1",
    schema: "csm-orchestrate-evidence",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      return { ...clone(value), schema: "csm-orchestrate-evidence/2" };
    },
  },
  {
    id: "orchestrate-requirement-1-to-2",
    version: "1",
    schema: "csm-orchestrate-requirement",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      const output = clone(value);
      output.schema = "csm-orchestrate-requirement/2";
      for (const requirement of output.requirements) {
        for (const ref of requirement.evidenceRefs) ref.requirementId ??= requirement.requirementId;
      }
      return output;
    },
  },
  {
    id: "orchestrate-receipt-1-to-2",
    version: "1",
    schema: "csm-orchestrate-receipt",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      const output = clone(value);
      output.schema = "csm-orchestrate-receipt/2";
      if (output.extensions) output.extensions.schema = "csm-orchestrate-receipt-extension/2";
      return output;
    },
  },
  {
    id: "orchestrate-phase-1-to-2",
    version: "1",
    schema: "csm-orchestrate-phase",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      const output = clone(value);
      output.schema = "csm-orchestrate-phase/2";
      output.acceptanceSignalIds = output.acceptanceSignals.map((signal) =>
        signalId(output.phaseId, signal),
      );
      output.handoffEdges ??= [];
      for (const node of output.routeNodes) {
        node.inputs ??= [];
        node.outputs ??= [];
        node.acceptanceSignalIds = node.acceptanceSignals.map((signal) =>
          signalId(output.phaseId, signal),
        );
      }
      return output;
    },
  },
  {
    id: "orchestrate-cursor-1-to-2",
    version: "1",
    schema: "csm-orchestrate-cursor",
    sourceRevision: 1,
    targetRevision: 2,
    transform(value) {
      return { ...clone(value), schema: "csm-orchestrate-cursor/2" };
    },
  },
]);
