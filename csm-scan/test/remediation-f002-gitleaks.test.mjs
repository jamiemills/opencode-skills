// F-002 — ReDoS via repo-controlled .gitleaks.toml allowlist regex.
//
// Before this fix, compileGitleaksPaths compiled each allowlist `paths` entry
// with bare `new RegExp` and tested it against attacker-chosen file paths; a
// catastrophic pattern like `(a+)+$` hung the single-threaded scanner for
// minutes. After the fix every entry is routed through the shared T203
// regex-complexity policy (validatePluginRegexSource) with a length cap, and
// policy-rejected entries fall back to literal-glob matching (linear, no
// regex engine). A scan-level watchdog discloses a truncated labeling pass.
//
// Seeded fixtures only (no host state).

import assert from "node:assert/strict";
import { test } from "node:test";

import { withFixture } from "./harness.mjs";
import { scan } from "../lib/scan/deep/security.mjs";
import { validatePluginRegexSource } from "../lib/scan/plugins/schema.mjs";

// The exact catastrophic pattern the challenger empirically hung on.
const HOSTILE = "(a+)+$";

function securityFixture(gitleaksToml, extra = {}) {
  return {
    ".gitleaks.toml": gitleaksToml,
    ".env": "TOKEN=ghp_\x312345678901234567890123456789012",
    "src/verify.js": "export const value = 1;\n",
    ...extra,
  };
}

test("F-002: a hostile allowlist pattern is bounded and never hangs or throws", async () => {
  const files = securityFixture(
    `title = "demo"\n[allowlist]\npaths = ["${HOSTILE}", "tests/.*", "vendor/**"]\n`,
  );
  await withFixture("f002-hostile", files, async (dir) => {
    const result = await scan(dir, {});
    assert.equal(result.findings.gitleaks.configPresent, true);
    assert.equal(result.findings.gitleaks.allowlistPathCount, 3);
    // The hostile pattern cannot label anything as allowlisted.
    assert.deepEqual(result.findings.gitleaks.fixtureAllowlisted, []);
  });
});

test("F-002: a policy-validated allowlist pattern still labels matching findings", async () => {
  // `vendor/.*` passes the T203 policy (single unbounded wildcard) and matches
  // the secret-bearing file below; `(a+)+b` is policy-rejected and falls back
  // to literal-glob matching (no regex engine).
  const files = securityFixture('title = "demo"\n[allowlist]\npaths = ["vendor/.*", "(a+)+b"]\n', {
    "vendor/sample.env": "STRIPE=sk_live_\x61bcdefghijklmnopqrstuvwxyz123456\n",
  });
  await withFixture("f002-validated", files, async (dir) => {
    const result = await scan(dir, {});
    assert.ok(
      result.findings.gitleaks.fixtureAllowlisted.includes("Stripe Key"),
      `expected a matching pattern allowlisted: ${JSON.stringify(result.findings.gitleaks.fixtureAllowlisted)}`,
    );
  });
});

test("F-002: allowlist entries above the length cap are skipped, not compiled", async () => {
  const long = "a".repeat(129);
  const files = securityFixture(`title = "demo"\n[allowlist]\npaths = ["${long}", "tests/.*"]\n`);
  await withFixture("f002-lencap", files, async (dir) => {
    const result = await scan(dir, {});
    assert.equal(result.findings.gitleaks.allowlistPathCount, 2);
    assert.equal(result.findings.gitleaks.configPresent, true);
  });
});

test("F-002: the shared regex-complexity policy rejects the hostile class outright", () => {
  for (const source of ["(a+)+$", "(a+)+b", "a*a*b", "a{20,}"]) {
    assert.throws(
      () => validatePluginRegexSource(source),
      (error) => error && error.code === "REGEX_COMPLEXITY",
      `expected ${source} to be rejected by the T203 policy`,
    );
  }
});
