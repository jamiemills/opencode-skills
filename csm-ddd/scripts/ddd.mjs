"use strict";

import process from "node:process";
import { analyzeRepository, defaultArtifactPaths, writeArtifacts } from "../lib/ddd/pipeline.mjs";
import { validateGraphFile, validateReportEnvelope } from "../lib/ddd/validate.mjs";

function usage() {
  process.stderr.write(
    [
      "usage: node csm-ddd/scripts/ddd.mjs --repo ROOT [options]",
      "",
      "options:",
      "  --repo ROOT            target repository (required)",
      "  --norms PATH           explicit NORMS.md path (default: ROOT/NORMS.md when present)",
      "  --out-report PATH      report output path (default: ROOT/.agents/ddd/<date>-<slug>-ddd-report.md)",
      "  --out-graph PATH       graph output path (default: ROOT/.agents/ddd/<date>-<slug>-ddd-graph.json)",
      "  --question-file PATH   JSON file with an answers array for deterministic replay",
      "  --non-interactive      never prompt; unresolved questions become disclosed gaps",
      "  --fail-on-gaps         exit 3 when unresolved gaps remain (default: disclose and exit 0)",
      "  --max-files N          bounded scan cap",
      "  --max-bytes N          bounded scan cap",
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
        break;
      case "--max-files":
        opts.limits.maxFiles = positiveInt(requireValue(argv, ++i, arg), arg);
        break;
      case "--max-bytes":
        opts.limits.maxBytes = positiveInt(requireValue(argv, ++i, arg), arg);
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
  const defaults = defaultArtifactPaths(opts.repo);
  const paths = await writeArtifacts(
    analysis,
    opts.outReport ?? defaults.outReport,
    opts.outGraph ?? defaults.outGraph,
  );

  const reportCheck = await validateReportEnvelope(analysis.parsedReport);
  if (!reportCheck.ok) {
    process.stderr.write("internal error: rendered report failed schema validation\n");
    return 1;
  }
  const graphCheck = await validateGraphFile(paths.outGraph);
  if (!graphCheck.ok) {
    process.stderr.write("internal error: rendered graph failed schema validation\n");
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
