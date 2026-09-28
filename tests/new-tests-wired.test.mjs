"use strict";

// T011: guard that every completion-supervisor test file is referenced by a
// literal path in the Makefile or a CI workflow, so a newly added test cannot
// silently become CI-orphaned. The check-suite orphan gate accepts a
// segment-scoped `*` glob; this contract is intentionally stricter and pins
// the exact paths.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");

const NEW_TEST_PATHS = [
  "tests/opencode-plugin/csm-continue-core.test.mjs",
  "tests/opencode-plugin/csm-continue-plugin.test.mjs",
  "tests/opencode-plugin/csm-continue-install.test.mjs",
  "tests/opencode-plugin/csm-continue-cli.test.mjs",
  "tests/opencode-plugin/completion-supervisor-docs.test.mjs",
  "tests/completion-evidence.test.mjs",
  "tests/completion-evidence-gate.test.mjs",
  "tests/agent-session-resume.test.mjs",
  "tests/plan-completion-contract.test.mjs",
  "tests/plan-completion-contract-skill.test.mjs",
  "tests/csm-build-completion-contract.test.mjs",
  "tests/new-tests-wired.test.mjs",
];

const REFERENCE_SOURCES = ["Makefile", ".github/workflows/ci.yml"];

function referenceText() {
  return REFERENCE_SOURCES.map((rel) => readFileSync(join(root, rel), "utf8")).join("\n");
}

test("every new test file is referenced by a literal path in Makefile or CI", () => {
  const text = referenceText();
  for (const rel of NEW_TEST_PATHS) {
    assert.ok(
      text.includes(rel),
      `${rel} is not referenced by a literal path in ${REFERENCE_SOURCES.join(" or ")}`,
    );
  }
});
