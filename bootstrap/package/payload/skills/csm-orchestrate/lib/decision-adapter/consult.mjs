"use strict";

// T007 (jev-review-judge-substitution): the host-mediated skill consult seam.
// Skills obtain advisory review/judge verdicts through this seam only when a
// host has already opted in through the EXISTING mechanism (the driver builds
// an adapter under --use-jev / request-2, or a direct invocation uses the
// existing CSM_DECISION_CLI=1 env gate). The seam never owns a gate, never
// applies a decision, redacts state before it is sent, writes nothing into the
// repository, and fails open on any transport error.
//
// The seam is constructed with an adapter; it does not build one implicitly.
// `createConsultCli` exists for the env-gated one-off/direct path and reuses
// the existing provider registry + key resolution.

import { redactTraceValue } from "../recovery.mjs";
import { createProviderRegistry } from "./providers/index.mjs";
import { createDecisionTransport } from "./transport.mjs";
import { resolveApiKey } from "./key-resolution.mjs";

export const CONSULT_CLI_GATE_ENV = "CSM_DECISION_CLI";
export const CONSULT_DEFAULTS = Object.freeze({ mode: "live" });

function adviceSummary(advice) {
  if (advice === null || advice === undefined) return null;
  return {
    answer: advice.answer ?? null,
    confidence: Number.isFinite(advice.confidence) ? advice.confidence : null,
    probabilities: advice.probabilities ?? null,
    legend: advice.legend ?? null,
    providerId: advice.providerId ?? null,
    providerModel: advice.providerModel ?? null,
    latencyMs: Number.isFinite(advice.latencyMs) ? advice.latencyMs : null,
    applied: false,
    advisory: true,
  };
}

// Wrap an adapter in the skill-facing seam. Returns the advisory map only.
export function createConsultSeam({ adapter, redact = redactTraceValue } = {}) {
  if (!adapter || typeof adapter.decideBatch !== "function")
    throw new TypeError("consult seam requires a decision adapter");
  return Object.freeze({
    async consultPoints(pointIds, state = null) {
      const ids = Array.isArray(pointIds) ? pointIds : [];
      if (ids.length === 0) return Object.freeze({});
      const safeState = redact === null ? state : redact(state);
      const advice = await adapter.decideBatch(ids, safeState);
      const output = {};
      for (const id of ids) output[id] = adviceSummary(advice?.[id]);
      return Object.freeze(output);
    },
  });
}

// Build the env-gated consult CLI. Reuses the existing CSM_DECISION_CLI=1 gate;
// no new user-facing option is introduced. Never prints a key.
export function createConsultCli({
  env = process.env,
  repoRoot = process.cwd(),
  write = (line) => process.stdout.write(`${line}\n`),
  importAdapter = null,
} = {}) {
  async function run(argv = []) {
    if (env[CONSULT_CLI_GATE_ENV] !== "1") {
      const disabled = { ok: false, reason: "consult seam disabled (set CSM_DECISION_CLI=1)" };
      write(JSON.stringify(disabled));
      return disabled;
    }
    const points = argv.filter((arg) => typeof arg === "string" && arg.length > 0);
    if (points.length === 0) {
      const empty = { ok: false, reason: "no advisory points requested" };
      write(JSON.stringify(empty));
      return empty;
    }
    const { createDecisionAdapter } = importAdapter
      ? { createDecisionAdapter: importAdapter }
      : await import("./index.mjs");
    const registry = await createProviderRegistry({ env });
    const selection = registry.select();
    if (selection.unresolved || selection.descriptor === null) {
      const unresolved = { ok: false, reason: `provider ${selection.id} unresolved`, advice: {} };
      write(JSON.stringify(unresolved));
      return unresolved;
    }
    const resolvedKey = await resolveApiKey({
      apiKeyEnv: selection.descriptor.apiKeyEnv,
      env,
      repoRoot,
    });
    if (resolvedKey.key === null) {
      const missing = { ok: false, reason: "provider key not resolvable", advice: {} };
      write(JSON.stringify(missing));
      return missing;
    }
    const transport = createDecisionTransport({
      provider: selection.descriptor,
      env: { [selection.descriptor.apiKeyEnv]: resolvedKey.key },
    });
    const adapter = createDecisionAdapter({ mode: CONSULT_DEFAULTS.mode, transport });
    const seam = createConsultSeam({ adapter });
    const raw = env.CSM_DECISION_STATE ?? null;
    let state = null;
    if (typeof raw === "string" && raw.trim().length > 0) {
      try {
        state = JSON.parse(raw);
      } catch {
        state = raw;
      }
    }
    const advice = await seam.consultPoints(points, state);
    const record = { ok: true, provider: selection.id, advice };
    write(JSON.stringify(record));
    return record;
  }
  return Object.freeze({ run });
}

export default { CONSULT_CLI_GATE_ENV, createConsultSeam, createConsultCli, adviceSummary };
