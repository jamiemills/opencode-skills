"use strict";

import process from "node:process";
import {
  analyzeRepository,
  defaultArtifactPaths,
  readPublishedPair,
  writeArtifacts,
} from "../lib/ddd/pipeline.mjs";
import { assertPairRunId, assertReportMatchesGraph } from "../lib/ddd/contracts.mjs";
import {
  validateGraph,
  validateGraphFile,
  validateReport,
  validateReportEnvelope,
} from "../lib/ddd/validate.mjs";

function usage() {
  process.stderr.write(
    [
      "usage: node csm-ddd/scripts/ddd.mjs --repo ROOT [options]",
      "",
      "options:",
      "  --repo ROOT            target repository (required)",
      "  --norms PATH           explicit NORMS.md path (default: ROOT/NORMS.md when present)",
      "  --out-report PATH      JSON report output path (default: ROOT/.agents/ddd/<date>-<slug>-<runId>-ddd-report.json)",
      "  --out-graph PATH       graph output path (default: ROOT/.agents/ddd/<date>-<slug>-<runId>-ddd-graph.json)",
      "  --question-file PATH   JSON file with an answers array for deterministic replay",
      "  --non-interactive      never prompt; unresolved questions become disclosed gaps",
      "  --fail-on-gaps         exit 3 when unresolved gaps remain (default: disclose and exit 0)",
      "  --max-files N          bounded scan cap",
      "  --max-bytes N          bounded scan cap",
      "  --max-file-bytes N     per-file cap; oversize files are skipped pre-read and disclosed",
    ].join("\n"),
  );
}

async function main(argv) {
  const opts = {
    repo: null,
    normsPath: null,
    outReport: null,
    outGraph: null,
    questionFilePath: null,
    nonInteractive: false,
    failOnGaps: false,
    limits: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
        opts.repo = requireValue(argv, ++i, arg);
        break;
      case "--norms":
        opts.normsPath = requireValue(argv, ++i, arg);
        break;
      case "--out-report":
        opts.outReport = requireValue(argv, ++i, arg);
        break;
      case "--out-graph":
        opts.outGraph = requireValue(argv, ++i, arg);
        break;
      case "--question-file":
        opts.questionFilePath = requireValue(argv, ++i, arg);
        break;
      case "--non-interactive":
        opts.nonInteractive = true;
        break;
      case "--fail-on-gaps":
        opts.failOnGaps = true;
        opts.nonInteractive = true;
        break;
      case "--max-files":
        opts.limits.maxFiles = positiveInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--max-bytes":
        opts.limits.maxBytes = positiveInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--max-file-bytes":
        opts.limits.maxFileBytes = positiveInt(requireValue(argv, ++i, arg), arg);
        break;
      default:
        process.stderr.write(`unknown option: ${arg}\n`);
        usage();
        return 2;
    }
  }
  if (!opts.repo) {
    usage();
    return 2;
  }

  const analysis = await analyzeRepository({ ...opts, root: opts.repo });
  const defaults = defaultArtifactPaths(opts.repo, analysis.runId);
  const published = await publishArtifacts(
    analysis,
    opts.outReport ?? defaults.outReport,
    opts.outGraph ?? defaults.outGraph,
  );
  if (!published.ok) {
    for (const line of published.errors) process.stderr.write(`${line}\n`);
    process.stderr.write(
      `pre-write schema validation failed (${published.kind}); no artifacts written\n`,
    );
    return 1;
  }
  const { paths } = published;

  const reportCheck = await validateReportEnvelope(analysis.reportObject);
  if (!reportCheck.ok) {
    process.stderr.write("internal error: rendered report failed schema validation\n");
    return 1;
  }
  const graphCheck = await validateGraphFile(paths.outGraph);
  if (!graphCheck.ok) {
    process.stderr.write("internal error: rendered graph failed schema validation\n");
    return 1;
  }
  const pairCheck = await readPublishedPair(paths.outReport, paths.outGraph);
  if (!pairCheck.ok) {
    process.stderr.write(`published pair validation failed: ${pairCheck.errors.join("; ")}\n`);
    return 1;
  }
  process.stdout.write(
    `report: ${paths.outReport}\ngraph: ${paths.outGraph}\nrunId: ${analysis.runId}\n`,
  );
  if (analysis.gaps.length > 0) {
    process.stderr.write(
      `${analysis.gaps.length} unresolved question(s) recorded as unverified gaps in the artifacts\n`,
    );
    if (opts.failOnGaps && opts.nonInteractive) return 3;
  }
  return 0;
}

export async function publishArtifacts(analysis, outReport, outGraph) {
  const graphCheck = await validateGraph(analysis.graphObject);
  if (!graphCheck.ok) return { ok: false, kind: "graph", errors: graphCheck.errors };
  const reportCheck = await validateReport(analysis.reportObject);
  if (!reportCheck.ok) return { ok: false, kind: "report", errors: reportCheck.errors };
  try {
    assertReportMatchesGraph(analysis.reportObject, analysis.graphObject);
    assertPairRunId(analysis.runId, analysis.reportObject, analysis.graphObject);
  } catch (error) {
    return {
      ok: false,
      kind: "cross-link",
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  let paths;
  try {
    paths = await writeArtifacts(analysis, outReport, outGraph);
  } catch (error) {
    return { ok: false, kind: "publication", errors: [error.message] };
  }
  const pair = await readPublishedPair(outReport, outGraph);
  if (!pair.ok) return { ok: false, kind: "publication", errors: pair.errors };
  return { ok: true, paths };
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function positiveInt(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} requires a positive integer`);
  return n;
}

const invokedDirectly = process.argv[1] && /scripts[\\/]ddd\.mjs$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(2);
    });
}
