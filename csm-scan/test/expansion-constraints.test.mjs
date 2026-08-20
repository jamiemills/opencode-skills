import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createRecordingRunner, lexicalMask } from './helpers/recording-runner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_ROOT = join(ROOT, 'test', 'baselines', 'expansion');
const PRODUCTION_ROOTS = ['lib', 'scripts'];
const ORIGINAL_LEGACY_OWNERS = [
  'lib/scan/deep/conventions.mjs',
  'lib/scan/deep/documentation.mjs',
  'lib/scan/deep/git.mjs',
  'lib/scan/deep/operations.mjs',
  'lib/scan/deep/security.mjs',
  'lib/scan/deep/stack.mjs',
  'lib/scan/shared/enum.mjs',
  'lib/scan/survey.mjs',
];

function digest(source) {
  return createHash('sha256').update(source).digest('hex');
}

function codeMatches(source, pattern) {
  return [...lexicalMask(source).matchAll(pattern)];
}

function staticModuleStatements(source) {
  const mask = lexicalMask(source);
  const statements = [];
  const pattern = /^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"\n]+)\1\s*;?/gm;
  for (const match of source.matchAll(pattern)) {
    const token = match[0].search(/\S/);
    if (token < 0 || mask[match.index + token] === ' ') continue;
    statements.push({ text: match[0].trim(), specifier: match[2] });
  }
  return statements;
}

function dynamicImports(source) {
  return codeMatches(source, /\bimport\s*\(/g).map((match) => {
    const rest = source.slice(match.index + match[0].length);
    const literal = rest.match(/^\s*(['"])([^'"\n]+)\1\s*\)/);
    return { index: match.index, specifier: literal?.[2] ?? null };
  });
}

function canonicalSensitiveImport(statement) {
  const match = statement.match(/^import \{ ([A-Za-z_$][\w$]*(?:, [A-Za-z_$][\w$]*)*) \} from '(node:fs(?:\/promises)?|node:child_process)';$/);
  if (!match) return null;
  return { names: match[1].split(', '), specifier: match[2] };
}

function staticSensitiveMentions(source) {
  const mask = lexicalMask(source);
  const mentions = [];
  const pattern = /(['"])(node:(?:fs(?:\/promises)?|child_process|module|process|vm))\1/g;
  for (const match of source.matchAll(pattern)) {
    const prefix = mask.slice(0, match.index);
    if (/(?:\bfrom|\bimport)\s*$/.test(prefix)) mentions.push(match[2]);
  }
  return mentions;
}

function acquisitionViolations(source) {
  const violations = [];
  const statements = staticModuleStatements(source);
  const parsedSensitive = statements
    .map(({ specifier }) => specifier)
    .filter((specifier) => /^node:(?:fs(?:\/promises)?|child_process|module|process|vm)$/.test(specifier));
  const mentionedSensitive = staticSensitiveMentions(source);
  if (parsedSensitive.length !== mentionedSensitive.length
      || parsedSensitive.some((specifier, index) => specifier !== mentionedSensitive[index])) {
    violations.push('noncanonical:unparsed-sensitive-import');
  }
  for (const statement of statements) {
    if (!statement.specifier.startsWith('node:')
        && !statement.specifier.startsWith('./')
        && !statement.specifier.startsWith('../')) {
      violations.push(`static:package:${statement.specifier}`);
    }
    if (statement.specifier.startsWith('node:') && !/^node:[a-z0-9_/-]+$/.test(statement.specifier)) {
      violations.push(`noncanonical:builtin:${statement.specifier}`);
    }
    if (['node:fs', 'node:fs/promises', 'node:child_process'].includes(statement.specifier)
        && !canonicalSensitiveImport(statement.text)) {
      violations.push(`noncanonical:${statement.specifier}`);
    }
    if (['node:module', 'node:process', 'node:vm'].includes(statement.specifier)) {
      violations.push(`forbidden:${statement.specifier}`);
    }
  }
  for (const call of dynamicImports(source)) {
    if (call.specifier === null) violations.push('dynamic:nonliteral');
    else if (!call.specifier.startsWith('./') && !call.specifier.startsWith('../')) {
      violations.push(`dynamic:${call.specifier}`);
    }
  }
  if (codeMatches(source, /\brequire\s*\(/g).length) violations.push('forbidden:require');
  if (codeMatches(source, /\bcreateRequire\b/g).length) violations.push('forbidden:createRequire');
  if (codeMatches(source, /\bgetBuiltinModule\b/g).length) violations.push('forbidden:getBuiltinModule');
  return violations;
}

async function esmFiles(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(root);
  return files.toSorted();
}

async function productionSources() {
  const files = (await Promise.all(PRODUCTION_ROOTS.map((dir) => esmFiles(join(ROOT, dir))))).flat().toSorted();
  return Promise.all(files.map(async (path) => ({
    path,
    relativePath: relative(ROOT, path).replaceAll('\\', '/'),
    source: await readFile(path, 'utf8'),
  })));
}

async function capabilities() {
  return JSON.parse(await readFile(join(BASELINE_ROOT, 'capabilities.json'), 'utf8'));
}

test('T201 capability baseline fixes the original process-owner universe', async () => {
  const baseline = await capabilities();
  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.originalLegacyOwnerUniverse, ORIGINAL_LEGACY_OWNERS);
  assert.equal(new Set(baseline.originalLegacyOwnerUniverse).size, ORIGINAL_LEGACY_OWNERS.length);
  assert.ok(baseline.activeLegacyOwners.every(({ path }) => ORIGINAL_LEGACY_OWNERS.includes(path)));
  assert.equal(baseline.plannedBrokerPath, 'lib/scan/shared/command.mjs');
  if (baseline.broker !== null) {
    assert.equal(baseline.broker.path, baseline.plannedBrokerPath);
    assert.equal(baseline.broker.api, 'execFile');
    assert.deepEqual(canonicalSensitiveImport(baseline.broker.import), {
      names: ['execFile'], specifier: 'node:child_process',
    });
    assert.ok(baseline.broker.replacementTests.length > 0, 'the broker requires reviewed replacement tests');
  }
});

test('T201 active legacy process owners match exact imports and reviewed file hashes', async () => {
  const baseline = await capabilities();
  const sources = await productionSources();
  const actualOwners = sources.filter(({ source }) => staticSensitiveMentions(source).includes('node:child_process'));
  const expectedOwners = [
    ...baseline.activeLegacyOwners.map(({ path }) => path),
    ...(baseline.broker ? [baseline.broker.path] : []),
  ].toSorted();
  assert.deepEqual(
    actualOwners.map(({ relativePath }) => relativePath),
    expectedOwners,
  );
  for (const owner of baseline.activeLegacyOwners) {
    const source = actualOwners.find(({ relativePath }) => relativePath === owner.path)?.source;
    assert.ok(source, `${owner.path} must remain present while active`);
    assert.equal(digest(source), owner.sha256, `${owner.path} changed before its planned migration`);
    const imports = staticModuleStatements(source).filter(({ specifier }) => specifier === 'node:child_process');
    assert.deepEqual(imports.map(({ text }) => text), [owner.import]);
    assert.deepEqual(canonicalSensitiveImport(owner.import), {
      names: [owner.api],
      specifier: 'node:child_process',
    });
  }
  if (baseline.broker) {
    const source = actualOwners.find(({ relativePath }) => relativePath === baseline.broker.path)?.source;
    const imports = staticModuleStatements(source).filter(({ specifier }) => specifier === 'node:child_process');
    assert.deepEqual(imports.map(({ text }) => text), [baseline.broker.import]);
    const inventory = JSON.parse(await readFile(join(BASELINE_ROOT, 'inventory.json'), 'utf8'));
    for (const replacement of baseline.broker.replacementTests) {
      assert.ok(inventory.recurringAcceptanceTestFiles.includes(replacement.testFile));
      const replacementSource = await readFile(join(ROOT, replacement.testFile), 'utf8');
      assert.equal(digest(replacementSource), replacement.testFileSha256);
      assert.equal(typeof replacement.testName, 'string');
      assert.ok(replacementSource.includes(replacement.testName));
    }
  }
});

test('T201 production capability acquisition is direct static and closed', async () => {
  const baseline = await capabilities();
  const sources = await productionSources();
  for (const { relativePath, source } of sources) {
    const violations = acquisitionViolations(source);
    const nonliteral = violations.filter((entry) => entry === 'dynamic:nonliteral');
    const other = violations.filter((entry) => entry !== 'dynamic:nonliteral');
    assert.deepEqual(other, [], `${relativePath} has forbidden capability acquisition`);
    if (nonliteral.length === 0) continue;
    assert.equal(relativePath, baseline.safeImportLegacyLock.path);
    assert.equal(nonliteral.length, 1, 'legacy safeImport must remain singular');
    assert.equal(digest(source), baseline.safeImportLegacyLock.sha256, 'legacy safeImport is locked until T224');
    assert.equal(baseline.safeImportLegacyLock.replacementTask, 'T224');
  }
  const safeImportOwner = sources.find(({ source }) => codeMatches(source, /\bsafeImport\b/g).length > 0);
  if (safeImportOwner) {
    assert.equal(safeImportOwner.relativePath, baseline.safeImportLegacyLock.path);
    assert.equal(digest(safeImportOwner.source), baseline.safeImportLegacyLock.sha256);
  }
  const rootEntries = await readdir(ROOT);
  assert.deepEqual(rootEntries.filter((name) => [
    'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'node_modules',
  ].includes(name)), []);
});

test('T201 filesystem capabilities are closed to reads and one exact writer', async () => {
  const baseline = await capabilities();
  const sources = await productionSources();
  const allowedReads = new Set(baseline.filesystem.readApis);
  const specialByPath = new Map(baseline.filesystem.specialReaders.map((entry) => [entry.path, entry]));
  let writerImports = 0;
  for (const { relativePath, source } of sources) {
    for (const statement of staticModuleStatements(source)) {
      if (!baseline.filesystem.modules.includes(statement.specifier)) continue;
      const parsed = canonicalSensitiveImport(statement.text);
      assert.ok(parsed, `${relativePath} has noncanonical filesystem ownership`);
      for (const name of parsed.names) {
        if (relativePath === baseline.filesystem.writer.path
            && name === baseline.filesystem.writer.api
            && statement.text === baseline.filesystem.writer.import) {
          writerImports++;
          continue;
        }
        if (allowedReads.has(name)) continue;
        const special = specialByPath.get(relativePath);
        assert.ok(special, `${relativePath} imports non-read filesystem API ${name}`);
        assert.ok(special.imports.includes(statement.text), `${relativePath} special-reader import must stay exact`);
        assert.ok(special.apis.includes(name), `${relativePath} uses an unlisted special-reader API ${name}`);
      }
    }
  }
  assert.equal(writerImports, 1);
  for (const special of baseline.filesystem.specialReaders) {
    const source = sources.find(({ relativePath }) => relativePath === special.path)?.source;
    assert.ok(source, `${special.path} must remain present while special-reader capable`);
    assert.equal(digest(source), special.sha256, `${special.path} changed before its migration`);
  }
  const writer = sources.find(({ relativePath }) => relativePath === baseline.filesystem.writer.path)?.source;
  assert.equal(writer.split(baseline.filesystem.writer.call).length - 1, 1, 'sole write call must remain exact');
  const cli = sources.find(({ relativePath }) => relativePath === baseline.filesystem.cli.path)?.source;
  assert.equal(cli.split(baseline.filesystem.cli.call).length - 1, 1, 'CLI must invoke writeNORMS exactly once');
});

test('T201 acquisition audit rejects bypasses without domain-member false positives', () => {
  for (const source of [
    "import fs from 'node:fs';",
    "import * as fs from 'node:fs';",
    "import { writeFile as save } from 'node:fs/promises';",
    "import {\n  writeFile\n} from 'node:fs/promises';",
    "import/* comment */{ writeFile }from'node:fs/promises';",
    "import 'node:fs';",
    "export { execFile } from 'node:child_process';",
    "export * from 'node:fs';",
    "import('node:child_process');",
    "import('package-name');",
    "import(packageName);",
    "require('node:fs');",
    "import { createRequire } from 'node:module';",
    "process.getBuiltinModule('fs');",
    "import { getBuiltinModule } from 'node:process'; getBuiltinModule('fs');",
    "import { getBuiltinModule as loadBuiltin } from 'node:process'; loadBuiltin('child_process');",
    "import { 'getBuiltinModule' as loadBuiltin } from 'node:process'; loadBuiltin('fs');",
    "import { get\\u0042uiltinModule as loadBuiltin } from 'node:process'; loadBuiltin('child_process');",
    "import vm from 'node:vm';",
    "import value from 'package-name';",
    "import value from 'node:\\x66s';",
  ]) assert.notDeepEqual(acquisitionViolations(source), [], source);
  assert.deepEqual(acquisitionViolations("import { readFile } from 'node:fs/promises';"), []);
  assert.deepEqual(acquisitionViolations("import('./relative.mjs');"), []);
  assert.deepEqual(acquisitionViolations("object.open(); const domain = { shell: true };"), []);
  assert.deepEqual(acquisitionViolations("const text = `open ${object.open()} ${domain.shell}`;"), []);
});

test('T201 recording runner captures immutable command inputs and outcomes', async () => {
  const env = { PATH: '/controlled/bin', TOKEN: 'not-forwarded-by-production-yet' };
  const controller = new AbortController();
  const { calls, run } = createRecordingRunner([
    { status: 0, stdout: 'first\n', stderr: '' },
    new Error('configured failure'),
  ]);
  const result = await run('rg', ['--files', '--hidden'], {
    cwd: '/repo', env, timeout: 5000, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], signal: controller.signal,
    outputPolicy: { maxBytes: 1024, encoding: 'utf8' },
  });
  env.PATH = '/changed';
  assert.deepEqual(result, { status: 0, stdout: 'first\n', stderr: '' });
  assert.deepEqual(calls[0], {
    executable: 'rg', argv: ['--files', '--hidden'], cwd: '/repo',
    env: { PATH: '/controlled/bin', TOKEN: 'not-forwarded-by-production-yet' },
    timeout: 5000, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    signal: { aborted: false, reason: undefined },
    outputPolicy: { maxBytes: 1024, encoding: 'utf8' },
  });
  assert.ok(Object.isFrozen(calls[0]));
  assert.throws(() => calls.push({}), /read-only/);
  await assert.rejects(run('git', ['status'], { cwd: '/repo', env: {} }), /configured failure/);
  assert.equal(calls.length, 2);
});

test('T201 recording runner snapshots functional outcomes', async () => {
  const { calls, run } = createRecordingRunner((call, index) => ({
    mutationAttempt: (() => { try { call.argv.push('mutated'); } catch {} return call.argv.length; })(),
    status: index,
    stdout: `${call.executable}:${call.argv.join(',')}`,
    stderr: '',
  }));
  assert.deepEqual(await run('git', ['log', '-1']), {
    mutationAttempt: 2, status: 0, stdout: 'git:log,-1', stderr: '',
  });
  assert.deepEqual(calls[0].argv, ['log', '-1']);
});

test('T202 replacement: free-form applicability rules yield not_applicable git claims excluded from coverage', async () => {
  const { withFixture } = await import('./harness.mjs');
  const { runExpandedPipeline } = await import('../lib/scan/pipeline/run.mjs');
  await withFixture('t202-freeform-na', { 'app.py': 'value = 1\n' }, async (dir) => {
    const coverage = (await runExpandedPipeline({ repos: [dir], out: join(dir, 'NORMS.md'), reporter: null })).expectedClaimCoverage;
    assert.equal(coverage.excluded, 2, 'non-git fixture excludes the git dimension as not_applicable');
    assert.equal(coverage.repos[0].perDimension.git.status, 'not_applicable');
  });
});

test('T202 replacement: coverage status representation maps claim statuses to coverage states', async () => {
  const { withFixture } = await import('./harness.mjs');
  const { runExpandedPipeline } = await import('../lib/scan/pipeline/run.mjs');
  await withFixture('t202-coverage-status', { 'app.py': 'value = 1\n' }, async (dir) => {
    const coverage = (await runExpandedPipeline({ repos: [dir], out: join(dir, 'NORMS.md'), reporter: null })).expectedClaimCoverage;
    assert.deepEqual(
      Object.keys(coverage).toSorted(),
      ['complete', 'eligible', 'excluded', 'expected', 'incomplete', 'ratio', 'repos', 'unsupported'],
      'coverage aggregate carries the canonical representation fields',
    );
    assert.equal(coverage.expected, 94, 'every registry claim is counted');
    assert.equal(
      coverage.complete + coverage.incomplete + coverage.unsupported + coverage.excluded,
      coverage.expected,
      'every claim is counted exactly once',
    );
    assert.equal(coverage.ratio, coverage.eligible === 0 ? null : coverage.complete / coverage.eligible);
    const per = coverage.repos[0].perDimension;
    assert.equal(per.git.status, 'not_applicable', 'non-git repo represents the git dimension as not_applicable');
    assert.equal(per.practices.status, 'not_detected', 'empty practices signals are represented as not_detected');
  });
});
