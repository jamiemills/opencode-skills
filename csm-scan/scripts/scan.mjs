import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { commandBroker } from '../lib/scan/shared/command.mjs';
import {
  createReporter,
  formatError,
  installSanitizedStdio,
} from '../lib/scan/report/reporter.mjs';

const USAGE = [
  'Usage: scan.mjs [--repos <path>...] [--out <path>]',
  '',
  'Scan one or more repositories and write a NORMS.md report.',
  'With no --repos, the current working directory is scanned.',
  'With no --out, the report is written to NORMS.md in the current directory.',
  '',
  'Options:',
  '  --repos <path>...  Repositories to scan (default: current working directory).',
  '  --out <path>       Output file (default: NORMS.md in the current directory).',
  '  --help             Print this usage information and exit.',
  '  --version          Print the version and exit.',
  '',
  'Report contents are privacy-safe: absolute paths, identities, and secrets',
  'are redacted before they reach stdout, stderr, or the report.',
].join('\n');

const USAGE_HINT = "Try 'scan.mjs --help' for usage.";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function printStdout(line) {
  process.stdout.write(`${line}\n`);
}

function parseArgs(argv, cwd) {
  const repos = [];
  let out = null;
  let help = false;
  let version = false;
  const errors = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help') {
      help = true;
      i++;
    } else if (arg === '--version') {
      version = true;
      i++;
    } else if (arg === '--repos') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        repos.push(argv[i]);
        i++;
      }
    } else if (arg === '--out') {
      i++;
      if (i < argv.length && !argv[i].startsWith('--')) {
        out = argv[i];
        i++;
      } else {
        errors.push('--out requires a path argument');
      }
    } else {
      errors.push(`unknown option: ${arg}`);
      i++;
    }
  }
  return {
    repos: repos.length > 0 ? repos : [cwd],
    out: out ? resolve(cwd, out) : join(cwd, 'NORMS.md'),
    help,
    version,
    errors,
  };
}

function validateRepos(repos) {
  const errors = [];
  for (const repo of repos) {
    let stats;
    try {
      stats = statSync(repo);
    } catch {
      errors.push(`no such directory: ${repo}`);
      continue;
    }
    if (!stats.isDirectory()) {
      errors.push(`not a directory: ${repo}`);
    }
  }
  return errors;
}

async function packageVersion() {
  try {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof manifest.version === 'string' && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // No package.json or no version field; fall back to the git commit hash.
  }
  return null;
}

async function gitCommitHash() {
  try {
    const result = await commandBroker.execute('git:log-oneline-50', { cwd: SCRIPT_DIR });
    const firstLine = String(result.stdout ?? '')
      .split('\n')
      .find((line) => line.trim().length > 0);
    if (firstLine === undefined) return null;
    const hash = firstLine.trim().split(/\s+/)[0];
    return /^[0-9a-f]{4,40}$/i.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

async function resolveVersion() {
  return (await packageVersion()) ?? (await gitCommitHash()) ?? 'csm-scan';
}

async function main() {
  const rawStderrWrite = process.stderr.write.bind(process.stderr);
  const guard = installSanitizedStdio();
  const printCliError = (line) => {
    rawStderrWrite(`${line}\n`);
  };
  const { repos, out, help, version, errors } = parseArgs(process.argv.slice(2), process.cwd());

  if (help) {
    printStdout(USAGE);
    return;
  }
  if (version) {
    printStdout(`csm-scan ${await resolveVersion()}`);
    return;
  }
  if (errors.length > 0) {
    for (const error of errors) printCliError(error);
    printCliError(USAGE_HINT);
    process.exitCode = 2;
    return;
  }
  const pathErrors = validateRepos(repos);
  if (pathErrors.length > 0) {
    for (const error of pathErrors) printCliError(error);
    printCliError(USAGE_HINT);
    process.exitCode = 2;
    return;
  }

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
