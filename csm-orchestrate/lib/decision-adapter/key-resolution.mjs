"use strict";

// T004 (jev-review-judge-substitution): resolve a provider's API key from the
// host process environment, falling back to the repository `.env` file.
//
// Contract: the resolver only ever looks up the descriptor's own `apiKeyEnv`
// name (provider isolation), never logs or returns the key in diagnostics,
// never reads it from argv, and never writes it anywhere. The caller hands the
// resolved value to the injected transport as a single-key env; the descriptor
// reads it from there and it is redacted before any artifact is written. The
// `.env` file is gitignored and host-mediated; a missing key is a fail-open
// `missing` result, never a throw across the adapter boundary.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_ENV_FILE = ".env";
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// Parse simple KEY=VALUE lines. Malformed lines are skipped, never fatal.
export function parseDotEnv(text) {
  const values = {};
  if (typeof text !== "string") return values;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    if (!ENV_NAME_PATTERN.test(name)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Returns { key, source, apiKeyEnv }. source is env | env-file | missing.
export async function resolveApiKey({
  apiKeyEnv,
  env = process.env,
  repoRoot = process.cwd(),
  envFile = DEFAULT_ENV_FILE,
  readFileImpl = readFile,
} = {}) {
  if (typeof apiKeyEnv !== "string" || !ENV_NAME_PATTERN.test(apiKeyEnv))
    throw new TypeError("apiKeyEnv must be an environment variable name");
  const fromEnv = env?.[apiKeyEnv];
  if (present(fromEnv)) return { key: fromEnv.trim(), source: "env", apiKeyEnv };
  let text = null;
  try {
    text = await readFileImpl(join(repoRoot, envFile), "utf8");
  } catch {
    text = null;
  }
  const fromFile = parseDotEnv(text)[apiKeyEnv];
  if (present(fromFile)) return { key: fromFile.trim(), source: "env-file", apiKeyEnv };
  return { key: null, source: "missing", apiKeyEnv };
}

export default { DEFAULT_ENV_FILE, parseDotEnv, resolveApiKey };
