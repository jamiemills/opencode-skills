"use strict";

import { digest } from "../../../lib/schema-runtime/index.mjs";

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

// T003: a verified-sandbox claim is only accepted when the report carries a
// content-bound, keyed/attestation evidence object the gate can independently
// check: `digest` must equal the canonical digest of `payload` and `verify()`
// must confirm the keyed/attestation document (for example a provider
// attestation verified through `verifyWorkerAttestation`). A bare asserted
// string, a missing verifier, or a digest/payload mismatch is unbindable and
// therefore refused (fail closed).
export function verifyIsolationEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (typeof evidence.digest !== "string" || evidence.digest.length === 0) return false;
  if (typeof evidence.verify !== "function") return false;
  if (evidence.payload === undefined) return false;
  let actual;
  try {
    actual = digest(evidence.payload);
  } catch {
    return false;
  }
  if (actual !== evidence.digest) return false;
  try {
    return evidence.verify() === true;
  } catch {
    return false;
  }
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
    !verifyIsolationEvidence(resolved.evidence)
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
} = {}) {
  const gate = isolationGate({ adapter, request, capability, node, enabled });
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
