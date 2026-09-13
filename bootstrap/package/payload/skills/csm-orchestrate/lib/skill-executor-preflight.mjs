"use strict";

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

const ISOLATION_RANK = Object.freeze({
  [TRUSTED_IN_PROCESS]: 1,
  [VERIFIED_SANDBOX]: 2,
});

function normalizeIsolationReport(report) {
  if (report === null || report === undefined) return null;
  if (typeof report === "string") return { isolation: report };
  if (typeof report === "object" && !Array.isArray(report)) return report;
  return null;
}

// Adapters may declare effective isolation as a per-invocation function
// (`effectiveIsolation(request)`) or as a static property. A report may be a
// bare isolation string or an object `{ isolation, required?, attestation?,
// satisfiable?, selfProvided?, provider?, reason? }`.
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
// sandbox) stays on the adapter path.
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
