import { join, resolve } from 'node:path';

import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import {
  createReporter,
  formatError,
  installSanitizedStdio,
} from '../lib/scan/report/reporter.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const repos = [];
  let out = null;
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--repos') {
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        repos.push(args[i]);
        i++;
      }
    } else if (args[i] === '--out') {
      i++;
      if (i < args.length && !args[i].startsWith('--')) {
        out = args[i];
        i++;
      }
    } else {
      i++;
    }
  }
  const cwd = process.cwd();
  return {
    repos: repos.length > 0 ? repos : [cwd],
    out: out ? resolve(out) : join(cwd, 'NORMS.md'),
  };
}

async function main() {
  const { repos, out } = parseArgs();
  const guard = installSanitizedStdio();
  const reporter = createReporter();
  try {
    await runExpandedPipeline({ repos, out, reporter });
    reporter.progress(`NORMS.md written to ${out}`);
  } catch (error) {
    reporter.error(formatError(error));
    process.exitCode = 1;
  } finally {
    guard.restore();
  }
}

main();
