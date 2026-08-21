// F-025 — the report redactor is unified with the deep scanner's token
// families.
//
// Before this fix `sk_live_…`, `xoxb-…`, `eyJ…` JWTs and `npm_…` passed through
// sanitizeText/sanitizeStructuredText unredacted while the deep security
// scanner detected exactly those families. After the fix the token families
// live in one module (shared/token-families.mjs) consumed by both the scanner
// and the redactors, and redaction happens by span.
//
// Seeded fixtures only.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeText, sanitizeStructuredText } from "../lib/scan/report/reporter.mjs";
import { assertPrivacySafe } from "../lib/scan/shared/privacy.mjs";
import { SECRET_TOKEN_FAMILIES } from "../lib/scan/shared/token-families.mjs";
import { isSecretPatternName } from "../lib/scan/deep/security.mjs";

const STRIPE = "sk_live_\x61bcdefghijklmnopqrstuvwxyz123456";
const SLACK = "xoxb-\x31234-5678-9012-abcdefghijklm";
const JWT =
  "eyJ\x68bGciOiJIUzI1NiJ9.eyJ\x7adWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const NPM = "npm_\x3123456789012345678901234567890123456";
const GHP = "ghp_\x312345678901234567890123456789012";
const AKIA = "AKIA\x49OSFODNN7EXAMPLE";

test("F-025: sanitizeText redacts the previously-missing token families by span", () => {
  for (const token of [STRIPE, SLACK, JWT, NPM, GHP, AKIA]) {
    assert.equal(sanitizeText(`prefix ${token} suffix`), "prefix [redacted] suffix", token);
  }
  // Span redaction leaves the surrounding prose intact.
  assert.equal(sanitizeText(`key is ${STRIPE} and done`), "key is [redacted] and done");
});

test("F-025: sanitizeStructuredText redacts token families inside and around scoped names", () => {
  assert.equal(
    sanitizeStructuredText(`dep @scope/pkg uses ${STRIPE}`),
    "dep @scope/pkg uses [redacted]",
  );
  assert.equal(sanitizeStructuredText(`@evil/${GHP}`), `@evil/${"[redacted]"}`);
});

test("F-025: the privacy gate rejects strings carrying scanner token families", () => {
  for (const token of [STRIPE, SLACK, JWT, NPM]) {
    assert.throws(
      () => assertPrivacySafe(token),
      undefined,
      `expected ${token.slice(0, 8)} to be rejected`,
    );
  }
});

test("F-025: the redactor vocabulary is the scanner vocabulary (single source)", () => {
  assert.equal(isSecretPatternName("Stripe Key"), true);
  assert.equal(isSecretPatternName("JWT Token"), true);
  assert.equal(isSecretPatternName("Slack Token"), true);
  assert.equal(isSecretPatternName("NPM Token"), true);
  const names = SECRET_TOKEN_FAMILIES.map(({ name }) => name);
  for (const expected of ["Stripe Key", "JWT Token", "Slack Token", "NPM Token", "GitHub Token"]) {
    assert.ok(names.includes(expected), `family ${expected} missing from shared source`);
  }
});
