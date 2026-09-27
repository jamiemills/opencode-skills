import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const makefile = readFileSync(resolve(ROOT, "Makefile"), "utf8");
const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");

const recipeLines = (target) => {
  const match = makefile.match(
    new RegExp(`^${target}:[^\\n]*\\n([\\s\\S]*?)(?=\\n[a-zA-Z0-9_.-]+:)`, "m"),
  );
  return (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

test("CI verifies generated mirrors are fresh", () => {
  assert.match(ci, /run: make regen-check\b/);
});

test("ci-mirror runs every CI Repository-gates command", () => {
  const lines = recipeLines("ci-mirror");
  for (const command of [
    "make fmt-check",
    "make lint",
    "make check",
    "make regen-check",
    "make test",
    "git diff --check",
  ]) {
    assert.ok(lines.includes(command), `ci-mirror must run exactly '${command}'`);
  }
});

test("precommit stays the bounded in-loop subset (regen-check, not make test)", () => {
  const lines = recipeLines("precommit");
  assert.ok(lines.includes("make regen-check"), "precommit must run make regen-check");
  assert.ok(lines.includes("node scripts/check-suite.mjs"), "precommit must run check-suite");
  assert.ok(
    lines.some((line) => line.includes("oxlint")),
    "precommit must run oxlint",
  );
  assert.ok(
    !lines.includes("make test"),
    "precommit must not run the full suite (make test stays CI-only / ci-mirror)",
  );
});

test("make test covers the CI-only extra suites", () => {
  const testTarget = (makefile.match(/^test:.*$/m) ?? [""])[0];
  for (const target of [
    "test-package-index",
    "test-deterministic",
    "test-osv-audit",
    "test-progress-tracker",
    "test-enforcement",
    "test-suite-tooling",
    "test-contracts",
    "test-policy",
    "test-hooks",
  ]) {
    assert.ok(testTarget.includes(target), `make test must include ${target}`);
  }
});
