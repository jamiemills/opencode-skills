import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { withFixture, surveyOverview } from './harness.mjs';
import { scan } from '../lib/scan/deep/testing.mjs';

const PERPLEXITY = '/home/jamiemills/code/projects/perplexity-cli';
const hasPerplexity = existsSync(join(PERPLEXITY, 'pyproject.toml'));

// ---------------------------------------------------------------------------
// Python fixture: pytest declared in [project.optional-dependencies], a test
// file matched by `test_*.py`, and a `[tool.pytest.ini_options]` marker.
// Exercises the overview-preferred path (survey then scan).
// ---------------------------------------------------------------------------

test('python fixture: pytest detected, test_*.py matched, pyproject pytest marker found', async () => {
  const files = {
    'pyproject.toml': [
      '[build-system]',
      'requires = ["setuptools>=77.0"]',
      'build-backend = "setuptools.build_meta"',
      '',
      '[project]',
      'name = "pyfix"',
      'version = "0.1.0"',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=7.0", "pytest-cov>=7.0"]',
      '',
      '[tool.pytest.ini_options]',
      'testpaths = ["tests"]',
      '',
    ].join('\n'),
    'tests/test_core.py': 'def test_core():\n    assert True\n',
    'src/pyfix/__init__.py': '',
  };

  await withFixture('testing-py', files, async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;
    const fw = f.framework.join(' ').toLowerCase();

    assert.equal(res.dimension, 'testing');
    assert.ok(fw.includes('pytest'), `framework should include pytest: ${JSON.stringify(f.framework)}`);
    assert.ok(f.fileCount >= 1, `fileCount should be >= 1: ${f.fileCount}`);
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('test_core.py')),
      `sampleFiles should include test_core.py: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      f.naming.includes('test_*.py'),
      `naming should include the matched glob 'test_*.py': ${JSON.stringify(f.naming)}`,
    );
    assert.ok(
      f.configFiles && f.configFiles.includes('pyproject.toml:[tool.pytest.ini_options]'),
      `configFiles should include the pyproject pytest marker: ${JSON.stringify(f.configFiles)}`,
    );
    assert.ok(
      f.coverage && f.coverage.includes('pytest-cov'),
      `coverage should include pytest-cov: ${JSON.stringify(f.coverage)}`,
    );
    assert.equal(f.script, null, 'python repo has no package.json test script');
    assert.equal(res.signal, 'high');
  });
});

// ---------------------------------------------------------------------------
// JavaScript fixture: jest devDependency + test script, *.test.js matched.
// ---------------------------------------------------------------------------

test('javascript fixture: jest detected and *.test.js matched', async () => {
  const files = {
    'package.json': JSON.stringify({
      name: 'jsfix',
      version: '1.0.0',
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }, null, 2),
    'src/add.js': 'export const add = (a, b) => a + b;\n',
    'src/add.test.js': 'import { test } from "node:test";\n\ntest("adds", () => {});\n',
  };

  await withFixture('testing-js', files, async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;
    const fw = f.framework.join(' ').toLowerCase();

    assert.ok(fw.includes('jest'), `framework should include jest: ${JSON.stringify(f.framework)}`);
    assert.ok(f.fileCount >= 1, `fileCount should be >= 1: ${f.fileCount}`);
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('add.test.js')),
      `sampleFiles should include add.test.js: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.equal(f.script, 'jest');
    assert.equal(res.signal, 'high');
  });
});

// ---------------------------------------------------------------------------
// Rust fixture: Cargo.toml present => cargo test is the default runner, and a
// #[test] attribute in tests/**/*.rs. Exercises the no-overview fallback path.
// ---------------------------------------------------------------------------

test('rust fixture: cargo test + #[test], tests/**/*.rs matched (no overview fallback)', async () => {
  const files = {
    'Cargo.toml': [
      '[package]',
      'name = "rustfix"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      '',
    ].join('\n'),
    'src/main.rs': 'fn main() {}\n',
    'tests/basic.rs': [
      '#[test]',
      'fn it_works() {',
      '    assert_eq!(2 + 2, 4);',
      '}',
      '',
    ].join('\n'),
  };

  await withFixture('testing-rs', files, async (dir) => {
    const res = await scan(dir); // no overview -> enumerate + readManifest fallback
    const f = res.findings;
    const fw = f.framework.join(' ').toLowerCase();

    assert.ok(fw.includes('cargo test'), `framework should include cargo test: ${JSON.stringify(f.framework)}`);
    assert.ok(fw.includes('builtin'), `framework should include the #[test] builtin: ${JSON.stringify(f.framework)}`);
    assert.ok(f.fileCount >= 1, `fileCount should be >= 1: ${f.fileCount}`);
    assert.ok(
      f.naming.includes('tests/**/*.rs'),
      `naming should include 'tests/**/*.rs': ${JSON.stringify(f.naming)}`,
    );
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('basic.rs')),
      `sampleFiles should include basic.rs: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.equal(f.script, null);
    assert.equal(res.signal, 'high');
  });
});

// ---------------------------------------------------------------------------
// Python stdlib marker: unittest is not an installable dep but its label is
// tagged "(stdlib)", so it is detected by scanning test-file imports.
// ---------------------------------------------------------------------------

test('python stdlib marker: unittest detected via test-file import', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "legacy"\nversion = "0.1.0"\n',
    'tests/test_legacy.py': [
      'import unittest',
      '',
      'class LegacyTest(unittest.TestCase):',
      '    def test_thing(self):',
      '        self.assertTrue(True)',
      '',
    ].join('\n'),
  };

  await withFixture('testing-unittest', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    const fw = f.framework.join(' ').toLowerCase();

    assert.ok(fw.includes('unittest'), `framework should include unittest: ${JSON.stringify(f.framework)}`);
    assert.ok(!fw.includes('pytest'), `should not report pytest when absent: ${JSON.stringify(f.framework)}`);
    assert.ok(f.fileCount >= 1);
  });
});

// ---------------------------------------------------------------------------
// Empty repo: nothing detected -> framework ['unknown'], signal 'low'.
// ---------------------------------------------------------------------------

test('empty repo: framework unknown, zero files, signal low', async () => {
  await withFixture('testing-empty', { 'README.md': '# nothing\n' }, async (dir) => {
    const res = await scan(dir);
    assert.deepEqual(res.findings.framework, ['unknown']);
    assert.equal(res.findings.fileCount, 0);
    assert.equal(res.findings.configFiles, null);
    assert.equal(res.findings.coverage, null);
    assert.equal(res.findings.script, null);
    assert.equal(res.signal, 'low');
  });
});

// ---------------------------------------------------------------------------
// P0-17: `node:test` is a Node built-in marker, not an installable dep.
// Detected by scanning test/source files for the quoted module specifier
// (`from 'node:test'`, `require('node:test')`, dynamic `import('node:test')`).
// ---------------------------------------------------------------------------

test('node:test marker detected via ESM import (P0-17)', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'nt-import', version: '1.0.0' }, null, 2),
    'tests/runner.test.js': [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      '',
      "test('adds', () => { assert.equal(1 + 1, 2); });",
      '',
    ].join('\n'),
  };

  await withFixture('testing-nodetest-import', files, async (dir) => {
    const res = await scan(dir);
    const fw = res.findings.framework.join(' ').toLowerCase();
    assert.ok(
      fw.includes('node:test'),
      `framework should include node:test: ${JSON.stringify(res.findings.framework)}`,
    );
    assert.ok(res.findings.fileCount >= 1);
  });
});

test('node:test marker detected via require() (P0-17)', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'nt-require', version: '1.0.0' }, null, 2),
    'tests/runner.test.cjs': [
      "const { test } = require('node:test');",
      '',
      "test('adds', () => {});",
      '',
    ].join('\n'),
  };

  await withFixture('testing-nodetest-require', files, async (dir) => {
    const res = await scan(dir);
    const fw = res.findings.framework.join(' ').toLowerCase();
    assert.ok(
      fw.includes('node:test'),
      `framework should include node:test via require: ${JSON.stringify(res.findings.framework)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// P0-19: JS testFileGlobs includes *.spec.{js,mjs,cjs,jsx} (parity with TS).
// ---------------------------------------------------------------------------

test('javascript *.spec.js glob matched (P0-19 parity with TS)', async () => {
  const files = {
    'package.json': JSON.stringify({
      name: 'specfix',
      version: '1.0.0',
      devDependencies: { jest: '^29.0.0' },
    }, null, 2),
    'src/add.js': 'export const add = (a, b) => a + b;\n',
    'src/add.spec.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
  };

  await withFixture('testing-spec', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.ok(f.fileCount >= 1, `fileCount should be >= 1: ${f.fileCount}`);
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('add.spec.js')),
      `sampleFiles should include add.spec.js: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      f.naming.some((n) => n.includes('spec')),
      `naming should include a spec glob: ${JSON.stringify(f.naming)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// P1: Rust inline unit tests (`#[cfg(test)] mod tests { #[test] ... }`) in
// src/**/*.rs are counted toward fileCount + framework detection, so a crate
// with only inline tests is not reported as fileCount 0.
// ---------------------------------------------------------------------------

test('rust inline #[cfg(test)] in src counted (P1)', async () => {
  const files = {
    'Cargo.toml': [
      '[package]',
      'name = "inlinefix"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      '',
    ].join('\n'),
    'src/lib.rs': [
      'pub fn add(a: i32, b: i32) -> i32 { a + b }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '',
      '    #[test]',
      '    fn it_adds() {',
      '        assert_eq!(add(2, 2), 4);',
      '    }',
      '}',
      '',
    ].join('\n'),
  };

  await withFixture('testing-rs-inline', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    const fw = f.framework.join(' ').toLowerCase();

    assert.ok(
      f.fileCount >= 1,
      `fileCount should be >= 1 (inline tests counted): ${f.fileCount}`,
    );
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('lib.rs')),
      `sampleFiles should include src/lib.rs: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      f.naming.some((n) => n.includes('#[test] inline')),
      `naming should record the inline-test scan: ${JSON.stringify(f.naming)}`,
    );
    assert.ok(
      fw.includes('cargo test'),
      `framework should include cargo test: ${JSON.stringify(f.framework)}`,
    );
    assert.ok(
      fw.includes('builtin'),
      `framework should include the #[test] builtin: ${JSON.stringify(f.framework)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// P1: Rust coverage tools (grcov / llvm-cov / cargo-llvm-cov) are detected
// from CI workflow references, not only Cargo dependencies.
// ---------------------------------------------------------------------------

test('rust coverage detected via CI workflow refs (P1)', async () => {
  const files = {
    'Cargo.toml': [
      '[package]',
      'name = "covfix"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
    ].join('\n'),
    'src/main.rs': 'fn main() {}\n',
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  coverage:',
      '    steps:',
      '      - run: cargo install cargo-llvm-cov',
      '      - run: cargo llvm-cov --html',
      '      - run: grcov . -o lcov.info',
      '',
    ].join('\n'),
  };

  await withFixture('testing-rs-cov', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(
      cov && cov.includes('cargo-llvm-cov'),
      `coverage should include cargo-llvm-cov: ${JSON.stringify(cov)}`,
    );
    assert.ok(
      cov && cov.includes('grcov'),
      `coverage should include grcov: ${JSON.stringify(cov)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Real repo: perplexity-cli. pytest in optional-dependencies, hypothesis in
// [dependency-groups] (parsed here directly), >=200 matched test files.
// ---------------------------------------------------------------------------

test('real perplexity-cli: pytest + hypothesis, fileCount >= 200', {
  skip: hasPerplexity ? false : `perplexity-cli not present at ${PERPLEXITY}`,
}, async () => {
  const overview = await surveyOverview(PERPLEXITY);
  const res = await scan(PERPLEXITY, overview);
  const f = res.findings;
  const fw = f.framework.join(' ').toLowerCase();

  assert.ok(fw.includes('pytest'), `framework should include pytest: ${JSON.stringify(f.framework)}`);
  assert.ok(fw.includes('hypothesis'), `framework should include hypothesis: ${JSON.stringify(f.framework)}`);
  assert.ok(f.fileCount >= 200, `fileCount should be >= 200: ${f.fileCount}`);
  assert.ok(
    f.configFiles && f.configFiles.includes('pyproject.toml:[tool.pytest.ini_options]'),
    `configFiles should include the pytest marker: ${JSON.stringify(f.configFiles)}`,
  );
  assert.equal(res.signal, 'high');

  console.log('perplexity-cli testing findings:', JSON.stringify({
    framework: f.framework,
    fileCount: f.fileCount,
    configFiles: f.configFiles,
    coverage: f.coverage,
    naming: f.naming,
  }));
});
