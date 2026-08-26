import assert from "node:assert/strict";
import test from "node:test";
import { runPreflight } from "../scripts/run-final-receipt.mjs";

const ok = (id) => ({ id, status: "verified", detail: "v" });
const fakeRun = () => ok("x");

test("preflight uses the repository Node wrapper and records unavailable checks", () => {
  const result = runPreflight({ expectedSourceSha: "a".repeat(40), run: fakeRun });
  assert.equal(result.checks.node.status, "verified");
  assert.notEqual(result.checks.browser.status, "verified");
});

test("missing command is unavailable, never a success", () => {
  const result = runPreflight({
    run: (id) => (id === "pnpm-policy" ? { status: "unavailable", detail: "missing" } : ok(id)),
  });
  assert.equal(result.checks.pnpm.status, "unavailable");
});

test("tested source commit mismatch is unavailable", () => {
  const result = runPreflight({
    expectedSourceSha: "a".repeat(40),
    run: (id) => (id === "source-commit" ? { status: "verified", detail: "b".repeat(40) } : ok(id)),
  });
  assert.equal(result.checks.sourceCommit.status, "unavailable");
  assert.match(result.checks.sourceCommit.detail, /mismatch/);
});

test("unavailable E2E is not marked verified", () => {
  const result = runPreflight({
    run: (id) => (id === "docker" ? { status: "unavailable", detail: "offline" } : ok(id)),
  });
  assert.notEqual(result.checks.browser.status, "verified");
});
