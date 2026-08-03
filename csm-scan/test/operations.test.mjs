import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withFixture, runScanner } from './harness.mjs';

const OPS = fileURLToPath(new URL('../lib/scan/deep/operations.mjs', import.meta.url));
const REAL_REPO = '/home/jamiemills/code/projects/perplexity-cli';

// Workflow with a `jobs:` block AND top-level `permissions:`/`concurrency:`/`env:`
// keys (whose 2-space children used to leak into the unscoped job regex).
const CI_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci
  cancel-in-progress: true
env:
  NODE_VERSION: '20'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`;

test('operations: CI-only repo reaches signal high', async () => {
  await withFixture('ops-ci-only', { '.github/workflows/ci.yml': CI_WORKFLOW }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.dimension, 'operations');
    assert.equal(r.signal, 'high');

    const gh = r.findings.ci.find((c) => c.platform === 'GitHub Actions');
    assert.ok(gh, 'GitHub Actions entry present');
    assert.equal(gh.workflowCount, 1);

    // jobs must contain the real job ids ...
    assert.ok(gh.jobs.includes('build'), 'build job captured');
    assert.ok(gh.jobs.includes('test'), 'test job captured');
    // ... and must NOT contain top-level keys or their leaked children.
    for (const bad of ['permissions', 'concurrency', 'env', 'contents', 'group', 'NODE_VERSION', 'push', 'pull_request']) {
      assert.ok(!gh.jobs.includes(bad), `job leak: ${bad}`);
    }

    // triggers parsed from the on: subtree
    assert.ok(gh.triggers.includes('push'));
    assert.ok(gh.triggers.includes('pull_request'));
    assert.ok(!gh.triggers.includes('NODE_VERSION'));
  });
});

test('operations: .env counts lowercase env vars', async () => {
  const dotenv = "django_secret=x\nDEBUG=True\n# a comment\nPORT=3000\n";
  await withFixture('ops-env', { '.env': dotenv }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const envFiles = r.findings.envConfig.envFiles;
    assert.equal(envFiles.length, 1);
    // django_secret (lowercase) + DEBUG + PORT; comment excluded.
    assert.equal(envFiles[0].file, '.env');
    assert.equal(envFiles[0].varCount, 3);
  });
});

test('operations: signal low without docker/ci, medium with .dockerignore', async () => {
  await withFixture('ops-empty', { 'README.md': '# nothing here' }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.signal, 'low');
  });
  await withFixture('ops-dignore', { '.dockerignore': 'node_modules\n' }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.signal, 'medium');
  });
});

test('operations: dockerfile presence drives signal high', async () => {
  await withFixture('ops-docker', {
    'Dockerfile': 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "index.js"]\n',
  }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.signal, 'high');
    assert.equal(r.findings.dockerfiles.length, 1);
    assert.equal(r.findings.dockerfiles[0].baseImages[0], 'node:20-alpine');
    assert.equal(r.findings.dockerfiles[0].isAlpine, true);
  });
});

test('operations: on: inline scalar trigger form', async () => {
  await withFixture('ops-on-scalar', {
    '.github/workflows/ci.yml': 'on: push\njobs:\n  build:\n    runs-on: x\n',
  }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const gh = r.findings.ci.find((c) => c.platform === 'GitHub Actions');
    assert.deepEqual([...gh.triggers].sort(), ['push']);
    assert.deepEqual(gh.jobs, ['build']);
  });
});

test('operations: on: inline flow sequence trigger form', async () => {
  await withFixture('ops-on-flow', {
    '.github/workflows/ci.yml': 'on: [push, pull_request]\njobs:\n  build:\n    runs-on: x\n',
  }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const gh = r.findings.ci.find((c) => c.platform === 'GitHub Actions');
    assert.deepEqual([...gh.triggers].sort(), ['pull_request', 'push']);
  });
});

test('operations: on: quoted key form (\'on\':)', async () => {
  // GitHub Actions commonly quotes on:/jobs: to dodge YAML 1.1 boolean coercion.
  const wf = `'on':\n  push:\n    branches: [main]\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: x\n`;
  await withFixture('ops-on-quoted', { '.github/workflows/ci.yml': wf }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const gh = r.findings.ci.find((c) => c.platform === 'GitHub Actions');
    assert.ok(gh.triggers.includes('push'));
    assert.ok(gh.triggers.includes('workflow_dispatch'), 'quoted on: trigger captured');
    assert.ok(!gh.triggers.includes('contents'));
    assert.deepEqual(gh.jobs, ['build']);
  });
});

test('operations: python config files recognized', async () => {
  await withFixture('ops-pyconfig', {
    'settings.py': 'DEBUG = True\n',
    'alembic.ini': '[alembic]\nscript_location = migrations\n',
  }, async (dir) => {
    const r = await runScanner(OPS, dir, { files: ['settings.py', 'alembic.ini'] });
    assert.equal(r.findings.envConfig.appConfigFile, true);
  });
});

test('operations: contract findings keys preserved', async () => {
  await withFixture('ops-contract', { 'README.md': 'x' }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.deepEqual(Object.keys(r.findings).sort(), [
      'dockerCompose', 'dockerfiles', 'envConfig', 'gracefulShutdown',
      'hasDeployScripts', 'hasDockerignore', 'hasJustfile', 'hasMakefile',
      'healthChecks', 'monitoring', 'procfile', 'ci',
    ].sort());
    assert.equal(r.dimension, 'operations');
    assert.ok(['low', 'medium', 'high'].includes(r.signal));
    // task-runner booleans default to false on an empty repo.
    assert.equal(r.findings.hasMakefile, false);
    assert.equal(r.findings.hasJustfile, false);
    // monitoring keeps its { libraries: [] } shape with no manifest.
    assert.ok(Array.isArray(r.findings.monitoring.libraries));
    assert.equal(r.findings.monitoring.libraries.length, 0);
  });
});

test('operations: justfile detection (Justfile / justfile)', async () => {
  const justfile = 'build:\n    @echo build\n';
  await withFixture('ops-just-cap', { 'Justfile': justfile }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.findings.hasJustfile, true);
  });
  await withFixture('ops-just-lc', { 'justfile': justfile }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.findings.hasJustfile, true);
  });
  await withFixture('ops-just-explicit', { 'justfile.just': justfile }, async (dir) => {
    const r = await runScanner(OPS, dir);
    assert.equal(r.findings.hasJustfile, true);
  });
});

test('operations: python monitoring (sentry-sdk) surfaces', async () => {
  const pyproject = `[project]
name = "demo"
version = "0.1.0"
dependencies = ["sentry-sdk>=1.0", "structlog>=24.0"]
`;
  await withFixture('ops-pymon', { 'pyproject.toml': pyproject }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const libs = r.findings.monitoring.libraries;
    const pkgs = libs.map((l) => l.package);
    assert.ok(pkgs.includes('sentry-sdk'), 'sentry-sdk surfaced for python');
    assert.ok(pkgs.includes('structlog'), 'structlog surfaced for python');
    const sentry = libs.find((l) => l.package === 'sentry-sdk');
    assert.ok(/sentry/i.test(sentry.label), 'sentry label present');
    assert.equal(sentry.type, 'Error tracking');
  });
});

test('operations: rust monitoring (tracing) surfaces', async () => {
  const cargo = `[package]
name = "demo"
version = "0.1.0"

[dependencies]
tracing = "0.1"
sentry = "0.32"
`;
  await withFixture('ops-rsmon', { 'Cargo.toml': cargo }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const libs = r.findings.monitoring.libraries;
    const pkgs = libs.map((l) => l.package);
    assert.ok(pkgs.includes('tracing'), 'tracing surfaced for rust');
    assert.ok(pkgs.includes('sentry'), 'sentry surfaced for rust');
    const tracing = libs.find((l) => l.package === 'tracing');
    assert.ok(/tracing/i.test(tracing.label));
    assert.equal(tracing.type, 'Logging/Tracing');
  });
});

test('operations: JS-only monitoring still works (regression)', async () => {
  const pkg = JSON.stringify({
    name: 'demo',
    dependencies: { winston: '3.0.0', '@sentry/node': '7.0.0' },
  }, null, 2);
  await withFixture('ops-jsmon', { 'package.json': pkg }, async (dir) => {
    const r = await runScanner(OPS, dir);
    const pkgs = r.findings.monitoring.libraries.map((l) => l.package);
    assert.ok(pkgs.includes('winston'));
    assert.ok(pkgs.includes('@sentry/node'));
  });
});

test('operations: real perplexity-cli', async () => {
  if (!existsSync(REAL_REPO)) {
    return; // skip when repo absent
  }
  const r = await runScanner(OPS, REAL_REPO);
  assert.equal(r.dimension, 'operations');
  assert.equal(r.signal, 'high');

  const gh = r.findings.ci.find((c) => c.platform === 'GitHub Actions');
  assert.ok(gh, 'GitHub Actions detected on real repo');
  console.log('[perplexity-cli] signal      =', r.signal);
  console.log('[perplexity-cli] workflowCount =', gh.workflowCount);
  console.log('[perplexity-cli] jobs count  =', gh.jobs.length);
  console.log('[perplexity-cli] jobs sample =', JSON.stringify(gh.jobs.slice(0, 8)));
  console.log('[perplexity-cli] triggers    =', JSON.stringify(gh.triggers));
  console.log('[perplexity-cli] hasMakefile =', r.findings.hasMakefile);
  console.log('[perplexity-cli] hasJustfile =', r.findings.hasJustfile);
  console.log('[perplexity-cli] monitoring  =', JSON.stringify(r.findings.monitoring.libraries));

  assert.ok(gh.workflowCount >= 5, 'multiple workflows present');
  // hyphenated and underscored job ids must be captured (requires [\w-]+)
  assert.ok(gh.jobs.includes('secret-scan'), 'hyphenated job captured');
  assert.ok(gh.jobs.includes('windows_packaging_smoke'), 'underscore job captured');
  // ci.yml quotes 'on': and includes workflow_dispatch
  assert.ok(gh.triggers.includes('workflow_dispatch'), 'workflow_dispatch captured from quoted on:');
  // top-level-block children must not leak
  for (const bad of ['contents', 'group', 'cancel-in-progress', 'NODE_VERSION', 'permissions', 'concurrency']) {
    assert.ok(!gh.jobs.includes(bad), `real job leak: ${bad}`);
  }
  // monitoring shape always present; report (not assert) the python libs found.
  assert.ok(Array.isArray(r.findings.monitoring.libraries), 'monitoring.libraries is an array');
});
