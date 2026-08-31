"use strict";

const blocked = (code, message) => ({
  status: "blocked",
  failure: { class: "policy", code, message },
});

export function preflightSkillRoutes(
  route,
  registry,
  bindings = {},
  { requireBindings = false } = {},
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
        receiptSchemaDigest: pinned.receiptSchemaDigest,
        evidenceSchemaDigest: pinned.evidenceSchemaDigest,
        effectiveConfigDigest: pinned.effectiveConfigDigest,
      });
      if (descriptor.skill !== node.skill)
        return {
          ok: false,
          failure: blocked("stale-handler", `handler skill mismatch for ${node.skill}`),
        };
      resolved.push(Object.freeze({ node, descriptor }));
    } catch (error) {
      const code = error?.code === "stale-handler" ? "stale-handler" : "unsupported-handler";
      return { ok: false, failure: blocked(code, `${node.skill}: ${error.message}`) };
    }
  }
  return Object.freeze({ ok: true, resolved: Object.freeze(resolved) });
}
