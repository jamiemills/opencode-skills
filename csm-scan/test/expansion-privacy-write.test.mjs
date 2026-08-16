// T005 — deterministic replacement test for the write-path privacy cutover.
//
// Registered in test/baselines/expansion/supersession.json under the
// `deterministic-ordering-paths` entry (flipped legacy_locked -> superseded
// per that file's own policy) and in the recurring acceptance inventory. It
// pins the NEW write behavior that the legacy locks predate:
//   - the repository Path renders relative to its git root (`.` at the root),
//     never as a host absolute path;
//   - the Git indicator renders the git root basename, never the absolute root;
//   - package.json script bodies never render (names + command counts only);
//   - the overview description passes through the T224 sanitizer.
//
// R1 canaries: WRITE_RENDER_CONTEXT is threaded into the render registry and
// the write.mjs render call, so every structured leak channel the security
// review proved (dep names+version specs, raw import sample lines, workflow
// job.if expressions, package name/main) renders sanitized while legitimate
// deps — including scoped names — still render.
//
// Seeded fixtures only (no host state): every input is written by this test.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { runExpandedPipeline } from '../lib/scan/pipeline/run.mjs';
import { makeGitRepo, cleanupGitRepo } from './helpers/git-fixture.mjs';

const FIXED_CLOCK = () => '2026-08-16';

const SCRIPT_BODY = 'echo deploy using ghp_\x31612345678912345678901234567890123456789';
const DESCRIPTION_TOKEN = 'ghp_\x31612345678912345678901234567890123456789';

// R1 hostile-channel canaries: each token names the structured channel it
// rides (dep version spec, import sample line, workflow job.if, package
// name/main). None may reach NORMS.md.
const DEP_SPEC_TOKEN = 'AKIA\x49OSFODNN7EXAMPLE';
const DEP_NAME_TOKEN = 'ghp_\x64epnamechannel000000001111111';
const IMPORT_SAMPLE_TOKEN = 'password=IMPORTSAMPLECHANNEL12345678';
const WORKFLOW_IF_TOKEN = 'ghp_\x77orkflowifchannel1234567890123';
const PACKAGE_NAME_TOKEN = 'ghp_\x70ackagenamechannel000000001111';

function manifestFixtureFiles() {
  return {
    'package.json': JSON.stringify({
      name: 't005-privacy-write',
      type: 'module',
      description: `Deploy helper ${DESCRIPTION_TOKEN} for the write gate`,
      scripts: {
        deploy: SCRIPT_BODY,
      },
    }),
    'src/index.js': 'export const value = 1;\n',
  };
}

async function scanToMarkdown(repo) {
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t005-write-'));
  try {
    await runExpandedPipeline({
      repos: [repo],
      out: join(outDir, 'NORMS.md'),
      clock: FIXED_CLOCK,
    });
    return await readFile(join(outDir, 'NORMS.md'), 'utf8');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test('T005 write path renders relative Path, basename gitRoot, redacted description, and no script bodies', async () => {
  const repo = makeFixture('t005-write-nongit', manifestFixtureFiles());
  try {
    const markdown = await scanToMarkdown(repo);

    // Path: repo-relative `.` at the root — never the host absolute path.
    assert.match(markdown, /- \*\*Path\*\*: `\.`/);
    assert.equal(markdown.includes(repo), false, 'NORMS.md must not contain the fixture root absolute path');

    // Scripts: names + command counts; the body (with its PAT-shaped token)
    // must never render.
    assert.match(markdown, /\| deploy \| 1 command\(s\) \|/);
    assert.equal(markdown.includes(SCRIPT_BODY), false, 'script bodies must not render');
    assert.equal(markdown.includes(DESCRIPTION_TOKEN), false, 'the description token must be redacted');

    // Description: still rendered, but sanitized through the T224 reporter.
    assert.match(markdown, /- \*\*Description\*\*: Deploy helper \[redacted\] for the write gate/);
  } finally {
    cleanupFixture(repo);
  }

  // Git repositories additionally render the git root as a basename indicator.
  const gitRepo = makeGitRepo({
    files: manifestFixtureFiles(),
    commits: ['feat: seed t005 write-gate fixture'],
  });
  try {
    const markdown = await scanToMarkdown(gitRepo);
    const rootLabel = basename(gitRepo);
    assert.match(markdown, new RegExp(`- \\*\\*Git\\*\\*: yes \\(${rootLabel}\\)`));
    assert.equal(markdown.includes(gitRepo), false, 'NORMS.md must not contain the git fixture root absolute path');
    assert.equal(markdown.includes(SCRIPT_BODY), false, 'script bodies must not render in a git repository either');
  } finally {
    cleanupGitRepo(gitRepo);
  }
});

test('R1 structured channels render sanitized: dep specs, import samples, workflow job.if, package name/main', async () => {
  const files = {
    'package.json': JSON.stringify({
      name: PACKAGE_NAME_TOKEN,
      version: '1.0.0',
      type: 'module',
      main: `src/${DEP_NAME_TOKEN}.js`,
      dependencies: {
        'aws-sdk': DEP_SPEC_TOKEN,
        '@scope/pkg': '^1.2.3',
        [DEP_NAME_TOKEN]: '1.0.0',
      },
    }),
    'src/leak.js': `import crypto from 'node:crypto'; // ${IMPORT_SAMPLE_TOKEN}\nexport const v = crypto.randomUUID();\n`,
    '.github/workflows/ci.yml': [
      'name: ci',
      'on: [push]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      `    if: github.token == '${WORKFLOW_IF_TOKEN}'`,
      '    steps:',
      '      - uses: actions/checkout@v4',
      '',
    ].join('\n'),
  };
  const repo = makeFixture('r1-structured-channels', files);
  try {
    const markdown = await scanToMarkdown(repo);

    // Every hostile token must be absent from every structured channel.
    for (const token of [DEP_SPEC_TOKEN, DEP_NAME_TOKEN, IMPORT_SAMPLE_TOKEN, WORKFLOW_IF_TOKEN, PACKAGE_NAME_TOKEN]) {
      assert.equal(markdown.includes(token), false, `structured-channel token must be redacted: ${token}`);
    }

    // Legitimate deps still render — including the scoped name and the dep
    // whose spec was a secret (name intact, spec redacted).
    assert.match(markdown, /- `aws-sdk` — \[redacted\]/);
    assert.match(markdown, /- `@scope\/pkg` — \^1\.2\.3/);
    // The import sample file still renders, with the secret-bearing tail redacted.
    assert.match(markdown, /- `src\/leak\.js`: `import crypto from 'node:crypto'; \/\/ \[redacted\]`/);
  } finally {
    cleanupFixture(repo);
  }
});
