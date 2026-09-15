"use strict";

import { digest } from "../../lib/schema-runtime/index.mjs";
import { isHostIsolationVerifier, verifyWorkerAttestation } from "./docker-worker-provider.mjs";

const blocked = (code, message) => ({
  status: "blocked",
  failure: { class: "policy", code, message },
});

// T004: mode-aware effective-isolation contract. Isolation is enforced on the
// EFFECTIVE trust reported by the executor adapter for THIS invocation, never on
// the static capability declaration alone (a static verified-sandbox
// declaration would wrongly refuse the csm-autoresearch trusted-local/registered
// route, whose effective isolation is trusted-in-process). Precedence:
// adapter-reported effective isolation > static capability declaration > refuse.
// Unknown/unsupported effective isolation is always refused (fail closed).
export const VERIFIED_SANDBOX = "verified-sandbox";
export const TRUSTED_IN_PROCESS = "trusted-in-process";
export const ISOLATION_FAILURE_CODE = "isolation-unavailable";
export const HOST_ISOLATION_OPT_OUT_SCOPE = "isolation-opt-out";

const ISOLATION_RANK = Object.freeze({
  [TRUSTED_IN_PROCESS]: 1,
  [VERIFIED_SANDBOX]: 2,
});

// T005 (N1 follow-up): the evidence `kind` is an allowlist, not a non-empty
// string. A keyed worker attestation and a host/provider attestation are the
// kinds actually produced; an unknown or future kind must never be able to
// admit a self-provided verified-sandbox claim, so anything else fails closed.
export const WORKER_ATTESTATION_EVIDENCE_KIND = "worker-attestation";
export const PROVIDER_ATTESTATION_EVIDENCE_KIND = "provider-attestation";
const ISOLATION_EVIDENCE_KINDS = new Set([
  WORKER_ATTESTATION_EVIDENCE_KIND,
  PROVIDER_ATTESTATION_EVIDENCE_KIND,
]);

export function isRecognizedIsolationEvidenceKind(kind) {
  return typeof kind === "string" && ISOLATION_EVIDENCE_KINDS.has(kind);
}

// T001 (N1): a verified-sandbox claim is only accepted when the report carries a
// content-bound, host/independently anchored evidence object the gate can check
// WITHOUT trusting a caller-supplied closure. Three ways an evidence object is
// admitted:
//   1. the gate was handed a host-bound `verifier` (a branded provider-owned
//      verifier bound at construction) and it accepts the payload;
//   2. the gate was handed the provider's host-held `anchorKey` and the payload
//      is a keyed worker-attestation document that recomputes against it
//      (`verifyWorkerAttestation`);
//   3. the evidence carries a branded provider-owned verifier (`evidence.verify`
//      created by `createHostIsolationVerifier`/`createWorkerAttestationVerifier`)
//      that accepts the payload.
// In every case the `kind` must be recognized (see
// `isRecognizedIsolationEvidenceKind`) and `digest` must equal the canonical
// digest of `payload`. A bare asserted string, a missing/unrecognized kind, a
// digest/payload mismatch, or an untrusted closure such as `verify: () => true`
// is unbindable and therefore refused (fail closed).
export function verifyIsolationEvidence(evidence, { anchorKey = null, verifier = null } = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (!isRecognizedIsolationEvidenceKind(evidence.kind)) return false;
  if (typeof evidence.digest !== "string" || evidence.digest.length === 0) return false;
  if (evidence.payload === undefined) return false;
  let actual;
  try {
    actual = digest(evidence.payload);
  } catch {
    return false;
  }
  if (actual !== evidence.digest) return false;
  // A host-bound verifier supplied out of band is authoritative: when the caller
  // names one it must be branded, and a failure is terminal (no silent fallback).
  if (verifier !== null && verifier !== undefined) {
    if (!isHostIsolationVerifier(verifier)) return false;
    try {
      return verifier(evidence.payload) === true;
    } catch {
      return false;
    }
  }
  // A host-held anchor key independently checks a keyed worker attestation.
  if (anchorKey !== null && anchorKey !== undefined) {
    try {
      return verifyWorkerAttestation({ doc: evidence.payload, anchorKey }) === true;
    } catch {
      return false;
    }
  }
  // Otherwise the evidence must carry a branded provider-owned verifier.
  if (isHostIsolationVerifier(evidence.verify)) {
    try {
      return evidence.verify(evidence.payload) === true;
    } catch {
      return false;
    }
  }
  return false;
}

// T002: the host-invocation dispatch path runs work in the orchestrator's own
// process, so it cannot satisfy a verified-sandbox (or higher) requirement. Such
// a route is refused unless the caller binds an explicit, approved opt-out that
// names the run and skill and the tier it waives. Shape:
//   { status: "approved", approvalId, scope: ["verified-sandbox"|"isolation-opt-out"],
//     binding: { runId, skill } }
export function approvedHostIsolationOptOut(
  optOut,
  { runId = null, skill = null, required = null } = {},
) {
  if (!optOut || typeof optOut !== "object" || Array.isArray(optOut)) return false;
  if (optOut.status !== "approved") return false;
  if (typeof optOut.approvalId !== "string" || optOut.approvalId.length === 0) return false;
  const scope = Array.isArray(optOut.scope) ? optOut.scope : [optOut.scope];
  if (!scope.includes(HOST_ISOLATION_OPT_OUT_SCOPE) && !scope.includes(required)) return false;
  const binding = optOut.binding;
  return Boolean(binding) && binding.runId === runId && binding.skill === skill;
}

function normalizeIsolationReport(report) {
  if (report === null || report === undefined) return null;
  if (typeof report === "string") return { isolation: report };
  if (typeof report === "object" && !Array.isArray(report)) return report;
  return null;
}

// Adapters may declare effective isolation as a per-invocation function
// (`effectiveIsolation(request)`) or as a static property. A report may be a
// bare isolation string or an object `{ isolation, required?, attestation?,
// evidence?, satisfiable?, selfProvided?, provider?, reason? }`.
export function readEffectiveIsolation(adapter, request) {
  if (!adapter) return null;
  try {
    if (typeof adapter.effectiveIsolation === "function")
      return normalizeIsolationReport(adapter.effectiveIsolation(request));
    if (adapter.effectiveIsolation !== undefined)
      return normalizeIsolationReport(adapter.effectiveIsolation);
    if (adapter.isolation !== undefined) return normalizeIsolationReport(adapter.isolation);
    return null;
  } catch (error) {
    return { isolation: "unknown", reason: String(error?.message ?? error) };
  }
}

export function declaredIsolation(capability) {
  const value = capability?.execution?.isolation;
  return typeof value === "string" && value.length ? value : null;
}

// T003: whether a reported/declared isolation names a tier the gate can rank.
export function isKnownIsolation(value) {
  return Object.hasOwn(ISOLATION_RANK, value);
}

// T003: ordered per-invocation effective-isolation reporters. Each candidate is
// invoked with the request; the first non-null normalized report wins. A
// reporter that throws yields an explicit unknown report so the caller fails
// closed. Returning null means no reporter produced any signal at all.
export async function collectEffectiveIsolation({ reporters = [], request = {} } = {}) {
  for (const reporter of reporters) {
    if (typeof reporter !== "function") continue;
    let raw;
    try {
      raw = await reporter(request);
    } catch (error) {
      return { isolation: "unknown", reason: String(error?.message ?? error) };
    }
    const report = normalizeIsolationReport(raw);
    if (report) return report;
  }
  return null;
}

// T003: effective isolation when no adapter/handler reported one. An adapter
// that runs inside the orchestrator's own process cannot be assumed to exceed
// the trusted-in-process floor, so a trusted requirement is satisfied while a
// higher (verified-sandbox) requirement is unknown and must fail closed — the
// static declaration is never silently copied onto the effective side.
export function effectiveIsolationFloor({ report = null, capability = null } = {}) {
  if (report) return report;
  const declared = declaredIsolation(capability);
  if (declared === null || declared === TRUSTED_IN_PROCESS)
    return { isolation: TRUSTED_IN_PROCESS, required: TRUSTED_IN_PROCESS };
  return {
    isolation: "unknown",
    required: declared,
    reason: "adapter did not report effective isolation",
  };
}

export function resolveEffectiveIsolation({
  adapter = null,
  request = {},
  capability = null,
} = {}) {
  const declared = declaredIsolation(capability);
  const report = readEffectiveIsolation(adapter, request);
  const isolation = report?.isolation ?? declared ?? "unknown";
  // The report is authoritative for the requirement too: a mode-aware adapter
  // that runs a weaker (trusted) route must be able to override the static
  // verified-sandbox declaration without being refused.
  const required = report?.required ?? report?.isolation ?? declared ?? isolation;
  const attestation = report?.attestation ?? capability?.execution?.attestation ?? "none";
  return {
    isolation,
    required,
    attestation,
    evidence: report?.evidence ?? null,
    satisfiable: report?.satisfiable ?? null,
    selfProvided: report?.selfProvided === true,
    provider: report?.provider ?? null,
    reason: report?.reason ?? null,
    source: report ? "adapter" : declared ? "declared" : "none",
    declared,
    report,
  };
}

export function isolationGate({
  adapter = null,
  request = {},
  capability = null,
  node = null,
  enabled = true,
  anchorKey = null,
  verifier = null,
} = {}) {
  const resolved = resolveEffectiveIsolation({ adapter, request, capability });
  if (enabled !== true) return { ok: true, enabled: false, ...resolved };
  const skill = node?.skill ?? request?.skill ?? "node";
  if (!Object.hasOwn(ISOLATION_RANK, resolved.isolation))
    return {
      ok: false,
      enabled: true,
      ...resolved,
      failure: blocked(ISOLATION_FAILURE_CODE, `${skill}: effective isolation is unknown`),
    };
  if (resolved.satisfiable === false)
    return {
      ok: false,
      enabled: true,
      ...resolved,
      failure: blocked(
        ISOLATION_FAILURE_CODE,
        `${skill}: reported ${resolved.isolation} isolation cannot be satisfied (${
          resolved.reason ?? "unspecified"
        })`,
      ),
    };
  if (
    resolved.isolation === VERIFIED_SANDBOX &&
    resolved.selfProvided === true &&
    !verifyIsolationEvidence(resolved.evidence, { anchorKey, verifier })
  )
    return {
      ok: false,
      enabled: true,
      ...resolved,
      failure: blocked(
        ISOLATION_FAILURE_CODE,
        `${skill}: verified-sandbox isolation claim is not evidence-bound`,
      ),
    };
  if (ISOLATION_RANK[resolved.isolation] < ISOLATION_RANK[resolved.required])
    return {
      ok: false,
      enabled: true,
      ...resolved,
      failure: blocked(
        ISOLATION_FAILURE_CODE,
        `${skill}: required ${resolved.required} isolation is not satisfied by effective ${resolved.isolation}`,
      ),
    };
  return { ok: true, enabled: true, ...resolved };
}

// Routing decision for the live dispatch seam: sandbox when the adapter reports
// a verified-sandbox it does NOT self-provide and a runtime is available;
// otherwise fail closed. A self-provided verified-sandbox (e.g. the
// csm-autoresearch generated provider, which runs its own host-attested Docker
// sandbox) stays on the adapter path, but only when the gate can verify its
// evidence binding (see verifyIsolationEvidence).
export function isolationRouting({
  adapter = null,
  request = {},
  capability = null,
  node = null,
  enabled = true,
  runtimeInvocable = false,
  anchorKey = null,
  verifier = null,
} = {}) {
  const gate = isolationGate({ adapter, request, capability, node, enabled, anchorKey, verifier });
  if (!gate.ok) return { action: "blocked", gate, failure: gate.failure };
  if (gate.isolation !== VERIFIED_SANDBOX || gate.selfProvided) return { action: "invoke", gate };
  if (runtimeInvocable) return { action: "sandbox", gate };
  const skill = node?.skill ?? request?.skill ?? "node";
  return {
    action: "blocked",
    gate,
    failure: blocked(
      ISOLATION_FAILURE_CODE,
      `${skill}: verified-sandbox is required but no verified-sandbox runtime is configured`,
    ),
  };
}

export function preflightSkillRoutes(
  route,
  registry,
  bindings = {},
  { requireBindings = false, capabilities = null } = {},
) {
  if (!Array.isArray(route) || route.length === 0)
    return { ok: false, failure: blocked("invalid-route", "selected route must contain nodes") };
  if (!registry || typeof registry.resolveExact !== "function")
    return {
      ok: false,
      failure: blocked("unsupported-handler", "skill executor registry is unavailable"),
    };
  const resolved = [];
  const seen = new Set();
  for (const node of route) {
    if (!node || typeof node !== "object" || seen.has(node.nodeId))
      return {
        ok: false,
        failure: blocked("invalid-route", "route contains a duplicate or malformed node"),
      };
    seen.add(node.nodeId);
    const pinned = requireBindings
      ? bindings[node.skill]
      : (node.executor ?? bindings[node.skill] ?? node);
    if (!pinned)
      return {
        ok: false,
        failure: blocked("stale-handler", `${node.skill}: exact executor binding is required`),
      };
    try {
      const descriptor = registry.resolveExact({
        skill: node.skill,
        contractDigest: pinned.contractDigest,
        handlerDigest: pinned.handlerDigest,
        inputSchemaDigest: pinned.inputSchemaDigest,
        outputSchemaDigest: pinned.outputSchemaDigest,
        receiptSchemaDigest: pinned.receiptSchemaDigest,
        evidenceSchemaDigest: pinned.evidenceSchemaDigest,
        effectiveConfigDigest: pinned.effectiveConfigDigest,
      });
      if (descriptor.skill !== node.skill)
        return {
          ok: false,
          failure: blocked("stale-handler", `handler skill mismatch for ${node.skill}`),
        };
      const capability = Array.isArray(capabilities)
        ? capabilities.find((item) => item.skill === node.skill)
        : capabilities?.skills?.find((item) => item.skill === node.skill);
      if (node.capabilityDigest && !capability)
        return {
          ok: false,
          failure: blocked("capability-missing", `capability is not registered for ${node.skill}`),
        };
      if (node.capabilityDigest && node.capabilityDigest !== capability.digest)
        return {
          ok: false,
          failure: blocked("capability-mismatch", `capability digest mismatch for ${node.skill}`),
        };
      resolved.push(Object.freeze({ node, descriptor }));
    } catch (error) {
      const code = error?.code === "stale-handler" ? "stale-handler" : "unsupported-handler";
      return { ok: false, failure: blocked(code, `${node.skill}: ${error.message}`) };
    }
  }
  return Object.freeze({ ok: true, resolved: Object.freeze(resolved) });
}
