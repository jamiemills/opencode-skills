"use strict";

// T008: the env-gated decision CLI. Importing this module is side-effect-free;
// the CLI only runs when it is the process entry point AND CSM_DECISION_CLI=1.
// It resolves the provider through the naming-convention registry
// (CSM_DECISION_PROVIDER, default openrouter), sends exactly one decision, and
// prints the normalized result or failure. It never prints the API key.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createProviderRegistry } from "./providers/index.mjs";
import { createDecisionTransport } from "./transport.mjs";

export const DECISION_CLI_GATE_ENV = "CSM_DECISION_CLI";
export const DECISION_INPUT_ENV = "CSM_DECISION_INPUT";

function parseInput(env, argv) {
  const raw =
    typeof argv?.[0] === "string" && argv[0].trim().length > 0
      ? argv[0]
      : env?.[DECISION_INPUT_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function runDecisionCli({
  env = process.env,
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  write = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const registry = await createProviderRegistry({ env });
  const selection = registry.select();
  const transport = createDecisionTransport({
    provider: selection.descriptor,
    env,
    fetchImpl,
  });
  const result = await transport.send(parseInput(env, argv));
  const record = result.ok
    ? {
        provider: selection.id,
        resolved: !selection.unresolved,
        ok: true,
        decision: result.decision,
      }
    : {
        provider: selection.id,
        resolved: !selection.unresolved,
        ok: false,
        failure: result.failure,
      };
  write(JSON.stringify(record));
  return record;
}

function isDirectInvocation() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation() && process.env[DECISION_CLI_GATE_ENV] === "1") {
  runDecisionCli().catch(() => {
    process.stdout.write(
      JSON.stringify({ ok: false, failure: { class: "unmapped", retryable: false } }),
    );
    process.stdout.write("\n");
  });
}

export default { runDecisionCli };
