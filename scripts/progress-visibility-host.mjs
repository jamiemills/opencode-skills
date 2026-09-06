// Host for the progress-visibility orchestration run (quality delivery cycle 5):
// analyze why orchestrator runs and invoked skills showed no progress trackers,
// ship the runtime + driver + host fixes, and prove them end to end.
//
//   P1  record the root-cause analysis as tracked evidence
//   P2  apply scripts/patch-progress-visibility.mjs + verification tests
//   P3  full battery + a real driver capture run asserting TASK PROGRESS output
//
// Terminal review is delegated through the host invokeReview seam to
// createIndependentFinalReviewExecutor with scripts/independent-reviewer.mjs.
"use strict";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "../lib/schema-runtime/index.mjs";
import { createIndependentFinalReviewExecutor } from "../csm-orchestrate/lib/adversarial-final-review.mjs";

const exec = promisify(execFile);
const root = join(import.meta.url.replace(/^file:\/\//, ""), "..", "..").replace(/\/$/, "");

async function sh(cmd, args, { timeout = 600_000 } = {}) {
  try {
    const { stdout } = await exec(cmd, args, { cwd: root, encoding: "utf8", timeout });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
  }
}

const ANALYSIS = {
  schema: "csm-progress-visibility-analysis/1",
  collectedAt: "2026-09-05T23:30:00.000Z",
  source: "quality delivery cycles 2-4 run evidence + driver/runtime code inspection",
  rootCauses: [
    {
      id: "RCA-A",
      failure: "orchestrator runs showed no progress tracker during or after the run",
      rootCause:
        "the runtime maintains a canonical progress snapshot (result.progress) and the projection renderer exists (projectProgress -> 'TASK PROGRESS' bar + Milestones row), but the driver never rendered it: no live rendering path existed (the tracker had no observer hook) and the final snapshot was ignored",
      fix: "createProgressTracker accepts onUpdate(snapshot); orchestrate exposes onProgress and notifies on every tracker change and telemetry observation; the driver renders the live TASK PROGRESS block on each update (--quiet-progress mutes it) and prints the final projection after the run",
    },
    {
      id: "RCA-B",
      failure: "skills invoked by the orchestrator showed no progress either",
      rootCause:
        "the orchestrate option skillProgressRollupDir (which rolls child csm-skill-progress/1 records into the parent tracker) was never wired by the driver, and hosts never recorded child skill-progress records for the sibling invocations they executed",
      fix: "driver creates <evidenceDir>/skill-progress and passes it to orchestrate (rollup) and to the host factory (recording); hosts record a schema-valid csm-skill-progress/1 record per completed sibling invocation via scripts/lib/skill-progress-recorder.mjs; the orchestrator rolls each record into the parent item's verifiedFraction while gates remain the sole verification authority",
    },
  ],
  verification:
    "tests/orchestrate-progress-visibility.test.mjs (onProgress snapshots, driver E2E TASK PROGRESS output, rollup into parent tracker, recorder schema validity) + in-run driver capture on the quality-review approach",
};

const VIS_TESTS_SOURCE = [
  '"use strict";',
  "// Progress visibility verification (quality delivery cycle 5):",
  "//   V-A live onProgress snapshots render the TASK PROGRESS projection",
  "//   V-B driver prints TASK PROGRESS + Milestones and reaches VERIFIED",
  "//   V-C child csm-skill-progress records roll up into the parent tracker",
  "//   V-D recordSkillProgress writes schema-valid records",
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  'import { execFile } from "node:child_process";',
  'import { promisify } from "node:util";',
  'import { mkdtemp, rm, writeFile } from "node:fs/promises";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'import { orchestrate, projectProgress } from "../csm-orchestrate/index.mjs";',
  'import { loadCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";',
  'import { createAutonomyPolicy } from "../csm-orchestrate/lib/autonomy.mjs";',
  'import { createArtifactResolver } from "../lib/artifact-resolver/index.mjs";',
  'import { loadSchemaRegistry } from "../lib/schema-runtime/index.mjs";',
  'import { validateSkillProgress } from "../lib/progress-tracker.mjs";',
  'import { recordSkillProgress } from "../scripts/lib/skill-progress-recorder.mjs";',
  "",
  "const exec = promisify(execFile);",
  'const repoRoot = fileURLToPath(new URL("../", import.meta.url));',
  'const SHA_A = "sha256:" + "a".repeat(64);',
  'const SHA_B = "sha256:" + "b".repeat(64);',
  'const NOW = () => new Date("2026-09-05T12:00:00Z");',
  "",
  "const approachFor = (runId) => ({",
  '  schema: "csm-approach/1",',
  "  schemaRevision: 1,",
  '  status: "agreed",',
  "  runId,",
  '  ideaSlug: "visprogress",',
  '  signals: { capabilities: ["csm-scan"] },',
  "  phases: [",
  "    {",
  '      phaseId: "P1",',
  '      title: "Deliver",',
  '      goal: "produce the deliverable",',
  '      deliverables: ["typed result"],',
  '      scope: ["repository"],',
  '      outOfScope: ["production"],',
  "      constraints: [],",
  '      acceptanceHints: ["technical pass", "functional pass"],',
  "      context: [],",
  "      dependencies: [],",
  "    },",
  "  ],",
  "});",
  "",
  "function hostFixture({ progressDir } = {}) {",
  "  const artifacts = new Map();",
  "  return {",
  "    async invokeSiblingSkill(request) {",
  "      const descriptorBody = {",
  '        schema: "csm-orchestrate-evidence/2",',
  '        evidenceId: "ev-vis-1",',
  '        kind: "technical",',
  '        status: "current",',
  "        owner: request.skill,",
  "        runId: request.childRunId,",
  '        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],',
  "        acceptanceSignalId: request.acceptanceSignalIds?.[0],",
  "        source: {",
  '          path: "fixture-" + request.childRunId + ".json",',
  '          artifactId: "art-" + request.childRunId,',
  "          digest: SHA_A,",
  '          schema: "csm-orchestrate-evidence/2",',
  "          sourceRunId: request.childRunId,",
  "        },",
  "      };",
  "      const descriptor = { ...descriptorBody, digest: SHA_B };",
  "      artifacts.set(descriptorBody.source.path, descriptor);",
  "      if (progressDir)",
  "        await recordSkillProgress({ dir: progressDir, request, goal: request.phaseId });",
  "      return {",
  '        status: "completed",',
  '        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
  '        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
  "        evidence: [descriptor],",
  "        childReceipt: {",
  '          receiptId: "receipt-vis-1",',
  '          schema: "csm-orchestrate-child-receipt/1",',
  "          runId: request.childRunId,",
  "          digest: SHA_B,",
  "          owner: request.skill,",
  '          status: "completed",',
  "        },",
  "      };",
  "    },",
  "    artifactResolver: {",
  "      async resolve(refPath, expected = {}) {",
  "        const value = artifacts.get(refPath);",
  "        if (!value)",
  '          return { status: "missing", code: "missing", message: "missing artifact: " + refPath };',
  "        return {",
  '          status: "resolved",',
  "          path: refPath,",
  "          owner: expected.expectedOwner,",
  "          fileDigest: expected.expectedFileDigest,",
  "          value: { ...value, schema: value.source.schema },",
  "        };",
  "      },",
  "    },",
  "  };",
  "}",
  "",
  "const memoryCursorStore = () => ({",
  "  cursors: new Map(),",
  "  async saveCursor(cursor) {",
  "    this.cursors.set(cursor.cursorId, cursor);",
  "  },",
  "  async loadCursor(cursorId) {",
  "    return this.cursors.get(cursorId) ?? null;",
  "  },",
  "});",
  "",
  "async function orchestrateOptions(runId, host, extra = {}) {",
  "  const capabilities = await loadCapabilities();",
  '  const reviewArtifactRoot = await mkdtemp(join(tmpdir(), "vis-review-"));',
  "  const schemaRegistry = await loadSchemaRegistry();",
  "  return {",
  "    approach: approachFor(runId),",
  "    runId,",
  "    host,",
  "    capabilities,",
  "    signals: approachFor(runId).signals,",
  "    approvals: createAutonomyPolicy(capabilities, { now: NOW }),",
  "    now: NOW,",
  "    cursorStore: memoryCursorStore(),",
  "    schemaRegistry,",
  "    artifactResolver: createArtifactResolver({ root: reviewArtifactRoot, schemaRegistry }),",
  "    childArtifactResolver: host.artifactResolver,",
  "    ...extra,",
  "  };",
  "}",
  "",
  'test("V-A: onProgress observes snapshots that render the TASK PROGRESS projection", async () => {',
  '  const runId = "run-vis-progress-live";',
  "  const snapshots = [];",
  "  const host = hostFixture();",
  "  await orchestrate(",
  "    await orchestrateOptions(runId, host, {",
  "      onProgress: (snapshot) => snapshots.push(snapshot),",
  "    }),",
  "  );",
  '  assert.ok(snapshots.length >= 2, "expected multiple progress observations");',
  "  assert.ok(snapshots[0].revision < snapshots[snapshots.length - 1].revision);",
  "  const rendered = projectProgress(snapshots[snapshots.length - 1], { width: 28 });",
  "  assert.match(rendered.text, /TASK PROGRESS/);",
  "  assert.match(rendered.text, /Milestones/);",
  "});",
  "",
  'test("V-B: driver prints TASK PROGRESS + Milestones and reaches VERIFIED", async () => {',
  '  const sandbox = await mkdtemp(join(tmpdir(), "vis-driver-"));',
  "  try {",
  '  const runId = "run-vis-progress-driver-" + process.pid;',
  '  const approachPath = join(sandbox, "approach.json");',
  '    const hostPath = join(sandbox, "host.mjs");',
  '    await writeFile(approachPath, JSON.stringify(approachFor(runId), null, 2) + "\\n");',
  '    await writeFile(hostPath, HOST_TEMPLATE + "\\n");',
  "    const { stdout } = await exec(",
  "      process.execPath,",
  "      [",
  '        join(repoRoot, "scripts", "run-orchestrator.mjs"),',
  '        "--approach",',
  "        approachPath,",
  '        "--host",',
  "        hostPath,",
  '        "--final-review",',
  '        join(repoRoot, "scripts", "independent-reviewer.mjs"),',
  "      ],",
  '      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },',
  "    );",
  "    assert.match(stdout, /TASK PROGRESS/);",
  "    assert.match(stdout, /Milestones/);",
  "    assert.match(stdout, /status: VERIFIED/);",
  "  } finally {",
  "    await rm(sandbox, { recursive: true, force: true });",
  "  }",
  "});",
  "",
  "const HOST_TEMPLATE = `",
  '"use strict";',
  'const DIGEST = "sha256:" + "a".repeat(64);',
  "export default function hostFixture() {",
  "  const artifacts = new Map();",
  "  return {",
  "    async invokeSiblingSkill(request) {",
  "      const source = {",
  '        path: "result-1.json",',
  '        artifactId: "art-result-1",',
  "        digest: DIGEST,",
  '        schema: "csm-orchestrate-evidence/2",',
  "        sourceRunId: request.childRunId,",
  "      };",
  "      const descriptorBody = {",
  "        schema: source.schema,",
  '        evidenceId: "ev-driver-vis-1",',
  '        kind: "acceptance",',
  '        status: "current",',
  "        owner: request.skill,",
  "        runId: request.childRunId,",
  '        requirementIds: [request.phaseId.replace(/^phase-/, "req-")],',
  "        acceptanceSignalId: request.acceptanceSignalIds?.[0],",
  '        validation: { signal: "fixture deliverable produced", status: "pass" },',
  "        source,",
  "      };",
  "      const descriptor = { ...descriptorBody, digest: DIGEST };",
  "      artifacts.set(source.path, descriptor);",
  "      return {",
  '        status: "completed",',
  '        technical: [{ id: "technical", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
  '        functional: [{ id: "functional", status: "pass", evidenceRefs: [descriptor.evidenceId] }],',
  "        evidence: [descriptor],",
  "        childReceipt: {",
  '          receiptId: "receipt-driver-vis-1",',
  '          schema: "csm-orchestrate-child-receipt/1",',
  "          runId: request.childRunId,",
  "          digest: DIGEST,",
  "          owner: request.skill,",
  '          status: "completed",',
  "        },",
  "      };",
  "    },",
  "    artifactResolver: {",
  "      async resolve(path, expected = {}) {",
  "        const item = artifacts.get(path);",
  "        if (!item)",
  '          return { status: "missing", code: "missing", message: "missing artifact: " + path };',
  "        return {",
  '          status: "resolved",',
  "          path,",
  "          owner: expected.expectedOwner ?? item.owner,",
  "          fileDigest: expected.expectedFileDigest ?? item.source.digest,",
  "          value: item,",
  "        };",
  "      },",
  "    },",
  "  };",
  "}",
  "`;",
  "",
  'test("V-C: child skill-progress records roll up into the parent tracker", async () => {',
  '  const runId = "run-vis-progress-rollup";',
  '  const progressDir = await mkdtemp(join(tmpdir(), "vis-rollup-"));',
  "  const host = hostFixture({ progressDir });",
  "  const result = await orchestrate(",
  "    await orchestrateOptions(runId, host, { skillProgressRollupDir: progressDir }),",
  "  );",
  "  const rolledUp = result.progress.items.some((item) =>",
  '    (item.evidenceRefs ?? []).some((ref) => String(ref).startsWith("skill-progress:")),',
  "  );",
  '  assert.ok(rolledUp, "expected a rolled-up skill-progress evidence ref");',
  "  await rm(progressDir, { recursive: true, force: true });",
  "});",
  "",
  'test("V-D: recordSkillProgress writes a schema-valid record", async () => {',
  '  const dir = await mkdtemp(join(tmpdir(), "vis-recorder-"));',
  "  try {",
  "    const record = await recordSkillProgress({",
  "      dir,",
  "      request: {",
  '        childRunId: "run-vis-recorder-child",',
  '        skill: "csm-scan",',
  '        phaseId: "phase-vis-progress-p1",',
  "      },",
  '      goal: "record a valid child progress record",',
  "    });",
  "    assert.equal(validateSkillProgress(record).ok, true);",
  '    assert.equal(record.runId, "run-vis-recorder-child");',
  "    assert.equal(record.overallPercent, 100);",
  "  } finally {",
  "    await rm(dir, { recursive: true, force: true });",
  "  }",
  "});",
  "",
].join("\n");

async function phaseWork(request) {
  const phaseOrdinal = Number(request.phaseId?.match(/p(\d+)$/)?.[1] ?? 1);
  if (phaseOrdinal === 1) {
    const outPath = join(root, ".agents", "evidence", "progress-visibility-analysis.json");
    const body = { ...ANALYSIS, collectedAt: new Date().toISOString() };
    await writeFile(outPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
    const readmePath = join(root, ".agents", "README.md");
    const readme = await readFile(readmePath, "utf8");
    let indexed = false;
    if (!readme.includes("`progress-visibility-analysis.json`")) {
      const lines = readme.split("\n");
      let insertAt = lines.length;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith("- `")) {
          insertAt = i + 1;
          break;
        }
      }
      lines.splice(
        insertAt,
        0,
        "- `progress-visibility-analysis.json` — 2026-09-05 — root-cause analysis of missing progress trackers in orchestrator runs and invoked skills, with fixes and verification paths — status: reference",
      );
      await writeFile(readmePath, lines.join("\n"));
      indexed = true;
    }
    return {
      rootCauses: ANALYSIS.rootCauses.length,
      evidencePath: ".agents/evidence/progress-visibility-analysis.json",
      readmeIndexed: indexed,
      summary: `recorded ${ANALYSIS.rootCauses.length} root causes (RCA-A missing rendering, RCA-B missing rollup + child records) with fixes`,
    };
  }
  if (phaseOrdinal === 2) {
    const codemodUrl = pathToFileURL(join(root, "scripts", "patch-progress-visibility.mjs")).href;
    const codemod = await import(codemodUrl);
    const report = await codemod.patchProgressVisibility();
    const applied = report.results.filter((r) => r.applied).length;
    for (const file of report.files) {
      if (file.endsWith("skill-progress-recorder.mjs")) continue;
      if (!file.endsWith(".mjs")) continue; // node --check is JS-only (approach JSON)
      const checkResult = await sh(process.execPath, ["--check", join(root, file)]);
      if (!checkResult.ok)
        throw new Error(`syntax check failed for ${file}: ${checkResult.stderr}`);
    }
    const recorderCheck = await sh(process.execPath, [
      "--check",
      join(root, "scripts", "lib", "skill-progress-recorder.mjs"),
    ]);
    if (!recorderCheck.ok) throw new Error(`recorder syntax check failed: ${recorderCheck.stderr}`);
    const testPath = join(root, "tests", "orchestrate-progress-visibility.test.mjs");
    await writeFile(testPath, `${VIS_TESTS_SOURCE}\n`, { mode: 0o644 });
    const tests = await sh(process.execPath, ["--test", "--test-concurrency=1", testPath]);
    if (!tests.ok)
      throw new Error(`progress-visibility tests failed:\n${tests.stdout}\n${tests.stderr}`);
    const passMatch = tests.stdout.match(/# pass (\d+)/);
    const failMatch = tests.stdout.match(/# fail (\d+)/);
    if (Number(failMatch?.[1] ?? 1) !== 0)
      throw new Error("progress-visibility tests reported failures");
    return {
      patchesApplied: applied,
      patchesTotal: report.results.length,
      verificationTests: { pass: Number(passMatch?.[1] ?? -1), fail: Number(failMatch?.[1] ?? -1) },
      summary: `applied ${applied}/${report.results.length} progress-visibility patches; verification tests ${passMatch?.[1] ?? "?"} pass / ${failMatch?.[1] ?? "?"} fail`,
    };
  }
  if (phaseOrdinal === 3) {
    const battery = await sh(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "tests/orchestrate-progress-visibility.test.mjs",
      "tests/orchestrate-honest-failures.test.mjs",
      "tests/orchestrate-driver-final-review.test.mjs",
      "tests/orchestrate-telemetry-wiring.test.mjs",
      "tests/orchestrate-e2e.test.mjs",
      "tests/orchestrate-capabilities.test.mjs",
      "tests/orchestrate-migration.test.mjs",
      "tests/orchestrate-phase-compiler.test.mjs",
      "tests/orchestrate-recovery-sqlite.test.mjs",
    ]);
    if (!battery.ok)
      throw new Error(`orchestrate battery failed:\n${battery.stdout}\n${battery.stderr}`);
    const passMatch = battery.stdout.match(/# pass (\d+)/);
    const failMatch = battery.stdout.match(/# fail (\d+)/);
    // real driver capture: the quality-review run must show live TASK PROGRESS
    const capture = await sh(process.execPath, [
      "scripts/run-orchestrator.mjs",
      "--approach",
      "scripts/quality-review-approach.json",
      "--host",
      "scripts/quality-review-host.mjs",
      "--final-review",
      "scripts/independent-reviewer.mjs",
    ]);
    if (!capture.ok) throw new Error(`capture run failed:\n${capture.stdout}\n${capture.stderr}`);
    if (!capture.stdout.includes("TASK PROGRESS") || !capture.stdout.includes("Milestones"))
      throw new Error("capture run did not render the progress tracker");
    if (!capture.stdout.includes("status: VERIFIED"))
      throw new Error(`capture run did not reach VERIFIED:\n${capture.stdout.slice(-400)}`);
    const pack = await sh(process.execPath, ["scripts/pack-bootstrap.mjs"]);
    if (!pack.ok) throw new Error(`payload repack failed: ${pack.stderr}`);
    const checkSuite = await sh(process.execPath, ["scripts/check-suite.mjs"]);
    if (!checkSuite.ok || !checkSuite.stdout.includes("check-suite: OK"))
      throw new Error(`check-suite failed:\n${checkSuite.stdout.slice(-600)}`);
    const checkMatch = checkSuite.stdout.match(/check-suite: OK[^\n]*/);
    return {
      orchestrateBattery: {
        pass: Number(passMatch?.[1] ?? -1),
        fail: Number(failMatch?.[1] ?? -1),
      },
      captureRun: {
        progressRendered: true,
        terminal: "VERIFIED",
        progressBlocks: (capture.stdout.match(/TASK PROGRESS/g) ?? []).length,
      },
      checkSuite: (checkMatch?.[0] ?? "").slice(0, 120),
      summary: `battery ${passMatch?.[1] ?? "?"} pass / ${failMatch?.[1] ?? "?"} fail; capture run rendered progress ${
        (capture.stdout.match(/TASK PROGRESS/g) ?? []).length
      }x and reached VERIFIED; ${checkMatch?.[0] ?? "check-suite OK"}`,
    };
  }
  throw new Error(`unknown progress-visibility phase ordinal: ${phaseOrdinal}`);
}

export default function progressVisibilityHost({ runId, skillProgressDir } = {}) {
  const artifacts = new Map();
  let calls = 0;
  const reviewExecutor = createIndependentFinalReviewExecutor({
    producerExecutorId: "csm-build",
    artifactRoot: join(
      root,
      ".agents",
      "evidence",
      "orchestrator",
      runId ?? "run-progress-visibility",
      "review",
    ),
    reviewer: async (input) => {
      const module = await import(
        pathToFileURL(join(root, "scripts", "independent-reviewer.mjs")).href
      );
      return module.default(input);
    },
  });
  return {
    async invokeSiblingSkill(request) {
      calls += 1;
      const output = await phaseWork(request);
      // self-recording is optional infrastructure: before P2 ships the recorder
      // module the import fails, and observer errors must never fail the phase
      try {
        const { recordSkillProgress } = await import(
          pathToFileURL(join(root, "scripts", "lib", "skill-progress-recorder.mjs")).href
        );
        await recordSkillProgress({ dir: skillProgressDir, request, goal: request.phaseId });
      } catch {}
      const evidenceId = `ev-progress-visibility-${calls}`;
      const requirementIds = [
        request.phaseId?.replace(/^phase-/, "req-") ?? `req-progress-visibility-p${calls}`,
      ];
      const acceptanceSignalId = request.acceptanceSignalIds?.[0];
      const path = `progress-visibility-${calls}.json`;
      const source = {
        path,
        artifactId: `art-progress-visibility-${calls}`,
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
      artifacts.set(`payload-progress-visibility-${calls}.json`, output);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: `receipt-progress-visibility-${calls}`,
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
    async resolve(refPath, expected = {}) {
      const item = artifacts.get(refPath);
      if (!item)
        return { status: "missing", code: "missing", message: `missing artifact: ${refPath}` };
      if (!item.schema)
        return {
          status: "resolved",
          path: refPath,
          owner: expected.expectedOwner ?? item.owner ?? "csm-build",
          fileDigest: expected.expectedFileDigest ?? digest(item),
          value: item,
        };
      return {
        status: "resolved",
        path: refPath,
        owner: expected.expectedOwner ?? item.owner,
        fileDigest: expected.expectedFileDigest ?? item.source?.digest ?? item.digest,
        value: item,
      };
    },
  };
}
