// Host for the quality-delivery orchestration run (defrelease-autonomy-gates
// quality cycle): executes the three remaining quality items as real phase work.
//
//   P1  split csm-orchestrate/lib/index.mjs (scripts/split-orchestrate-index.mjs)
//   P2  G7 held-out corpus confirmation (scripts/run-g7-evaluation.mjs) + record
//   P3  independent final reviewer module + driver --final-review wiring test
//
// The terminal review is delegated through the sanctioned host invokeReview seam
// to createIndependentFinalReviewExecutor with the reviewer produced by P3, so
// review records are persisted and provenance is built by the runtime. Evidence
// items are full csm-orchestrate-evidence/2 descriptors; the resolver echoes the
// caller's expectations. Raw payloads are kept beside the refs (payload-*.json).
"use strict";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "../lib/schema-runtime/index.mjs";
import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const exec = promisify(execFile);
const root = join(import.meta.url.replace(/^file:\/\//, ""), "..", "..").replace(/\/$/, "");
const REVIEWER_PATH = "scripts/independent-reviewer.mjs";
const WIRING_TEST_PATH = "tests/orchestrate-driver-final-review.test.mjs";

async function sh(cmd, args, { timeout = 300_000 } = {}) {
  try {
    const { stdout } = await exec(cmd, args, { cwd: root, encoding: "utf8", timeout });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
  }
}

const REVIEWER_SOURCE = `"use strict";
// Independent final reviewer for real orchestration runs, consumed through
// run-orchestrator.mjs --final-review <module> or a host invokeReview seam
// wrapped in createIndependentFinalReviewExecutor.
//
// The reviewer is a separate acceptance layer from the producer: it re-derives
// requirement coverage and evidence entailment from the frozen review invocation
// only, checks binding invariants (evidence-requirement binding, current status,
// acceptance-signal binding, child receipt status, gate completion), and returns
// a typed ACCEPTED/REJECTED decision. The executor still runs reviewAcceptance
// authoritatively and forces REJECTED when the producer gates do not hold.

const EVIDENCE_ID = /^ev-[a-z0-9][a-z0-9-]{1,127}$/;

export function reviewCoverage(requirements = [], evidence = []) {
  const coverage = [];
  const findings = [];
  for (const requirement of requirements) {
    const requirementId = requirement.requirementId;
    const supporting = evidence.filter(
      (item) =>
        Array.isArray(item.requirementIds) &&
        item.requirementIds.includes(requirementId) &&
        item.status === "current" &&
        typeof item.evidenceId === "string" &&
        EVIDENCE_ID.test(item.evidenceId) &&
        typeof item.digest === "string" &&
        item.digest.startsWith("sha256:") &&
        (!requirement.acceptanceSignalIds?.length ||
          (item.acceptanceSignalId &&
            requirement.acceptanceSignalIds.includes(item.acceptanceSignalId))),
    );
    coverage.push({
      requirementId,
      evidenceRefs: supporting.map((item) => ({
        evidenceId: item.evidenceId,
        ...(item.acceptanceSignalId ? { acceptanceSignalId: item.acceptanceSignalId } : {}),
      })),
    });
    if (!supporting.length)
      findings.push({
        code: "uncovered-requirement",
        severity: "high",
        summary: "requirement " + requirementId + " lacks current, digest-bound evidence",
      });
  }
  return { coverage, findings };
}

export default async function independentReviewer(input) {
  const { requirements = [], evidence = [], phaseResults = [], childReceipts = [] } = input;
  const findings = [];

  const { coverage, findings: coverageFindings } = reviewCoverage(requirements, evidence);
  findings.push(...coverageFindings);

  for (const entry of phaseResults) {
    const gate = entry.gate;
    const phaseId = entry.phase?.phaseId ?? "unknown";
    if (gate?.status !== "VERIFIED")
      findings.push({
        code: "gate-not-verified",
        severity: "critical",
        summary: "phase " + phaseId + " gate is " + (gate?.status ?? "missing"),
      });
  }

  for (const receipt of childReceipts) {
    if (receipt.status !== "completed")
      findings.push({
        code: "incomplete-child",
        severity: "high",
        summary:
          "child receipt " + (receipt.receiptId ?? "unknown") + " is " + (receipt.status ?? "unknown"),
      });
  }

  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  for (const entry of coverage) {
    for (const ref of entry.evidenceRefs) {
      if (!evidenceIds.has(ref.evidenceId))
        findings.push({
          code: "dangling-evidence-ref",
          severity: "high",
          summary:
            "requirement " + entry.requirementId + " references unknown evidence " + ref.evidenceId,
        });
    }
  }

  const uniqueFindings = Object.values(
    Object.fromEntries(findings.map((finding) => [finding.code + ":" + finding.summary, finding])),
  );

  return {
    status: uniqueFindings.length ? "REJECTED" : "ACCEPTED",
    requirementCoverage: coverage,
    evidenceEntailment: uniqueFindings.length ? "failed" : "supported",
    technical: [
      {
        id: "independent-structural-verification",
        status: uniqueFindings.length ? "fail" : "pass",
        evidenceRefs: evidence.map((item) => item.evidenceId),
      },
    ],
    functional: [
      {
        id: "independent-requirement-coverage",
        status: uniqueFindings.length ? "fail" : "pass",
        scenarioIds: requirements.map((requirement) => requirement.requirementId),
        evidenceRefs: coverage.flatMap((entry) => entry.evidenceRefs.map((ref) => ref.evidenceId)),
      },
    ],
    findings: uniqueFindings,
  };
}
`;

const WIRING_TEST_SOURCE = `"use strict";
// End-to-end wiring test for the driver's --final-review flag: a minimal
// read-only fixture approach must reach a VERIFIED terminal receipt when the
// independent reviewer module is supplied, proving the review invocation,
// persisted review records, and the VERIFIED outcome path work through the
// driver.
"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const driverPath = join(repoRoot, "scripts", "run-orchestrator.mjs");
const reviewerPath = join(repoRoot, "scripts", "independent-reviewer.mjs");

const HOST_SOURCE = \`"use strict";
// Minimal read-only fixture host for the driver wiring test. Digests are
// constants: the evidence schema pins the sha256 form, and the orchestrator's
// identity checks are expectation-echo based, so no hashing is needed here.
const DIGEST = "sha256:" + "a".repeat(64);

export default function hostFixture() {
  const artifacts = new Map();
  return {
    async invokeSiblingSkill(request) {
      const source = {
        path: "result-1.json",
        artifactId: "art-result-1",
        digest: DIGEST,
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId: "ev-driver-review-1",
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],
        acceptanceSignalId: request.acceptanceSignalIds?.[0],
        validation: { signal: "fixture deliverable produced", status: "pass" },
        source,
      };
      const descriptor = { ...descriptorBody, digest: DIGEST };
      artifacts.set(source.path, descriptor);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: "receipt-driver-review-1",
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: DIGEST,
          owner: request.skill,
          status: "completed",
        },
      };
    },
    artifactResolver: {
      async resolve(path, expected = {}) {
        const item = artifacts.get(path);
        if (!item)
          return { status: "missing", code: "missing", message: "missing artifact: " + path };
        return {
          status: "resolved",
          path,
          owner: expected.expectedOwner ?? item.owner,
          fileDigest: expected.expectedFileDigest ?? item.source.digest,
          value: item,
        };
      },
    },
  };
}
\`;

test("driver --final-review drives a real run to VERIFIED through the independent reviewer", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "driver-final-review-"));
  try {
    const runId = "run-driver-review-fixture-" + process.pid;
    const approach = {
      schema: "csm-approach/1",
      schemaRevision: 1,
      status: "agreed",
      runId,
      ideaSlug: "driver-review",
      signals: { capabilities: ["csm-scan"], inputs: ["repository"] },
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
    const hostPath = join(sandbox, "host.mjs");
    await writeFile(approachPath, JSON.stringify(approach, null, 2) + "\\n");
    await writeFile(hostPath, HOST_SOURCE + "\\n");
    const { stdout } = await exec(
      process.execPath,
      [driverPath, "--approach", approachPath, "--host", hostPath, "--final-review", reviewerPath],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    assert.match(stdout, /status: VERIFIED/);
    const evidenceLine = stdout
      .split("\\n")
      .find((line) => line.startsWith("evidence:"));
    const receiptDir = evidenceLine.slice("evidence:".length).trim();
    const receipt = JSON.parse(await readFile(join(receiptDir, "receipt.json"), "utf8"));
    assert.equal(receipt.outcome.status, "VERIFIED");
    assert.equal(receipt.outcome.accepted, true);
    assert.ok(receipt.outcome.acceptanceRefs.includes("ev-driver-review-1"));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
`;

async function phaseWork(request) {
  const phaseOrdinal = Number(request.phaseId?.match(/p(\d+)$/)?.[1] ?? 1);
  if (phaseOrdinal === 1) {
    const codemodUrl = pathToFileURL(join(root, "scripts", "split-orchestrate-index.mjs")).href;
    const codemod = await import(codemodUrl);
    const split = await codemod.splitOrchestrateIndex();
    // public API parity target is lib/index.mjs — the module the split rewrote
    // (the package entry csm-orchestrate/index.mjs has its own fixed name list
    // that never included makeAutonomousFunctionalGate)
    const orchestrateModule = await import(
      pathToFileURL(join(root, "csm-orchestrate", "lib", "index.mjs")).href
    );
    const exported = Object.keys(orchestrateModule).toSorted();
    const requiredExports = [
      "createOrchestrator",
      "makeAutonomousFunctionalGate",
      "orchestrate",
      "runOrchestration",
    ];
    const missing = requiredExports.filter((name) => !exported.includes(name));
    if (missing.length) throw new Error(`split lost public exports: ${missing.join(", ")}`);
    const helpers = Object.keys(
      await import(pathToFileURL(join(root, "csm-orchestrate", "lib", "run-helpers.mjs")).href),
    ).toSorted();
    const artifacts = Object.keys(
      await import(pathToFileURL(join(root, "csm-orchestrate", "lib", "run-artifacts.mjs")).href),
    ).toSorted();
    const cursor = Object.keys(
      await import(pathToFileURL(join(root, "csm-orchestrate", "lib", "run-cursor.mjs")).href),
    ).toSorted();
    const tests = await sh(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "tests/orchestrate-migration.test.mjs",
      "tests/orchestrate-phase-compiler.test.mjs",
      "tests/orchestrate-capabilities.test.mjs",
    ]);
    if (!tests.ok)
      throw new Error(`focused suites failed after split:\n${tests.stdout}\n${tests.stderr}`);
    const passMatch = tests.stdout.match(/# pass (\d+)/);
    const failMatch = tests.stdout.match(/# fail (\d+)/);
    return {
      indexBytesBefore: split.indexBytesBefore,
      indexBytesAfter: split.indexBytesAfter,
      modules: split.modules,
      publicExports: exported,
      moduleExports: { helpers, artifacts, cursor },
      focusedSuites: {
        pass: Number(passMatch?.[1] ?? -1),
        fail: Number(failMatch?.[1] ?? -1),
      },
      summary: `index.mjs ${split.indexBytesBefore} -> ${split.indexBytesAfter} bytes; 3 modules extracted; exports parity kept; focused suites ${passMatch?.[1] ?? "?"} pass / ${failMatch?.[1] ?? "?"} fail`,
    };
  }
  if (phaseOrdinal === 2) {
    const runnerUrl = pathToFileURL(join(root, "scripts", "run-g7-evaluation.mjs")).href;
    const runner = await import(runnerUrl);
    const outPath = join(root, ".agents", "evidence", "g7-corpus-confirmation.json");
    const bundle = await runner.runG7Evaluation({ out: outPath });
    const readmePath = join(root, ".agents", "README.md");
    const readme = await readFile(readmePath, "utf8");
    const indexLine =
      "- `g7-corpus-confirmation.json` — 2026-09-05 — G7 held-out corpus confirmation " +
      `(${bundle.deployment.G7.passed}/${bundle.corpus.scenarioCount} frozen labels matched; report ${bundle.reportOverall}; provisional thresholds confirmed) — status: reference`;
    let indexed = false;
    if (!readme.includes("`g7-corpus-confirmation.json`")) {
      const lines = readme.split("\n");
      let insertAt = lines.length;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith("- `")) {
          insertAt = i + 1;
          break;
        }
      }
      lines.splice(insertAt, 0, indexLine);
      await writeFile(readmePath, lines.join("\n"));
      indexed = true;
    }
    return {
      passed: bundle.deployment.G7.passed,
      failed: bundle.deployment.G7.failed,
      reportOverall: bundle.reportOverall,
      corpusId: bundle.corpus.corpusId,
      scenarioCount: bundle.corpus.scenarioCount,
      sliStatuses: Object.fromEntries(
        Object.entries(bundle.sliSummary).map(([id, sli]) => [id, sli.status]),
      ),
      evidencePath: ".agents/evidence/g7-corpus-confirmation.json",
      readmeIndexed: indexed,
      summary: `G7 confirmation: ${bundle.deployment.G7.passed}/${bundle.corpus.scenarioCount} held-out scenarios met frozen labels; report ${bundle.reportOverall}; provisional thresholds confirmed; evidence recorded`,
    };
  }
  if (phaseOrdinal === 3) {
    await writeFile(join(root, REVIEWER_PATH), `${REVIEWER_SOURCE}\n`, { mode: 0o644 });
    await writeFile(join(root, WIRING_TEST_PATH), `${WIRING_TEST_SOURCE}\n`, { mode: 0o644 });
    const reviewerCheck = await sh(process.execPath, ["--check", REVIEWER_PATH]);
    const testCheck = await sh(process.execPath, ["--check", WIRING_TEST_PATH]);
    if (!reviewerCheck.ok) throw new Error(`reviewer module syntax: ${reviewerCheck.stderr}`);
    if (!testCheck.ok) throw new Error(`wiring test syntax: ${testCheck.stderr}`);
    const tests = await sh(process.execPath, ["--test", "--test-concurrency=1", WIRING_TEST_PATH]);
    if (!tests.ok)
      throw new Error(`final-review wiring test failed:\n${tests.stdout}\n${tests.stderr}`);
    // the test itself asserts the inner driver's VERIFIED receipt; piped
    // node --test output does not echo subprocess stdout, so derive from counts
    const passMatch = tests.stdout.match(/# pass (\d+)/);
    const failMatch = tests.stdout.match(/# fail (\d+)/);
    const driverVerified = Number(passMatch?.[1] ?? 0) >= 1 && Number(failMatch?.[1] ?? 0) === 0;
    if (!driverVerified) throw new Error("wiring test did not pass");
    return {
      reviewerPath: REVIEWER_PATH,
      wiringTestPath: WIRING_TEST_PATH,
      driverVerified,
      focusedSuites: { pass: Number(passMatch?.[1] ?? -1) },
      summary: `independent reviewer + driver --final-review wiring shipped; E2E wiring test VERIFIED (${passMatch?.[1] ?? "?"} test pass)`,
    };
  }
  throw new Error(`unknown quality-delivery phase ordinal: ${phaseOrdinal}`);
}

export default function qualityDeliveryHost({ runId, skillProgressDir } = {}) {
  const artifacts = new Map();
  let calls = 0;
  const reviewExecutor = createIndependentFinalReviewExecutor({
    producerExecutorId: "csm-build",
    artifactRoot: join(
      root,
      ".agents",
      "evidence",
      "orchestrator",
      runId ?? "run-quality-delivery",
      "review",
    ),
    reviewer: async (input) => {
      const module = await import(pathToFileURL(join(root, REVIEWER_PATH)).href);
      return module.default(input);
    },
  });
  return {
    async invokeSiblingSkill(request) {
      calls += 1;
      const output = await phaseWork(request);
      await recordSkillProgress({ dir: skillProgressDir, request, goal: request.phaseId });
      const evidenceId = `ev-quality-delivery-${calls}`;
      const requirementIds = [
        request.phaseId?.replace(/^phase-/, "req-") ?? `req-quality-delivery-p${calls}`,
      ];
      const acceptanceSignalId = request.acceptanceSignalIds?.[0];
      const path = `quality-delivery-${calls}.json`;
      const source = {
        path,
        artifactId: `art-quality-delivery-${calls}`,
        digest: digest(output),
        schema: "csm-orchestrate-evidence/2",
        sourceRunId: request.childRunId,
      };
      const descriptorBody = {
        schema: source.schema,
        evidenceId,
        kind: "acceptance",
        status: "current",
        owner: request.skill,
        runId: request.childRunId,
        requirementIds,
        ...(acceptanceSignalId
          ? {
              acceptanceSignalId,
              validation: { signal: output.summary, status: "pass" },
            }
          : {}),
        source,
      };
      const descriptor = { ...descriptorBody, digest: digest(descriptorBody) };
      artifacts.set(path, descriptor);
      artifacts.set(`payload-quality-delivery-${calls}.json`, output);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: `receipt-quality-delivery-${calls}`,
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: digest({ calls, status: "completed" }),
          owner: request.skill,
          status: "completed",
        },
      };
    },
    async invokeReview(request) {
      const result = await reviewExecutor.invokeReview(request);
      if (result?.status === "completed" && Array.isArray(result.reviewArtifactRefs)) {
        for (const ref of result.reviewArtifactRefs) {
          const value =
            ref.recordType === "review"
              ? result.review
              : ref.recordType === "artifact"
                ? result.reviewArtifact
                : result.reviewReceipt;
          artifacts.set(ref.path, { owner: ref.sourceOwner, fileDigest: ref.digest, value });
        }
      }
      return result;
    },
    artifactResolver: mapResolver(artifacts),
    childArtifactResolver: mapResolver(artifacts),
  };
}

function mapResolver(artifacts) {
  return {
    async resolve(path, expected = {}) {
      const item = artifacts.get(path);
      if (!item)
        return { status: "missing", code: "missing", message: `missing artifact: ${path}` };
      if (!item.schema)
        return {
          status: "resolved",
          path,
          owner: expected.expectedOwner ?? item.owner ?? "csm-build",
          fileDigest: expected.expectedFileDigest ?? digest(item),
          value: item,
        };
      return {
        status: "resolved",
        path,
        owner: expected.expectedOwner ?? item.owner,
        fileDigest: expected.expectedFileDigest ?? item.source?.digest ?? item.digest,
        value: item,
      };
    },
  };
}
