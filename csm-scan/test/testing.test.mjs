import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFixture, surveyOverview } from './harness.mjs';
import { resolveRealRepo, isPerplexityCli, FALLBACK_TEST_FILE_COUNT } from './helpers/real-repo.mjs';
import { files as crlfBomFiles } from './fixtures/crlf-bom.mjs';
import { scan } from '../lib/scan/deep/testing.mjs';
import { renderTesting } from '../lib/scan/render/testing.mjs';

// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture (pytest in [dependency-groups].dev, hypothesis
// alongside it, conftest.py + tests/test_*.py counted by the b14 rule).
const RESOLVED_REAL_REPO = resolveRealRepo();
const PERPLEXITY = RESOLVED_REAL_REPO.repo;

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
      f.naming.includes('tests/test_*.py'),
      `naming should include the matched glob 'tests/test_*.py': ${JSON.stringify(f.naming)}`,
    );
    assert.ok(
      f.configFiles && f.configFiles.includes('pyproject.toml:[tool.pytest.ini_options]'),
      `configFiles should include the pyproject pytest marker: ${JSON.stringify(f.configFiles)}`,
    );
    assert.ok(
      f.coverage && f.coverage.includes('pytest-cov'),
      `coverage should include pytest-cov: ${JSON.stringify(f.coverage)}`,
    );
    assert.ok(
      f.coverage && !f.coverage.some((entry) => entry.includes('fail_under')),
      `no threshold facts when no gate is declared: ${JSON.stringify(f.coverage)}`,
    );
    assert.equal(f.script, null, 'python repo has no package.json test script');
    assert.equal(res.signal, 'high');
  });
});

// ---------------------------------------------------------------------------
// T007 b14: python test-file universe. The globs (tests/test_*.py,
// tests/**/test_*.py, conftest.py) plus match-time exclusions must count real
// test modules only: scripts/smoke_test.py (a *_test.py outside a test dir),
// tests/fixtures/**, tests/support/**, harnesses and __init__.py are excluded.
// ---------------------------------------------------------------------------

test('T007 b14: python real-module counting excludes fixtures, support and scripts/smoke_test.py', async () => {
  const files = {
    'pyproject.toml': [
      '[project]',
      'name = "pyuniverse"',
      'version = "0.1.0"',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=7.0"]',
      '',
    ].join('\n'),
    'tests/test_core.py': 'def test_core():\n    assert True\n',
    'tests/test_aux.py': 'def test_aux():\n    assert True\n',
    'tests/fixtures/test_fixture.py': 'def test_fixture():\n    assert True\n',
    'tests/fixtures/sample.py': 'SAMPLE = 1\n',
    'tests/support/helper.py': 'def helper():\n    return 1\n',
    'tests/_fuzz_harnesses.py': 'def harness():\n    return 1\n',
    'tests/strategies.py': 'def strategy():\n    return 1\n',
    'tests/__init__.py': '',
    'scripts/smoke_test.py': 'def smoke():\n    return 1\n',
  };

  await withFixture('testing-t007-universe', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.equal(f.fileCount, 2, `fileCount must count only real test modules: ${f.fileCount}`);
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('test_core.py')),
      `test_core.py must be counted: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      f.sampleFiles.some((p) => p.endsWith('test_aux.py')),
      `test_aux.py must be counted: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.endsWith('smoke_test.py')),
      `scripts/smoke_test.py must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.includes('/fixtures/')),
      `tests/fixtures/** must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.includes('/support/')),
      `tests/support/** must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.endsWith('_fuzz_harnesses.py')),
      `_fuzz_harnesses.py must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.endsWith('strategies.py')),
      `strategies.py must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.ok(
      !f.sampleFiles.some((p) => p.endsWith('__init__.py')),
      `__init__.py must be excluded: ${JSON.stringify(f.sampleFiles)}`,
    );
    assert.equal(res.signal, 'high');
  });
});

// ---------------------------------------------------------------------------
// T007 a11: fail-closed network guard at tests/support/network_guard.py is
// detected as a testing fact (socket + curl_cffi interception, loopback-only,
// env scrubbing, real_api bypass marker).
// ---------------------------------------------------------------------------

test('T007 a11: network guard fact detected from tests/support/network_guard.py', async () => {
  const files = {
    'pyproject.toml': [
      '[project]',
      'name = "pyguard"',
      'version = "0.1.0"',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=7.0"]',
      '',
    ].join('\n'),
    'tests/test_core.py': 'def test_core():\n    assert True\n',
    'tests/support/network_guard.py': [
      '"""Fail-closed network isolation for non-live lanes."""',
      'import socket',
      'import curl_cffi',
      '',
      '_LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "::1"})',
      '',
      'def is_loopback_host(host):',
      '    return host in _LOOPBACK_NAMES',
      '',
      'class _GuardedSocket(socket.socket):',
      '    def connect(self, address):',
      '        if not is_loopback_host(address[0]):',
      '            raise OSError("loopback-only test isolation is active")',
      '        return super().connect(address)',
      '',
      'def _install_guard():',
      '    for var in list(os.environ):',
      '        if var in _SENSITIVE_VARS:',
      '            _state.saved_env[var] = os.environ.pop(var)',
      '    socket.socket = _GuardedSocket',
      '',
      '_REAL_API_VAR = "RUN_REAL_API_TESTS"',
      '',
    ].join('\n'),
  };

  await withFixture('testing-t007-guard', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.ok(
      typeof f.networkGuard === 'string' && f.networkGuard.includes('socket interception'),
      `networkGuard must mention socket interception: ${JSON.stringify(f.networkGuard)}`,
    );
    assert.ok(
      typeof f.networkGuard === 'string' && f.networkGuard.includes('curl_cffi interception'),
      `networkGuard must mention curl_cffi interception: ${JSON.stringify(f.networkGuard)}`,
    );
    assert.ok(
      typeof f.networkGuard === 'string' && f.networkGuard.includes('loopback-only'),
      `networkGuard must mention loopback-only: ${JSON.stringify(f.networkGuard)}`,
    );
    assert.ok(
      typeof f.networkGuard === 'string' && f.networkGuard.includes('env scrub'),
      `networkGuard must mention env scrub: ${JSON.stringify(f.networkGuard)}`,
    );
    assert.ok(
      typeof f.networkGuard === 'string' && f.networkGuard.includes('real_api bypass'),
      `networkGuard must mention real_api bypass: ${JSON.stringify(f.networkGuard)}`,
    );
    const markdown = renderTesting('repo', f);
    assert.match(markdown, /- \*\*Network guard\*\*: loopback-only fail-closed guard/);
  });
});

test('T007 a11: repos without a network guard keep the fact absent', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "pyplain"\nversion = "0.1.0"\n',
    'tests/test_core.py': 'def test_core():\n    assert True\n',
  };

  await withFixture('testing-t007-no-guard', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.equal(
      Object.prototype.hasOwnProperty.call(f, 'networkGuard'),
      false,
      `networkGuard fact must be conditional-absent: ${JSON.stringify(Object.keys(f))}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T007 a10/d4: policy/quality/architecture suites are classified as meta-tests.
// ---------------------------------------------------------------------------

test('T007 a10/d4: meta-test classification from policy/quality test naming', async () => {
  const files = {
    'pyproject.toml': [
      '[project]',
      'name = "pymeta"',
      'version = "0.1.0"',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest>=7.0"]',
      '',
    ].join('\n'),
    'tests/test_quality_gates.py': 'def test_gate():\n    assert True\n',
    'tests/test_workflow_policy.py': 'def test_policy():\n    assert True\n',
    'tests/test_architecture.py': 'def test_arch():\n    assert True\n',
    'tests/test_cyclomatic_complexity.py': 'def test_complexity():\n    assert True\n',
    'tests/test_core.py': 'def test_core():\n    assert True\n',
  };

  await withFixture('testing-t007-meta', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.ok(f.metaTests, `metaTests fact must be present: ${JSON.stringify(f)}`);
    assert.equal(f.metaTests.count, 4, `meta-test count must be 4: ${JSON.stringify(f.metaTests)}`);
    assert.ok(
      f.metaTests.naming.includes('test_quality_*.py'),
      `meta-test naming must include test_quality_*.py: ${JSON.stringify(f.metaTests.naming)}`,
    );
    assert.ok(
      f.metaTests.naming.includes('test_workflow_policy.py'),
      `meta-test naming must include test_workflow_policy.py: ${JSON.stringify(f.metaTests.naming)}`,
    );
    assert.ok(
      f.metaTests.naming.includes('test_architecture.py'),
      `meta-test naming must include test_architecture.py: ${JSON.stringify(f.metaTests.naming)}`,
    );
    assert.ok(
      f.metaTests.naming.includes('test_cyclomatic_complexity.py'),
      `meta-test naming must include test_cyclomatic_complexity.py: ${JSON.stringify(f.metaTests.naming)}`,
    );
    const markdown = renderTesting('repo', f);
    assert.match(markdown, /- \*\*Meta-tests\*\*: 4 file\(s\)/);
  });
});

test('T007 a10/d4: repos without meta-test naming keep the fact absent', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "pymeta2"\nversion = "0.1.0"\n',
    'tests/test_core.py': 'def test_core():\n    assert True\n',
  };

  await withFixture('testing-t007-no-meta', files, async (dir) => {
    const res = await scan(dir);
    const f = res.findings;
    assert.equal(
      Object.prototype.hasOwnProperty.call(f, 'metaTests'),
      false,
      `metaTests fact must be conditional-absent: ${JSON.stringify(Object.keys(f))}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T007 b14: the counting rule is disclosed in the rendered Testing section.
// ---------------------------------------------------------------------------

test('T007 b14: python counting rule is disclosed in the renderer', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "pyrule"\nversion = "0.1.0"\n',
    'tests/test_core.py': 'def test_core():\n    assert True\n',
  };

  await withFixture('testing-t007-rule', files, async (dir) => {
    const res = await scan(dir);
    const markdown = renderTesting('repo', res.findings);
    assert.match(
      markdown,
      /- \*\*Test file universe\*\*: tests\/test_\*\.py \+ tests\/\*\*\/test_\*\.py \+ conftest\.py, excluding/,
      markdown,
    );
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
// T009: coverage-threshold facts. `fail_under` from [tool.coverage.report],
// diff-cover thresholds from [tool.diff_cover] / DIFF_COVERAGE_THRESHOLD.
// Facts are emitted only when a gate is declared; unparseable values degrade
// to `fail_under=unverified`; repos without a gate keep their existing
// detection facts unchanged.
// ---------------------------------------------------------------------------

const COV_GATE_BASE = {
  'pyproject.toml': [
    '[project]',
    'name = "covgate"',
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
};

test('T009 coverage fail_under from [tool.coverage.report] is a fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    'pyproject.toml': COV_GATE_BASE['pyproject.toml'] + [
      '[tool.coverage]',
      'xml_output = "coverage.xml"',
      '',
      '[tool.coverage.report]',
      'fail_under = 80',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-cov-under', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov, `coverage should be non-null: ${JSON.stringify(cov)}`);
    assert.ok(cov.includes('coverage fail_under=80'), `threshold fact missing: ${JSON.stringify(cov)}`);
    assert.ok(cov.includes('pytest-cov'), `existing detection facts must remain: ${JSON.stringify(cov)}`);
    assert.ok(
      cov.includes('pyproject.toml:[tool.coverage]'),
      `coverage config fact must remain: ${JSON.stringify(cov)}`,
    );
  });
});

test('T009 fractional fail_under from [tool.coverage.report] is preserved', async () => {
  const files = {
    ...COV_GATE_BASE,
    'pyproject.toml': COV_GATE_BASE['pyproject.toml'] + [
      '[tool.coverage]',
      '',
      '[tool.coverage.report]',
      'fail_under = 90.5',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-cov-float', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('coverage fail_under=90.5'), `float threshold missing: ${JSON.stringify(cov)}`);
  });
});

test('T009 diff-cover fail_under from [tool.diff_cover] is a fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    'pyproject.toml': COV_GATE_BASE['pyproject.toml'] + [
      '[tool.diff_cover]',
      'fail_under = 75',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-diff-cover', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=75'), `diff-cover threshold missing: ${JSON.stringify(cov)}`);
  });
});

test('T009 DIFF_COVERAGE_THRESHOLD from a workflow env block is a fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  coverage:',
      '    env:',
      '      DIFF_COVERAGE_THRESHOLD: 85',
      '    steps:',
      '      - run: diff-cover coverage.xml',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-diff-env-wf', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=85'), `workflow threshold missing: ${JSON.stringify(cov)}`);
  });
});

test('T009 DIFF_COVERAGE_THRESHOLD from a Makefile is a fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    'Makefile': [
      'check:',
      '\tdiff-cover coverage.xml',
      '',
      'DIFF_COVERAGE_THRESHOLD = 70',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-diff-env-make', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=70'), `Makefile threshold missing: ${JSON.stringify(cov)}`);
  });
});

test('T009 coverage tooling without a declared gate emits no threshold fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    'pyproject.toml': COV_GATE_BASE['pyproject.toml'] + [
      '[tool.coverage]',
      'xml_output = "coverage.xml"',
      '',
      '[tool.coverage.report]',
      'show_missing = true',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-no-gate', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov, `coverage should be non-null: ${JSON.stringify(cov)}`);
    assert.ok(cov.includes('pyproject.toml:[tool.coverage]'), `coverage config fact missing: ${JSON.stringify(cov)}`);
    assert.ok(
      !cov.some((entry) => entry.includes('fail_under')),
      `no threshold facts without a gate: ${JSON.stringify(cov)}`,
    );
  });
});

test('T009 unparseable fail_under degrades to unverified', async () => {
  const files = {
    ...COV_GATE_BASE,
    'pyproject.toml': COV_GATE_BASE['pyproject.toml'] + [
      '[tool.coverage]',
      '',
      '[tool.coverage.report]',
      'fail_under = "strict"',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-unverified', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(
      cov && cov.includes('coverage fail_under=unverified'),
      `unparseable threshold should be unverified: ${JSON.stringify(cov)}`,
    );
    assert.ok(cov.includes('pyproject.toml:[tool.coverage]'), `coverage config fact must remain: ${JSON.stringify(cov)}`);
  });
});

test('T009 non-numeric DIFF_COVERAGE_THRESHOLD degrades to unverified', async () => {
  const files = {
    ...COV_GATE_BASE,
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  coverage:',
      '    env:',
      '      DIFF_COVERAGE_THRESHOLD: ${{ secrets.COV_MIN }}',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-diff-env-unverified', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(
      cov && cov.includes('diff-cover fail_under=unverified'),
      `non-numeric workflow threshold should be unverified: ${JSON.stringify(cov)}`,
    );
  });
});

test('T009 non-python repos are not scanned for python threshold gates', async () => {
  const files = {
    'package.json': JSON.stringify({
      name: 'jsgates',
      version: '1.0.0',
      devDependencies: { jest: '^29.0.0' },
    }, null, 2),
    'src/add.test.js': "import { test } from 'node:test';\ntest('x', () => {});\n",
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  coverage:',
      '    env:',
      '      DIFF_COVERAGE_THRESHOLD: 60',
      '',
    ].join('\n'),
  };
  await withFixture('testing-t009-js-gate', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(
      cov === null || !cov.some((entry) => entry.includes('fail_under')),
      `non-python repo must not emit python gate facts: ${JSON.stringify(cov)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T005: DIFF_COVERAGE_THRESHOLD from quality/gates.conf. A numeric declaration
// in the locked gates file resolves the diff-cover gate instead of the bare-use
// `unverified` placeholder a Makefile produces from `$(DIFF_COVERAGE_THRESHOLD)`.
// ---------------------------------------------------------------------------

test('T005 DIFF_COVERAGE_THRESHOLD from quality/gates.conf resolves the diff-cover gate', async () => {
  const files = {
    ...COV_GATE_BASE,
    'Makefile': [
      'check:',
      '\tdiff-cover coverage.xml --fail-under=$(DIFF_COVERAGE_THRESHOLD)',
      '',
    ].join('\n'),
    'quality/gates.conf': 'DIFF_COVERAGE_THRESHOLD = 90\n',
  };
  await withFixture('testing-t005-gates-conf', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=90'), `gates.conf threshold missing: ${JSON.stringify(cov)}`);
    assert.ok(
      !cov.some((entry) => entry.includes('unverified')),
      `bare-use unverified placeholder must be superseded: ${JSON.stringify(cov)}`,
    );
  });
});

test('T005 DIFF_COVERAGE_THRESHOLD declared only in quality/gates.conf is a fact', async () => {
  const files = {
    ...COV_GATE_BASE,
    'quality/gates.conf': 'DIFF_COVERAGE_THRESHOLD = 90\n',
  };
  await withFixture('testing-t005-gates-only', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=90'), `gates-only threshold missing: ${JSON.stringify(cov)}`);
  });
});

test('T005 non-numeric DIFF_COVERAGE_THRESHOLD in gates.conf degrades to unverified', async () => {
  const files = {
    ...COV_GATE_BASE,
    'quality/gates.conf': 'DIFF_COVERAGE_THRESHOLD = $(COV_MIN)\n',
  };
  await withFixture('testing-t005-gates-unverified', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(
      cov && cov.includes('diff-cover fail_under=unverified'),
      `non-numeric gates.conf threshold should be unverified: ${JSON.stringify(cov)}`,
    );
  });
});

test('T005 DIFF_COVERAGE_THRESHOLD from a Makefile still resolves without gates.conf', async () => {
  const files = {
    ...COV_GATE_BASE,
    'Makefile': 'DIFF_COVERAGE_THRESHOLD = 70\n',
  };
  await withFixture('testing-t005-make-only', files, async (dir) => {
    const res = await scan(dir);
    const cov = res.findings.coverage;
    assert.ok(cov && cov.includes('diff-cover fail_under=70'), `Makefile threshold missing: ${JSON.stringify(cov)}`);
  });
});

// ---------------------------------------------------------------------------
// T005: declared pytest marker taxonomy. `[tool.pytest.ini_options] markers`
// is parsed into a conditional-absent `markers` fact; the renderer shows a
// marker-taxonomy line only when the fact is present.
// ---------------------------------------------------------------------------

const MARKER_GATE_BASE = {
  ...COV_GATE_BASE,
  'pyproject.toml': COV_GATE_BASE['pyproject.toml'].replace(
    'testpaths = ["tests"]',
    [
      'testpaths = ["tests"]',
      'markers = [',
      '    "hermetic_integration: marks tests as hermetic integration tests",',
      '    "integration: marks tests that exercise real integration paths",',
      '    "slow: marks tests as slow-running",',
      ']',
    ].join('\n'),
  ),
};

test('T005 pytest markers are parsed into a markers fact and render a taxonomy line', async () => {
  await withFixture('testing-t005-markers', MARKER_GATE_BASE, async (dir) => {
    const res = await scan(dir);
    assert.deepEqual(res.findings.markers, ['hermetic_integration', 'integration', 'slow']);
    const markdown = renderTesting('repo', res.findings);
    assert.match(
      markdown,
      /- \*\*Marker taxonomy\*\*: 3 markers \(`hermetic_integration`, `integration`, `slow`\)/,
      markdown,
    );
  });
});

test('T005 marker entries without a description still yield a name', async () => {
  const files = {
    ...MARKER_GATE_BASE,
    'pyproject.toml': MARKER_GATE_BASE['pyproject.toml'].replace(
      '"slow: marks tests as slow-running",',
      '"slow",',
    ),
  };
  await withFixture('testing-t005-marker-bare', files, async (dir) => {
    const res = await scan(dir);
    assert.deepEqual(res.findings.markers, ['hermetic_integration', 'integration', 'slow']);
  });
});

test('T005 repos without a markers key keep the markers fact absent', async () => {
  await withFixture('testing-t005-no-markers', COV_GATE_BASE, async (dir) => {
    const res = await scan(dir);
    assert.equal(
      Object.prototype.hasOwnProperty.call(res.findings, 'markers'),
      false,
      `markers fact must be conditional-absent: ${JSON.stringify(Object.keys(res.findings))}`,
    );
    const markdown = renderTesting('repo', res.findings);
    assert.doesNotMatch(markdown, /Marker taxonomy/, markdown);
  });
});

// ---------------------------------------------------------------------------
// Real repo: perplexity-cli. pytest in optional-dependencies, hypothesis in
// [dependency-groups] (parsed here directly), >=200 matched test files.
// ---------------------------------------------------------------------------

test('real perplexity-cli: pytest + hypothesis, fileCount matches the b14 counting rule', async (t) => {
  if (PERPLEXITY === null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${RESOLVED_REAL_REPO.missing}`);
    return;
  }
  const overview = await surveyOverview(PERPLEXITY);
  const res = await scan(PERPLEXITY, overview);
  const f = res.findings;
  const fw = f.framework.join(' ').toLowerCase();

  assert.ok(fw.includes('pytest'), `framework should include pytest: ${JSON.stringify(f.framework)}`);
  assert.ok(fw.includes('hypothesis'), `framework should include hypothesis: ${JSON.stringify(f.framework)}`);
  // T007 b14 counting rule: python test files are tests/test_*.py +
  // tests/**/test_*.py + conftest.py, with fixtures/support/harness files
  // excluded. The real repo reports 146 test modules + conftest = 147; the
  // fallback fixture reports 3 test modules + conftest = 4.
  if (isPerplexityCli(PERPLEXITY)) {
    assert.ok(f.fileCount >= 130 && f.fileCount <= 170, `fileCount should match the b14 counting rule: ${f.fileCount}`);
  } else {
    assert.equal(f.fileCount, FALLBACK_TEST_FILE_COUNT, `fallback fixture fileCount should match the b14 counting rule: ${f.fileCount}`);
  }
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

// Adversarial fixture (T010 gap FIX 2): a CRLF + UTF-8 BOM test file must
// still be counted honestly — the encoding never hides the module.
test('testing: CRLF + BOM source files keep test-file counting honest', async () => {
  await withFixture('testing-crlfbom', crlfBomFiles, async (dir) => {
    const overview = await surveyOverview(dir);
    const res = await scan(dir, overview);
    const f = res.findings;

    assert.equal(f.fileCount, 1, `the BOM+CRLF test module must be counted: ${f.fileCount}`);
    assert.deepEqual(f.sampleFiles, ['test/app.test.js']);
    assert.deepEqual(f.testDirs, ['test']);
  });
});
