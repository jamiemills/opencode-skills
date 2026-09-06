// Host for the end-to-end quality review run: implements the sibling-skill seam
// with REAL repository tooling (read-only). P1 collects quality signals; P2
// reviews and prioritizes them. All outputs are evidence-bound.
//
// Resolver value contract: every evidence item is a full csm-orchestrate-evidence/2
// descriptor; the artifact stored at source.path is that same descriptor, and the
// resolver echoes the caller's expectations (owner/fileDigest). The raw phase
// payload is kept beside the descriptor (payload-*.json) but is never referenced
// by evidence refs, since the evidence schema is closed (additionalProperties: false).
"use strict";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../lib/schema-runtime/index.mjs";
import { recordSkillProgress } from "./lib/skill-progress-recorder.mjs";

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function sh(cmd, args) {
  try {
    const { stdout } = await exec(cmd, args, { cwd: root, encoding: "utf8", timeout: 120000 });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message) };
  }
}

async function collectSignals() {
  const signals = [];
  const notes = await sh("node", ["scripts/check-suite.mjs"]);
  const noteLines = (notes.stdout.match(/^\s+note: .*$/gm) ?? []).map((line) => line.trim());
  signals.push({
    id: "check-suite-notes",
    severity: noteLines.length ? "medium" : "low",
    detail: `${noteLines.length} check-suite note(s)`,
    items: noteLines.slice(0, 12),
  });
  const todos = await sh("grep", [
    "-rn",
    "--include=*.mjs",
    "--include=*.md",
    "-iE",
    "\\b(TODO|FIXME|HACK)\\b",
    "csm-orchestrate",
    "csm-build",
    "lib",
  ]);
  const todoLines = (todos.stdout ?? "").split("\n").filter(Boolean);
  signals.push({
    id: "todo-fixme",
    severity: todoLines.length ? "low" : "low",
    detail: `${todoLines.length} TODO/FIXME/HACK markers in runtime code`,
    items: todoLines.slice(0, 10),
  });
  const runtime = "csm-orchestrate/lib";
  const sizes = [];
  for (const entry of await readdir(runtime)) {
    if (!entry.endsWith(".mjs")) continue;
    const bytes = Buffer.byteLength(await readFile(join(runtime, entry)));
    if (bytes > 60_000) sizes.push(`${entry}: ${(bytes / 1000).toFixed(0)}kB`);
  }
  signals.push({
    id: "file-size-outliers",
    severity: sizes.length ? "medium" : "low",
    detail: sizes.length
      ? "runtime modules over 60kB (maintainability)"
      : "no runtime module exceeds 60kB",
    items: sizes,
  });
  return signals;
}

export default function qualityReviewHost({ skillProgressDir } = {}) {
  const artifacts = new Map();
  let calls = 0;
  let collected = null;
  return {
    async invokeSiblingSkill(request) {
      calls += 1;
      await recordSkillProgress({
        dir: skillProgressDir,
        request,
        goal: request.phaseId,
        percent: 25,
      });
      const phaseOrdinal = Number(request.phaseId?.match(/p(\d+)$/)?.[1] ?? 1);
      const isReview = phaseOrdinal >= 2;
      let output;
      if (!isReview) {
        collected = await collectSignals(request);
        const critical = collected.filter((s) => s.severity === "medium").length;
        output = {
          signals: collected,
          critical,
          summary: `${collected.length} signal classes, ${critical} with medium severity`,
        };
      } else {
        const improvements = (collected ?? [])
          .filter((s) => s.items.length)
          .flatMap((s) =>
            s.items.slice(0, 3).map((item) => ({
              area: s.id,
              severity: s.severity,
              improvement: item,
            })),
          )
          .toSorted((a, b) => (a.severity === b.severity ? 0 : a.severity === "medium" ? -1 : 1));
        output = {
          prioritized: improvements,
          summary: `${improvements.length} prioritized improvements`,
        };
      }
      await recordSkillProgress({
        dir: skillProgressDir,
        request,
        goal: request.phaseId,
        percent: 90,
      });
      const evidenceId = `ev-quality-${calls}`;
      const requirementIds = [
        request.phaseId?.replace(/^phase-/, "req-") ?? `req-quality-p${calls}`,
      ];
      const acceptanceSignalId = request.acceptanceSignalIds?.[0];
      const path = `quality-${calls}.json`;
      const source = {
        path,
        artifactId: `art-quality-${calls}`,
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
      artifacts.set(`payload-quality-${calls}.json`, output);
      return {
        status: "completed",
        technical: [{ id: "technical", status: "pass", evidenceRefs: [evidenceId] }],
        functional: [{ id: "functional", status: "pass", evidenceRefs: [evidenceId] }],
        evidence: [descriptor],
        childReceipt: {
          receiptId: `receipt-quality-${calls}`,
          schema: "csm-orchestrate-child-receipt/1",
          runId: request.childRunId,
          digest: digest({ calls, status: "completed" }),
          owner: request.skill,
          status: "completed",
        },
      };
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
          owner: expected.expectedOwner ?? item.owner ?? "csm-scan",
          fileDigest: expected.expectedFileDigest ?? digest(item),
          value: item,
        };
      return {
        status: "resolved",
        path,
        owner: expected.expectedOwner ?? item.owner,
        fileDigest: expected.expectedFileDigest ?? item.source.digest,
        value: item,
      };
    },
  };
}
