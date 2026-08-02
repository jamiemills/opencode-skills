import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { writeNORMS } from '../lib/scan/write.mjs';
import { scanStructure } from '../lib/scan/structure.mjs';
import { scanStack } from '../lib/scan/stack.mjs';
import { scanConfig } from '../lib/scan/config.mjs';
import { scanTesting } from '../lib/scan/testing.mjs';
import { scanConventions } from '../lib/scan/conventions.mjs';
import { scanGit } from '../lib/scan/git.mjs';
import { scanArchitecture } from '../lib/scan/architecture.mjs';

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

function getGitRoot(repoPath) {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root;
  } catch {
    return resolve(repoPath);
  }
}

function repoName(repoPath) {
  return repoPath.split('/').filter(Boolean).pop() || repoPath;
}

async function main() {
  const { repos, out } = parseArgs();

  const findings = {
    generated: new Date().toISOString().split('T')[0],
    repos: [],
  };

  for (const rawPath of repos) {
    const resolvedPath = resolve(rawPath);
    const root = getGitRoot(resolvedPath);
    const name = repoName(root);

    const [structure, stack, config, testing, conventions, git, architecture] = await Promise.all([
      scanStructure(root),
      scanStack(root),
      scanConfig(root),
      scanTesting(root),
      scanConventions(root),
      scanGit(root),
      scanArchitecture(root),
    ]);

    findings.repos.push({
      name,
      path: root,
      structure,
      stack,
      config,
      testing,
      conventions,
      git,
      architecture,
    });
  }

  await writeNORMS(findings, out);
  process.stdout.write(`NORMS.md written to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
