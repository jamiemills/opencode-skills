import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function make(args, env = {}) {
  return execFileSync("make", args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("adapter integration gates are explicit, required, and separate from default tests", async () => {
  const makefile = await readFile(join(root, "Makefile"), "utf8");
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");

  assert.match(makefile, /test-e2e-required:/);
  assert.match(makefile, /CSM_BROWSE_E2E_REQUIRE=1/);
  assert.match(makefile, /test-generated-sandbox-required:/);
  assert.match(makefile, /probe-sandbox\.mjs --required/);
  assert.match(makefile, /test-adapter-integrations:/);
  assert.match(makefile, /CSM_ADAPTER_INTEGRATIONS_APPROVED/);
  assert.match(makefile, /test-adapter-integrations-required/);
  assert.doesNotMatch(makefile.match(/^test:.*$/m)?.[0] ?? "", /test-adapter-integrations/);
  assert.match(workflow, /run: make test-adapter-integrations/);
  assert.match(workflow, /CSM_ADAPTER_INTEGRATIONS:/);
  assert.match(workflow, /CSM_ADAPTER_INTEGRATIONS_APPROVED:/);
});

test("default adapter integration gate records a skip, not completion evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adapter-gate-"));
  try {
    const summary = join(dir, "github-summary.md");
    const output = make(["test-adapter-integrations"], {
      CSM_ADAPTER_INTEGRATIONS: "0",
      CSM_ADAPTER_INTEGRATIONS_APPROVED: "0",
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.match(output, /SKIP: adapter integration gates not opted in/);
    assert.doesNotMatch(output, /PASS:|VERIFIED|completed/i);
    const record = await readFile(summary, "utf8");
    assert.match(record, /Status:\*\* SKIPPED/);
    assert.match(record, /opt-in was not enabled/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
