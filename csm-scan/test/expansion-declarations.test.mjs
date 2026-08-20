import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { extractDeclarations } from '../lib/scan/shared/declarations.mjs';

const LIMITS = Object.freeze({ maxFiles: 20, maxBytes: 10_000, maxRecords: 100, maxDepth: 8 });

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-declarations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

function requests(paths) {
  return paths.map((path) => ({ path, format: 'text', sensitivity: 'internal' }));
}

function kinds(result) {
  return result.declarations.map(({ kind }) => kind);
}

test('T207 workflow extracts jobs, containers, commands, environments, and triggers with source locations', async (t) => {
  const root = await fixture(t, {
    '.github/workflows/ci.yml': [
      'name: ci',
      'on: [push, pull_request]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    container: node:20',
      '    env:',
      '      CI: true',
      '    steps:',
      '      - run: npm ci',
      '      - run: npm test',
      '  deploy:',
      '    environment: production',
      '    steps:',
      '      - run: ./deploy.sh',
      '',
    ].join('\n'),
  });
  const result = await extractDeclarations({ root, requests: requests(['.github/workflows/ci.yml']), options: LIMITS });
  assert.deepEqual(kinds(result).toSorted(), ['command', 'command', 'command', 'environment', 'environment', 'environment', 'image', 'job', 'job']);
  const commands = result.declarations.filter(({ kind }) => kind === 'command').map(({ label, job }) => [label, job]).toSorted();
  assert.deepEqual(commands, [
    ['./deploy.sh', 'deploy'],
    ['npm ci', 'build'],
    ['npm test', 'build'],
  ]);
  const job = result.declarations.find(({ kind, label }) => kind === 'job' && label === 'build');
  assert.deepEqual(job.source, { path: '.github/workflows/ci.yml' });
  const images = result.declarations.filter(({ kind }) => kind === 'image').map(({ label }) => label).toSorted();
  assert.deepEqual(images, ['node:20']);
  const environments = result.declarations.filter(({ kind }) => kind === 'environment').map(({ label }) => label).toSorted();
  assert.deepEqual(environments, ['CI', 'production', 'ubuntu-latest']);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.declarations.every((entry) => Object.isFrozen(entry)), true);
});

test('T207 compose and dockerfile extract services, images, and environment keys only', async (t) => {
  const root = await fixture(t, {
    'compose.yaml': [
      'services:',
      '  web:',
      '    image: nginx:alpine',
      '    container_name: web-app',
      '    environment:',
      '      PORT: 8080',
      '      SECRET_VALUE: ${TOKEN}',
      '',
    ].join('\n'),
    'Dockerfile': 'FROM python:3.12-slim\nENV PYTHONDONTWRITEBYTECODE=1\nCMD ["python", "app.py"]\n',
  });
  const result = await extractDeclarations({
    root,
    requests: requests(['compose.yaml', 'Dockerfile']),
    options: LIMITS,
  });
  const services = result.declarations.filter(({ kind }) => kind === 'service');
  assert.equal(services.length, 1);
  assert.equal(services[0].label, 'web');
  assert.equal(services[0].image, 'nginx:alpine');
  assert.equal(services[0].containerName, 'web-app');
  const environments = result.declarations.filter(({ kind }) => kind === 'environment').map(({ label }) => label).toSorted();
  assert.deepEqual(environments, ['PORT', 'PYTHONDONTWRITEBYTECODE', 'SECRET_VALUE']);
  const images = result.declarations.filter(({ kind }) => kind === 'image').map(({ label }) => label).toSorted();
  assert.deepEqual(images, ['nginx:alpine', 'python:3.12-slim']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('TOKEN'), false, 'environment values must never be extracted');
});

test('T207 package.json scripts and engines produce declared commands and versions', async (t) => {
  const root = await fixture(t, {
    'package.json': JSON.stringify({
      name: 'demo',
      engines: { node: '>=18' },
      scripts: { build: 'vite build', test: 'node --test', audit: 'npm audit --audit-level=high' },
    }),
  });
  const result = await extractDeclarations({
    root,
    requests: [{ path: 'package.json', format: 'json', sensitivity: 'internal' }],
    options: LIMITS,
  });
  const commands = result.declarations.filter(({ kind }) => kind === 'command').map(({ label, command }) => [label, command]);
  assert.deepEqual(commands, [
    ['audit', 'npm audit --audit-level=high'],
    ['build', 'vite build'],
    ['test', 'node --test'],
  ]);
  assert.deepEqual(
    result.declarations.filter(({ kind }) => kind === 'version').map(({ label, value }) => [label, value]),
    [['node', '>=18']],
  );
});

test('T207 makefile and version files produce targets, commands, and bounded versions', async (t) => {
  const root = await fixture(t, {
    'Makefile': 'build:\n\tmkdir -p dist\n\tnpm run build\ntest:\n\tnpm test\n',
    '.nvmrc': '20.10.0\n',
    '.tool-versions': 'python 3.12.2\nnodejs 20.10.0\n',
  });
  const result = await extractDeclarations({
    root,
    requests: requests(['Makefile', '.nvmrc', '.tool-versions']),
    options: LIMITS,
  });
  const targets = result.declarations.filter(({ kind }) => kind === 'target').map(({ label, source }) => [label, source.line]);
  assert.deepEqual(targets, [['build', 1], ['test', 4]]);
  const commands = result.declarations.filter(({ kind }) => kind === 'command').map(({ label }) => label);
  assert.deepEqual(commands, ['mkdir -p dist', 'npm run build', 'npm test']);
  const versions = result.declarations.filter(({ kind }) => kind === 'version').map(({ label, value }) => [label, value]);
  assert.deepEqual(versions, [
    ['.nvmrc', '20.10.0'],
    ['nodejs', '20.10.0'],
    ['python', '3.12.2'],
  ]);
});

test('T207 anchors, block scalars, malformed JSON, unknown artifacts, and missing files yield diagnostics', async (t) => {
  const root = await fixture(t, {
    '.github/workflows/anchored.yml': 'defaults:\n  env: &base\n    CI: true\njobs:\n  build:\n    env: *base\n',
    'notes.md': 'plain text with no extractor\n',
    'bad.json': '{broken',
    'compose.yaml': 'services:\n  web:\n    image: nginx\n',
  });
  const result = await extractDeclarations({
    root,
    requests: [
      ...requests(['.github/workflows/anchored.yml', 'notes.md', 'compose.yaml', 'missing.txt']),
      { path: 'bad.json', format: 'json', sensitivity: 'internal' },
    ],
    options: LIMITS,
  });
  const byPath = Object.fromEntries(result.diagnostics.map((entry) => [entry.path, entry]));
  assert.ok(['unsupported', 'unverified'].includes(byPath['.github/workflows/anchored.yml'].status), 'anchors must not parse');
  assert.equal(byPath['notes.md'].status, 'unsupported');
  assert.equal(byPath['bad.json'].status, 'malformed');
  assert.equal(byPath['missing.txt'].status, 'unreadable');
  assert.ok(result.declarations.some(({ kind, label }) => kind === 'service' && label === 'web'), 'valid peers survive');
  for (const diagnostic of result.diagnostics) assert.equal(Object.isFrozen(diagnostic), true);
});

test('T207 caps bound jobs, commands, and services without partial values', async (t) => {
  const jobs = {};
  for (let index = 0; index < 70; index++) jobs[`job-${index}`] = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo ok' }] };
  const root = await fixture(t, {
    '.github/workflows/large.yml': `name: large\non: push\njobs:\n${Object.entries(jobs)
      .map(([name, job]) => `  ${name}:\n    runs-on: ${job['runs-on']}\n    steps:\n      - run: echo ok`)
      .join('\n')}\n`,
  });
  const result = await extractDeclarations({
    root,
    requests: requests(['.github/workflows/large.yml']),
    options: { ...LIMITS, maxRecords: 1000 },
  });
  const diagnostic = result.diagnostics.find(({ path }) => path === '.github/workflows/large.yml');
  assert.equal(diagnostic?.status, 'unsupported');
  assert.equal(diagnostic?.reason, 'JOBS_LIMIT');
  assert.deepEqual(result.declarations, []);
});

test('T207 secret-bearing command records are omitted with a privacy diagnostic', async (t) => {
  const root = await fixture(t, {
    'Makefile': 'deploy:\n\tcurl -H "Authorization: Bearer ghp_\x61bcdefghijklmnopqrstuvwxyz" https://example.test\n',
  });
  const result = await extractDeclarations({ root, requests: requests(['Makefile']), options: LIMITS });
  assert.deepEqual(result.declarations.map(({ kind }) => kind), ['target']);
  const diagnostic = result.diagnostics.find(({ path }) => path === 'Makefile');
  assert.equal(diagnostic?.status, 'unverified');
  assert.equal(diagnostic?.reason, 'privacy');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ghp_'), false);
});

test('T207 search space is T202-compatible and extraction never executes anything', async (t) => {
  const root = await fixture(t, {
    '.github/workflows/ci.yml': 'on: push\njobs:\n  build:\n    steps:\n      - run: echo hi\n',
  });
  const result = await extractDeclarations({ root, requests: requests(['.github/workflows/ci.yml']), options: LIMITS });
  assert.deepEqual(Object.keys(result.searchSpace).toSorted(), [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ]);
  assert.equal(result.searchSpace.complete, true);
  assert.equal(result.searchSpace.supported, true);
  assert.equal(Object.isFrozen(result.searchSpace), true);
  assert.equal(result.declarations.length, 2);
});

test('T207 Makefile assignments, define bodies, continuations, block-scalar indicators, and FROM flags are handled', async (t) => {
  const root = await fixture(t, {
    'Makefile': 'VAR := value\nbuild:\n\tmkdir -p dist\nVAR = a \\\n  continued\ndefine GREET\n  hello world\nendef\n',
    '.github/workflows/block.yml': 'on: push\njobs:\n  build:\n    steps:\n      - run: |1\n        echo hi\n',
    'Dockerfile': 'FROM --platform=linux/amd64 node:20 AS builder\nENV A=1\n',
  });
  const result = await extractDeclarations({
    root,
    requests: requests(['Makefile', '.github/workflows/block.yml', 'Dockerfile']),
    options: LIMITS,
  });
  const targets = result.declarations.filter(({ kind }) => kind === 'target').map(({ label }) => label);
  assert.deepEqual(targets, ['build'], 'variable assignments must not become targets');
  const commands = result.declarations.filter(({ kind }) => kind === 'command').map(({ label }) => label);
  assert.deepEqual(commands, ['mkdir -p dist'], 'define bodies and continuations must not become commands');
  const images = result.declarations.filter(({ kind }) => kind === 'image').map(({ label }) => label);
  assert.deepEqual(images, ['node:20'], 'FROM flags and stage aliases must be stripped');
  const blockDiagnostic = result.diagnostics.find(({ path }) => path === '.github/workflows/block.yml');
  assert.equal(blockDiagnostic?.status, 'unsupported');
  assert.ok(['BLOCK_SCALAR', 'PARSE_UNSUPPORTED'].includes(blockDiagnostic?.reason), 'block scalars must never be parsed as commands');
});
