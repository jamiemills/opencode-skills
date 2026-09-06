"use strict";

// Renderer wiring verification (quality delivery cycle 6):
//   RW-A emitRunProjections renders valid MD + HTML from a terminal receipt
//   RW-B the driver emits receipt.md/receipt.html on a real run
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";
import { emitRunProjections } from "../scripts/lib/run-projections.mjs";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const SHA_A = "sha256:" + "a".repeat(64);
const SHA_B = "sha256:" + "b".repeat(64);

const fixtureReceipt = () => ({
  schema: "csm-orchestrate-receipt/2",
  receiptId: "receipt-render-wiring-fixture",
  runId: "run-render-wiring",
  phaseId: "phase-render-wiring-p1",
  childReceipts: [],
  approval: {
    approvalId: "approval-render-wiring",
    scope: ["read"],
    approvedDigest: SHA_A,
    approvedAt: "2026-09-06T00:00:00.000Z",
    expiresAt: "2099-09-06T00:00:00.000Z",
    status: "approved",
  },
  statuses: {
    route: "complete",
    child: "completed",
    artifact: "completed",
    verification: "verified",
    parent: "verified",
  },
  outcome: {
    status: "VERIFIED",
    accepted: true,
    acceptanceRefs: ["ev-render-wiring-1"],
  },
  idempotencyKey: SHA_B,
});

test("RW-A: emitRunProjections renders valid MD + HTML from a terminal receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "render-wiring-"));
  try {
    const registry = await loadSchemaRegistry();
    const out = await emitRunProjections({
      dir,
      receipt: fixtureReceipt(),
      runId: "run-render-wiring",
      schemaRegistry: registry,
    });
    const md = await readFile(out.markdownPath, "utf8");
    assert.ok(md.length > 200, "markdown projection too small");
    assert.match(md, /Outcome/);
    assert.match(md, /VERIFIED/);
    assert.match(md, /untrusted-presentation/);
    const html = await readFile(out.htmlPath, "utf8");
    assert.ok(html.startsWith("<!doctype html>"), "html projection missing doctype");
    assert.match(html, /VERIFIED/);
    assert.match(html, /untrusted-presentation/);
    assert.equal(out.projection.source.schema.id, "csm-orchestrate-receipt/2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RW-B: the driver emits receipt.md/receipt.html on a real run", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "render-driver-"));
  try {
    const runId = "run-render-wiring-driver-" + process.pid;
    const approach = {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId,
      ideaSlug: "render-wiring",
      signals: { capabilities: ["csm-scan"] },
      phases: [
        {
          phaseId: "P1",
          title: "Deliver",
          goal: "produce the deliverable",
          deliverables: ["typed result"],
          scope: ["repository"],
          outOfScope: ["production"],
          constraints: [],
          acceptanceHints: ["technical pass", "functional pass"],
          context: [],
          dependencies: [],
        },
      ],
    };
    const approachPath = join(sandbox, "approach.json");
    await writeFile(approachPath, JSON.stringify(approach, null, 2) + "\n");
    const { stdout } = await exec(
      process.execPath,
      [
        join(repoRoot, "scripts", "run-orchestrator.mjs"),
        "--approach",
        approachPath,
        "--host",
        join(repoRoot, "tests", "fixtures", "renderer-wiring-host.mjs"),
        "--final-review",
        join(repoRoot, "scripts", "independent-reviewer.mjs"),
      ],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.match(stdout, /status: VERIFIED/);
    const evidenceLine = stdout.split("\n").find((line) => line.startsWith("evidence:"));
    const evidenceDir = evidenceLine.slice("evidence:".length).trim();
    const md = await readFile(join(evidenceDir, "receipt.md"), "utf8");
    const html = await readFile(join(evidenceDir, "receipt.html"), "utf8");
    assert.match(md, /VERIFIED/);
    assert.match(md, /Source run: /);
    assert.ok(html.startsWith("<!doctype html>"));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
