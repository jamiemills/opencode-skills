// T227 — negative and constraint re-check gates for the expanded pipeline.
//
// Owned by T227. Two responsibilities:
//
// A) Negative gate — malformed plugin JSON, invalid evidence records,
//    unknown/missing renderers, standards-policy violations, privacy
//    violations, and validation failures abort BEFORE the sole output write
//    (no file created) with sanitized typed errors; unsupported, ambiguous,
//    and unresolved constructs never fabricate facts.
//
// B) Constraint re-checks — the plan's Verification Strategy requires the
//    final gate to re-run command recording (broker IDs only, no target
//    commands), one-write, zero-dependency/import audits, and read-only
//    enforcement, and to assert the target-command count is 0. The deep
//    capability/import/write audits live in the T201 executable suite
//    (test/expansion-constraints.test.mjs, test/expansion-baseline.test.mjs)
//    which runs in the same focused gate command; this file adds the T227
//    pipeline-level re-checks on top.
//
// Scope (own-only): this test file. No production, baseline, or other test is
// edited.

import assert from 'node:assert/strict';
import {
  mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { makeFixture, cleanupFixture } from './harness.mjs';
import { lexicalMask } from './helpers/recording-runner.mjs';
import { runExpandedPipeline, assertFindingsPrivacy } from '../lib/scan/pipeline/run.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import {
  createRenderRegistry,
  DIMENSION_RENDERER_ENTRIES,
  RenderRegistryError,
} from '../lib/scan/render/registry.mjs';
import { loadPlugins, PluginLoaderError } from '../lib/scan/plugins/loader.mjs';
import { validatePlugins, PluginSchemaError } from '../lib/scan/plugins/schema.mjs';
import { createEvidence } from '../lib/scan/contracts/evidence.mjs';
import {
  assertPrivacySafe,
  prepareEvidenceForPersistence,
  PrivacyError,
} from '../lib/scan/shared/privacy.mjs';
import {
  reuseDisposition,
  validateStandardEntry,
  validateStandardsRegistry,
} from '../lib/scan/standards/policy.mjs';
import { formatError } from '../lib/scan/report/reporter.mjs';
import {
  createCommandBroker,
  defaultRunner,
} from '../lib/scan/shared/command.mjs';
import { rgIgnoreArgs } from '../lib/scan/shared/ignore.mjs';
import { makeGitRepo, cleanupGitRepo } from './helpers/git-fixture.mjs';

import { files as pythonFiles } from './fixtures-expansion/python.mjs';
import { repoA, repoB } from './fixtures-expansion/cross-repo.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, '..');
const FIXED_CLOCK = () => '2026-08-03';

function sanitizedErrorMatch(error, Type, code, forbidden) {
  assert.ok(error instanceof Type, `expected ${Type.name}, got ${error?.constructor?.name}`);
  assert.equal(error.code, code);
  for (const token of forbidden) {
    assert.ok(!error.message.includes(token), `error message must not contain ${token}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// A) Negative gate
// ---------------------------------------------------------------------------

test('T227 negative: malformed plugin JSON aborts at the loader with a sanitized error and no output', async () => {
  const skillRoot = await mkdtemp(join(tmpdir(), 'csm-scan-t227-plugin-bad-'));
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-plugin-out-'));
  try {
    const pluginDir = join(skillRoot, 'plugins', 'fixturelang');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'plugin.json'), '{ not-valid-json', 'utf8');

    await assert.rejects(
      loadPlugins({ skillRoot }),
      (error) => sanitizedErrorMatch(error, PluginLoaderError, 'MALFORMED_JSON', [skillRoot, 'not-valid-json']),
    );
    assert.deepEqual(await readdir(outDir), [], 'a failed plugin load must not produce any output file');
  } finally {
    await rm(skillRoot, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 negative: plugin schema violations are rejected typed before any evaluation', () => {
  const base = {
    id: 'fixturelang',
    apiVersion: 1,
    label: 'Fixturelang',
    aliases: [],
    providers: [{
      id: 'PRV-fixturelang-v1',
      apiVersion: 1,
      dimensions: [{ dimensionId: 'DIM-api-v1', categories: ['route'] }],
    }],
    rules: [{
      id: 'RUL-fixturelang-x-v1',
      dimensionId: 'DIM-api-v1',
      category: 'route',
      label: 'route',
      literal: 'x',
      extensions: ['.x'],
    }],
  };
  const valid = validatePlugins([base]);
  assert.equal(valid.length, 1);

  const invalidCases = [
    ['unsupported apiVersion', { ...base, apiVersion: 2 }],
    ['executable hook field', { ...base, hooks: ['node:child_process'] }],
    ['unknown plugin field', { ...base, extra: 1 }],
    ['duplicate alias', { ...base, aliases: ['fixturelang'] }],
    ['rule with a path token', { ...base, rules: [{ ...base.rules[0], artifactTokens: ['../../etc/passwd'] }] }],
    ['rule category not declared', { ...base, rules: [{ ...base.rules[0], category: 'rpc' }] }],
    ['rule without a category', { ...base, rules: [{ ...base.rules[0], category: undefined }] }],
  ];
  for (const [label, plugin] of invalidCases) {
    assert.throws(
      () => validatePlugins([plugin]),
      (error) => error instanceof PluginSchemaError,
      `${label}: invalid plugin schema must be rejected`,
    );
  }
});

test('T227 negative: a non-canonical plugin rule aborts before the write; an unregistered dimension never fabricates', async () => {
  const repo = makeFixture('t227-negative-plugin', pythonFiles);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-negative-plugin-'));
  let sinkCalls = 0;
  try {
    // A rule that fails the evaluation schema aborts the run before the sink.
    const malformedPlugin = {
      id: 'fixturelang',
      apiVersion: 1,
      label: 'Fixturelang',
      aliases: [],
      providers: [],
      rules: [{ id: 'RUL-fixturelang-bad-v1', dimensionId: 'DIM-api-v1', category: 'route', label: 'x', literal: 'x' }],
    };
    await assert.rejects(
      runExpandedPipeline({
        repos: [repo],
        out: join(outDir, 'NORMS.md'),
        clock: FIXED_CLOCK,
        pluginRegistry: [malformedPlugin],
        sink: (findings, out, renderer) => { sinkCalls++; return writeNORMS(findings, out, renderer); },
      }),
      (error) => error && error.code === 'UNKNOWN_FIELD' && !error.message.includes('fixturelang'),
    );
    assert.equal(sinkCalls, 0, 'a malformed plugin rule must abort before the sole write');
    assert.deepEqual(await readdir(outDir), [], 'a malformed plugin rule must not create any output file');

    // A canonical rule whose dimension is unregistered completes and fabricates
    // no evidence (the catalogs only merge known provider dimensions).
    const bogusPlugin = {
      id: 'fixturelang',
      apiVersion: 1,
      label: 'Fixturelang',
      aliases: [],
      providers: [{ id: 'PRV-fixturelang-v1', apiVersion: 1, dimensions: [{ dimensionId: 'DIM-does-not-exist-v1', categories: ['route'] }] }],
      rules: [{
        id: 'RUL-fixturelang-bogus-v1',
        dimensionId: 'DIM-does-not-exist-v1',
        category: 'route',
        label: 'bogus',
        literal: 'python',
        extensions: ['.py'],
        basenames: [],
        manifestNames: [],
        artifactTokens: [],
        regexSource: null,
      }],
    };
    const result = await runExpandedPipeline({
      repos: [repo],
      out: join(outDir, 'NORMS.md'),
      clock: FIXED_CLOCK,
      pluginRegistry: [bogusPlugin],
      sink: (findings, out, renderer) => { sinkCalls++; return writeNORMS(findings, out, renderer); },
    });
    assert.equal(sinkCalls, 1, 'the run with an unregistered rule dimension must complete and write exactly once');
    const markdown = await readFile(join(outDir, 'NORMS.md'), 'utf8');
    assert.equal(markdown.includes('DIM-does-not-exist-v1'), false, 'an unregistered dimension must never be fabricated');
    assert.equal(markdown.includes('fixturelang'), false, 'a rule with an unregistered dimension must produce no evidence');
    assert.equal(result.providerEvidenceCapped, false);
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 negative: invalid evidence records are rejected by the canonical contract', () => {
  const valid = {
    claimId: 'CLM-api-routes-v1',
    detectorId: 'DET-api-routes-v1',
    sourceKind: 'source',
    category: 'route',
    path: 'src/app.py',
    locator: 'app.py:5',
    matchedKey: 'api/routes',
    details: null,
  };
  const created = createEvidence(valid);
  assert.match(created.id, /^EVD-v1-[a-f0-9]{64}$/, 'a canonical evidence record receives a deterministic identity');

  assert.throws(
    () => createEvidence({ ...valid, bogusField: 1 }),
    (error) => error && error.code === 'UNKNOWN_FIELD',
  );
  assert.throws(
    () => createEvidence({ ...valid, path: '/abs/app.py' }),
    (error) => error && error.code === 'INVALID_PATH',
  );
  assert.throws(
    () => prepareEvidenceForPersistence([{ ...created, locator: 'alice.smith@example.test' }]),
    (error) => error instanceof PrivacyError && error.code === 'INVALID_EVIDENCE',
    'a sensitive locator must be rejected before persistence',
  );
  assert.throws(
    () => assertPrivacySafe({ ...created, rawResult: 'secret excerpt' }),
    (error) => error instanceof PrivacyError && error.code === 'SENSITIVE_FIELD',
    'evidence carrying a prohibited field must be rejected',
  );
});

test('T227 negative: unknown and missing renderers abort before the sole write', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-negative-renderer-'));
  try {
    assert.throws(
      () => createRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES.slice(0, 15) }),
      (error) => error instanceof RenderRegistryError && error.code === 'MISSING_RENDERER',
    );
    assert.throws(
      () => createRenderRegistry({
        entries: [
          ...DIMENSION_RENDERER_ENTRIES.slice(0, 15),
          { dimension: 'foreign-canary', rendererId: 'RND-foreign-canary-v1', label: 'x', prose: ['x'], render: () => '' },
        ],
      }),
      (error) => error instanceof RenderRegistryError && error.code === 'UNKNOWN_RENDERER',
    );

    const findings = {
      generated: '2026-08-03',
      repos: [{
        overview: { name: 'bad', path: '.', languages: [], totalFiles: 0 },
        deep: [{ dimension: 'private-canary', signal: 'low', findings: {} }],
      }],
    };
    const out = join(outDir, 'NORMS.md');
    await assert.rejects(
      writeNORMS(findings, out, createRenderRegistry()),
      (error) => error instanceof RenderRegistryError && error.code === 'UNKNOWN_DIMENSION',
    );
    assert.deepEqual(await readdir(outDir), [], 'an unknown renderer must not write a file');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 negative: standards-policy violations are rejected with sanitized typed errors', () => {
  const VALID = {
    id: 'std:test-std:1.0.0',
    publisher: 'Test Publisher',
    title: 'Test Standard',
    editionKey: '1.0.0',
    edition: '1.0.0',
    publicationDate: '2026-01-01',
    officialUri: 'https://example.test/standard',
    disposition: 'metadata_only',
  };
  const valid = validateStandardEntry(VALID);
  assert.equal(valid.disposition, 'metadata_only');

  assert.throws(
    () => validateStandardEntry({ ...VALID, disposition: 'authored_mapping' }),
    /metadata_only/,
  );
  assert.throws(
    () => validateStandardEntry({ ...VALID, id: 'std:test-std:1.0.0-latest', editionKey: '1.0.0-latest', edition: '1.0.0 latest' }),
    /floating marker/,
  );
  assert.throws(
    () => validateStandardEntry({ ...VALID, officialUri: 'https://user:pass@example.test/standard' }),
    /credentials/,
  );
  assert.throws(
    () => validateStandardsRegistry([VALID, { ...VALID, id: 'std:test-std:1.0.0' }]),
    /duplicate id/,
  );
  assert.throws(
    () => reuseDisposition({ bogus: 1 }),
    /unknown field/,
  );
  assert.equal(reuseDisposition({ authoredMapping: true, reuseProven: false }), 'metadata_only');
  assert.equal(reuseDisposition({}), 'metadata_only');
});

test('T227 negative: privacy violations abort before the write and before the sink', async () => {
  const leaked = {
    generated: '2026-08-03',
    repos: [{
      overview: { name: 'leaky', path: '.', languages: [], totalFiles: 0 },
      deep: [{
        dimension: 'api',
        signal: 'low',
        findings: {
          summary: { operations: 1 },
          operations: [{ source: { path: 'docs/alice.smith@example.test.md', line: 1 } }],
          diagnostics: [],
          searchSpace: { filesInspected: 1, fileLimit: 2 },
        },
      }],
    }],
    global: { metrics: { repositories: 0, components: 0, edges: 0, selfEdges: 0, crossRepositoryEdges: 0, external: 0, ambiguous: 0, unresolved: 0 } },
  };
  assert.throws(
    () => assertFindingsPrivacy(leaked),
    (error) => error && error.code === 'PRIVACY_LEAK',
    'a privacy leak in a new-dimension model must abort with PRIVACY_LEAK',
  );

  // The pipeline performs the privacy gate before the sole write call.
  const runSource = await readFile(join(ROOT, 'lib', 'scan', 'pipeline', 'run.mjs'), 'utf8');
  const privacyAt = runSource.indexOf('assertFindingsPrivacy(findings)');
  const sinkAt = runSource.indexOf('await sink(findings, out,');
  assert.ok(privacyAt !== -1 && sinkAt !== -1, 'run.mjs must contain both the privacy gate and the sink call');
  assert.ok(privacyAt < sinkAt, 'assertFindingsPrivacy must run before the sole sink call');
});

test('T227 negative: validation failures abort before the write with sanitized errors', async () => {
  const missing = join(tmpdir(), `csm-scan-t227-missing-${process.pid}-${Date.now()}`);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-negative-missing-'));
  try {
    await assert.rejects(
      runExpandedPipeline({ repos: [missing], out: join(outDir, 'NORMS.md'), clock: FIXED_CLOCK }),
      (error) => {
        assert.ok(!error.message.includes(missing), 'the pipeline error must not echo the missing repository path');
        return true;
      },
    );
    assert.deepEqual(await readdir(outDir), [], 'a failed run must not write any output file');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  // Empty repos is a validation failure before any scan or write.
  let sinkCalls = 0;
  await assert.rejects(
    runExpandedPipeline({ repos: [], clock: FIXED_CLOCK, sink: () => { sinkCalls++; return ''; } }),
    /non-empty repos/,
  );
  assert.equal(sinkCalls, 0, 'the sink must never be called for an empty repository list');
  assert.ok(
    !formatError(new Error(`scan failed at ${missing}`)).includes(missing),
    'formatted errors must never echo repository paths',
  );
});

test('T227 negative: unsupported, ambiguous, and unresolved constructs never fabricate facts', async () => {
  // Unsupported template/anchored OpenAPI never invents operations.
  const unsupported = makeFixture('t227-negative-unsupported', {
    'package.json': JSON.stringify({ name: 't227-unsupported', type: 'module' }),
    'openapi.yaml': [
      'openapi: 3.0.0',
      'defaults: &base',
      '  x: 1',
      'paths:',
      '  /a:',
      '    get: *base',
      '',
    ].join('\n'),
  });
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-negative-fixtures-'));
  try {
    const result = await runExpandedPipeline({ repos: [unsupported], out: join(outDir, 'u.md'), clock: FIXED_CLOCK });
    const api = result.repos[0].deep.find(({ dimension }) => dimension === 'api');
    assert.deepEqual(api.findings.operations, [], 'an unsupported template must never invent operations');
    assert.ok(
      api.findings.diagnostics.some(({ status, reason }) => status === 'unsupported' && reason === 'PARSE_UNSUPPORTED'),
      'unsupported constructs must be disclosed as diagnostics, never evaluated',
    );
    assert.equal(api.findings.searchSpace.complete, true, 'the read search stays complete; the format is what is unsupported');

    // Cross-repository ambiguity is retained, never an edge.
    const a = makeFixture('t227-negative-ca', repoA);
    const b = makeFixture('t227-negative-cb', repoB);
    try {
      const cross = await runExpandedPipeline({ repos: [a, b], out: join(outDir, 'c.md'), clock: FIXED_CLOCK });
      assert.equal(cross.global.metrics.crossRepositoryEdges, 0, 'an ambiguous exact reference never becomes an edge');
      assert.equal(cross.global.metrics.ambiguous, 2, 'ambiguous references are retained as disclosed records');
      assert.deepEqual(cross.global.edges.edges, [], 'no edge is fabricated from two identical candidates');
    } finally {
      cleanupFixture(a);
      cleanupFixture(b);
    }

    // A NAME_ONLY data relationship is disclosed, never an ER edge.
    const pythonRepo = makeFixture('t227-negative-data', pythonFiles);
    try {
      const data = (await runExpandedPipeline({ repos: [pythonRepo], out: join(outDir, 'd.md'), clock: FIXED_CLOCK }))
        .repos[0].deep.find(({ dimension }) => dimension === 'data');
      assert.ok(
        data.findings.diagnostics.some(({ status, reason }) => status === 'unverified' && reason === 'NAME_ONLY'),
        'a relationship without an FK must be disclosed as NAME_ONLY',
      );
      assert.ok(
        data.findings.edges.every((edge) => edge.kind === 'foreign_key'),
        'no edge may be fabricated from a name-only relationship',
      );
    } finally {
      cleanupFixture(pythonRepo);
    }
  } finally {
    cleanupFixture(unsupported);
    await rm(outDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B) Constraint re-checks
// ---------------------------------------------------------------------------

function expectedRgGlobArgs() {
  return rgIgnoreArgs().flatMap((entry) => {
    const i = entry.indexOf(' ');
    return [entry.slice(0, i), entry.slice(i + 1)];
  });
}

const GIT_ARGV_FORMS = Object.freeze([
  ['rev-parse', '--show-toplevel'],
  ['rev-parse', '--abbrev-ref', 'HEAD'],
  ['log', '--oneline', '-50'],
  ['log', '--oneline', '-200'],
  ['ls-files'],
  ['branch', '-a'],
  ['symbolic-ref', 'refs/remotes/origin/HEAD'],
  ['config', '--get', 'remote.origin.url'],
  ['shortlog', '-s', '-n', 'HEAD'],
]);

const TARGET_EXECUTABLES = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'node', 'deno',
  'python', 'python3', 'pip', 'pip3', 'uv',
  'cargo', 'rustc', 'go', 'make', 'cmake', 'ninja',
  'bash', 'sh', 'zsh', 'curl', 'wget', 'docker', 'kubectl',
]);

function isRegisteredBrokerShape(call) {
  const argv = call.argv;
  if (call.executable === 'rg') {
    if (argv[0] === '--files') {
      return argv.length === 1 + expectedRgGlobArgs().length
        && JSON.stringify(argv.slice(1)) === JSON.stringify(expectedRgGlobArgs());
    }
    if (argv[0] === '--json') {
      const globs = expectedRgGlobArgs();
      const prefix = argv.slice(1, 1 + globs.length);
      const tail = argv.slice(1 + globs.length);
      return JSON.stringify(prefix) === JSON.stringify(globs)
        && tail.length === 2 && tail[0] === '--' && typeof tail[1] === 'string';
    }
    return false;
  }
  if (call.executable === 'git') {
    return GIT_ARGV_FORMS.some((form) => JSON.stringify(argv) === JSON.stringify(form));
  }
  return false;
}

test('T227 constraint: the pipeline issues only registered broker command IDs and zero target commands', async () => {
  const calls = [];
  const broker = createCommandBroker({
    runner: {
      async run(executable, argv, options) {
        calls.push({ executable, argv: [...argv], shell: options.shell });
        return defaultRunner.run(executable, argv, options);
      },
    },
  });

  const repo = makeFixture('t227-constraint-cmd', pythonFiles);
  const gitRepo = makeGitRepo({
    files: { 'README.md': 't227 constraint\n', 'pyproject.toml': '[project]\nname = "t227"\nversion = "0.1.0"\n' },
    commits: ['feat: initial'],
  });
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-constraint-'));
  try {
    await runExpandedPipeline({ repos: [repo, gitRepo], out: join(outDir, 'NORMS.md'), clock: FIXED_CLOCK, commandRunner: broker });

    assert.ok(calls.length > 0, 'the pipeline must issue broker commands');
    for (const call of calls) {
      assert.ok(
        ['rg', 'git'].includes(call.executable),
        `only the rg/git families may run; saw ${call.executable} ${call.argv.join(' ')}`,
      );
      assert.equal(call.shell, false, 'shell mode must always be disabled');
      assert.ok(isRegisteredBrokerShape(call), `argv ${call.executable} ${call.argv.join(' ')} must match a registered broker command`);
    }
    const targetCalls = calls.filter((call) => TARGET_EXECUTABLES.has(call.executable));
    assert.equal(targetCalls.length, 0, `no target command may execute (saw ${targetCalls.length})`);
  } finally {
    cleanupFixture(repo);
    cleanupGitRepo(gitRepo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 constraint: exactly one production write per run', async () => {
  const repo = makeFixture('t227-constraint-write', pythonFiles);
  const outDir = await mkdtemp(join(tmpdir(), 'csm-scan-t227-constraint-write-'));
  let sinkCalls = 0;
  try {
    const result = await runExpandedPipeline({
      repos: [repo],
      out: join(outDir, 'NORMS.md'),
      clock: FIXED_CLOCK,
      sink: (findings, out, renderer) => { sinkCalls++; return writeNORMS(findings, out, renderer); },
    });
    assert.equal(sinkCalls, 1, 'the expanded pipeline must perform exactly one sink call');
    assert.ok(result.markdown.length > 0);
    assert.deepEqual(await readdir(outDir), ['NORMS.md'], 'a run must produce exactly one output file');
  } finally {
    cleanupFixture(repo);
    await rm(outDir, { recursive: true, force: true });
  }
});

test('T227 constraint: zero-dependency and closed import audits hold for the production tree', async () => {
  const rootEntries = await readdir(ROOT);
  assert.deepEqual(
    rootEntries.filter((name) => [
      'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'node_modules',
    ].includes(name)),
    [],
    'the skill must remain zero-dependency with no npm footprint',
  );

  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(join(ROOT, 'lib'));
  await visit(join(ROOT, 'scripts'));

  // Statement-level static import extraction (masked so string/template code
  // cannot alias an import), mirroring the T201 acquisition audit.
  const staticImports = (source) => {
    const mask = lexicalMask(source);
    const statements = [];
    const pattern = /^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"\n]+)\1\s*;?/gm;
    for (const match of source.matchAll(pattern)) {
      const token = match[0].search(/\S/);
      if (token < 0 || mask[match.index + token] === ' ') continue;
      statements.push({ text: match[0].trim(), specifier: match[2] });
    }
    return statements;
  };

  const forbiddenSpecifiers = ['node:process', 'node:vm', 'node:module'];
  let childProcessOwners = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const mask = lexicalMask(source);
    const imports = staticImports(source);
    for (const { text, specifier } of imports) {
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../'),
        `${file} must import no npm packages (${text})`,
      );
      assert.ok(!forbiddenSpecifiers.includes(specifier), `${file} must not import ${specifier}`);
      if (specifier === 'node:child_process') childProcessOwners++;
    }
    assert.ok(!mask.includes('shell: true'), `${file} must never enable shell mode`);
    assert.ok(!/\brequire\s*\(/.test(mask), `${file} must not use require`);
    assert.ok(!/getBuiltinModule/.test(mask), `${file} must not acquire builtins dynamically`);
  }
  assert.equal(childProcessOwners, 1, 'the broker must remain the sole node:child_process owner');
});

test('T227 constraint: recorded git and rg argv forms are strictly read-only', () => {
  // Every registered git command is a read-only metadata/history query. The
  // single `config` form is `config --get remote.origin.url` (a read).
  const mutating = ['add', 'commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'reset', 'rm', 'mv', 'write-tree', 'update-index', 'tag', 'checkout', 'clean', 'restore', 'stash'];
  for (const form of GIT_ARGV_FORMS) {
    for (const token of form) {
      assert.ok(!mutating.includes(token), `git argv ${form.join(' ')} must be read-only`);
      if (token === 'config') {
        assert.equal(form.join(' '), 'config --get remote.origin.url', 'the only registered config form is config --get');
      }
    }
  }
  const rgFiles = ['--files', ...expectedRgGlobArgs()];
  assert.ok(!rgFiles.some((token) => token.startsWith('--replace') || token.startsWith('--write')),
    'rg file enumeration must remain read-only');
});
