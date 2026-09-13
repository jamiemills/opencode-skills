"use strict";

// T018: child processes inherit the host environment; scrub credential-shaped
// keys so a compromised worker cannot read deployment secrets. Kept in the
// packaged `lib/` tree so it has a closed payload import graph.
const SENSITIVE_ENV_PATTERNS = Object.freeze([
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^NPM_TOKEN$/,
  /^AWS_/,
  /_TOKEN$/,
  /_KEY$/,
  /_PASSWORD$/,
  /_PASSWD$/,
  /_SECRET$/,
  /^SSH_AUTH_SOCK$/,
  /^HTTPS?_PROXY$/i,
  /^ALL_PROXY$/i,
  /^NO_PROXY$/i,
]);

export function scrubChildEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key))) continue;
    env[key] = value;
  }
  return env;
}

export { SENSITIVE_ENV_PATTERNS };
