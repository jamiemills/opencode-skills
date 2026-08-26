import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTestPackage } from "../csm-build/lib/test-package.mjs";
import { createPlanArtifact } from "../csm-plan/lib/plan.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const packageValue = (overrides = {}) => ({
  schema: "csm-test-package/1",
  packageId: "test-package-t019",
  owner: "csm-make-tests",
  runId: "run-t019",
  sourcePlan: {
    planId: "json-only-plan",
    taskId: "T019",
    planPath: "plan.json",
    planDigest: `sha256:${"a".repeat(64)}`,
  },
  ledger: {
    path: ".agents/tests/ledger.jsonl",
    digest: `sha256:${"b".repeat(64)}`,
    terminal: false,
  },
  verification: {
    path: ".agents/tests/verification.json",
    digest: `sha256:${"c".repeat(64)}`,
    status: "VERIFIED",
  },
  replay: [
    {
      id: "replay-001",
      path: "tests/example.test.mjs",
      digest: `sha256:${"d".repeat(64)}`,
      command: "node --test tests/example.test.mjs",
    },
  ],
  mutation: { status: "verified", score: 1 },
  performance: { status: "verified", baselineId: "bench-001" },
  terminal: false,
  ...overrides,
});

const verificationValue = () => ({
  schema: "csm-make-tests-verification/1",
  artifactId: "verification-t019",
  owner: "csm-make-tests",
  runId: "run-t019",
  sourcePlan: { planId: "json-only-plan", taskId: "T019", planDigest: `sha256:${"a".repeat(64)}` },
  status: "VERIFIED",
  verificationStatus: { format: "csm-verification-status/1", status: "VERIFIED", unresolved: [] },
  evidence: [
    {
      status: "verified",
      references: [
        { id: "evidence-001", path: "evidence.json", digest: `sha256:${"d".repeat(64)}` },
      ],
    },
  ],
  replay: [],
  unresolved: [],
});

test("build accepts and replays a validated JSON test package", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-test-package-"));
  try {
    const plan = createPlanArtifact({ planId: "json-only-plan" });
    await writeFile(join(root, "plan.json"), JSON.stringify(plan));
    const verification = verificationValue();
    await mkdir(join(root, ".agents/tests"), { recursive: true });
    await writeFile(join(root, ".agents/tests/verification.json"), JSON.stringify(verification));
    const value = packageValue({
      sourcePlan: { ...packageValue().sourcePlan, planDigest: digest(plan) },
      verification: { ...packageValue().verification, digest: digest(verification) },
    });
    const result = await resolveTestPackage(value, {
      expectedPlanDigest: digest(plan),
      root,
      replay: true,
    });
    assert.equal(result.status, "resolved");
    assert.equal(result.replay[0].command, "node --test tests/example.test.mjs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build rejects Markdown, HTML, malformed, unknown, projection, stale, and missing input", async () => {
  for (const input of ["legacy-ledger.md", "projection.html", "plain text"])
    assert.notEqual((await resolveTestPackage(input)).status, "resolved");
  for (const value of [
    {},
    packageValue({ schema: "csm-test-package/99" }),
    packageValue({
      verification: { path: "v", digest: `sha256:${"c".repeat(64)}`, status: "INCOMPLETE" },
    }),
    packageValue({ mutation: { status: "stale", score: 0.2 } }),
    packageValue({ performance: { status: "missing", baselineId: "bench" } }),
  ])
    assert.notEqual((await resolveTestPackage(value, { replay: true })).status, "resolved");
  const root = await mkdtemp(join(tmpdir(), "csm-test-package-terminal-"));
  try {
    const plan = createPlanArtifact({ planId: "json-only-plan" });
    await writeFile(join(root, "plan.json"), JSON.stringify(plan));
    const verification = verificationValue();
    await mkdir(join(root, ".agents/tests"), { recursive: true });
    await writeFile(join(root, ".agents/tests/verification.json"), JSON.stringify(verification));
    assert.equal(
      (
        await resolveTestPackage(
          packageValue({
            terminal: true,
            sourcePlan: { ...packageValue().sourcePlan, planDigest: digest(plan) },
            verification: { ...packageValue().verification, digest: digest(verification) },
          }),
          { expectedPlanDigest: digest(plan), root, replay: true },
        )
      ).status,
      "resolved",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
