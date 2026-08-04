import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withFixture } from './harness.mjs';
import { scan as scanTesting } from '../lib/scan/deep/testing.mjs';
import { DESCRIPTORS, detectEcosystems, descriptorFor } from '../lib/scan/shared/ecosystem.mjs';

const ECOSYSTEM_IDS = ['python', 'javascript', 'typescript', 'shell', 'rust'];

test('DESCRIPTORS is keyed by exactly the 5 in-scope ecosystem ids', () => {
  assert.deepEqual(
    Object.keys(DESCRIPTORS).sort(),
    [...ECOSYSTEM_IDS].sort(),
  );
});

test('every descriptor has id/label and non-empty core fields', () => {
  for (const id of ECOSYSTEM_IDS) {
    const d = DESCRIPTORS[id];
    assert.ok(d, `missing descriptor for ${id}`);
    assert.equal(d.id, id);
    assert.ok(typeof d.label === 'string' && d.label.length > 0, `${id} label`);
    assert.ok(Array.isArray(d.extensions) && d.extensions.length > 0, `${id} extensions`);
    assert.ok(
      Array.isArray(d.testFileGlobs) && d.testFileGlobs.length > 0,
      `${id} testFileGlobs`,
    );
    assert.ok(
      Array.isArray(d.testFrameworks) === false && Object.keys(d.testFrameworks).length > 0,
      `${id} testFrameworks`,
    );
    assert.ok(Array.isArray(d.linters) && d.linters.length > 0, `${id} linters`);
    assert.ok(Array.isArray(d.formatters) && d.formatters.length > 0, `${id} formatters`);
  }
});

test('frameworks non-empty except shell which may be {}', () => {
  for (const id of ECOSYSTEM_IDS) {
    const frameworks = DESCRIPTORS[id].frameworks;
    if (id === 'shell') {
      assert.deepEqual(frameworks, {});
    } else {
      assert.ok(
        Object.keys(frameworks).length > 0,
        `${id} frameworks should be non-empty`,
      );
    }
  }
});

test('python descriptor frameworks include click, fastapi, django, flask', () => {
  const fw = DESCRIPTORS.python.frameworks;
  for (const k of ['click', 'fastapi', 'django', 'flask']) {
    assert.ok(k in fw, `python frameworks missing ${k}`);
  }
});

test('rust descriptor packageManagers is exactly ["cargo"]', () => {
  assert.deepEqual(DESCRIPTORS.rust.packageManagers, ['cargo']);
});

test('T209 runtimeProbe is removed; descriptors carry static runtimes metadata instead', () => {
  for (const id of ECOSYSTEM_IDS) {
    const descriptor = DESCRIPTORS[id];
    assert.ok(!('runtimeProbe' in descriptor), `${id} must not declare a host runtime probe`);
    assert.ok(
      Array.isArray(descriptor.runtimes) && descriptor.runtimes.length > 0,
      `${id} must declare a static runtimes list`,
    );
    for (const rt of descriptor.runtimes) {
      assert.ok(rt && typeof rt === 'object', `${id} runtime entry must be an object`);
      assert.ok(typeof rt.name === 'string' && rt.name.length > 0, `${id} runtime name`);
    }
  }
});

test('T209 static runtime metadata names match the declared runtimes per ecosystem', () => {
  const names = (id) => DESCRIPTORS[id].runtimes.map((rt) => rt.name);
  assert.deepEqual(names('python'), ['Python']);
  assert.deepEqual(names('rust'), ['Rust']);
  assert.deepEqual(names('shell'), ['Shell']);
  assert.deepEqual(names('javascript'), ['Node.js', 'Bun', 'Deno']);
  assert.deepEqual(names('typescript'), ['Node.js', 'Bun', 'Deno']);
  const py = DESCRIPTORS.python.runtimes[0];
  assert.equal(py.manifestField, 'requiresPython');
  assert.equal(py.versionFiles[0], '.python-version');
  const node = DESCRIPTORS.javascript.runtimes[0];
  assert.equal(node.manifestField, 'nodeVersion');
  assert.deepEqual(node.versionFiles, ['.nvmrc', '.node-version']);
  const rust = DESCRIPTORS.rust.runtimes[0];
  assert.equal(rust.manifestField, 'rustVersion');
  assert.deepEqual(rust.versionFiles, ['rust-toolchain', 'rust-toolchain.toml']);
});

test('hookFiles is the shared set in every descriptor', () => {
  const expected = ['lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml', '.husky'];
  for (const id of ECOSYSTEM_IDS) {
    assert.deepEqual(DESCRIPTORS[id].hookFiles, expected, `${id} hookFiles`);
  }
});

test('importSyntax fields are RegExes', () => {
  for (const id of ECOSYSTEM_IDS) {
    const syn = DESCRIPTORS[id].importSyntax;
    assert.ok(syn && typeof syn === 'object', `${id} importSyntax missing`);
    for (const [k, v] of Object.entries(syn)) {
      assert.ok(v instanceof RegExp, `${id} importSyntax.${k} not a RegExp`);
    }
  }
});

test('exportsSyntax fields are RegExes', () => {
  for (const id of ECOSYSTEM_IDS) {
    const syn = DESCRIPTORS[id].exportsSyntax;
    assert.ok(syn && typeof syn === 'object', `${id} exportsSyntax missing`);
    for (const [k, v] of Object.entries(syn)) {
      assert.ok(v instanceof RegExp, `${id} exportsSyntax.${k} not a RegExp`);
    }
  }
});

test('detectEcosystems uses manifest.ecosystems when present', () => {
  const result = detectEcosystems(
    { languages: ['Python', 'Markdown'], languageScores: { Python: 50, Markdown: 3 } },
    { ecosystems: ['python'] },
  );
  assert.equal(result.primary, 'python');
  assert.ok(result.all.includes('python'));
});

test('detectEcosystems infers from languages when manifest has no ecosystems', () => {
  const result = detectEcosystems(
    { languages: ['TypeScript'], languageScores: { TypeScript: 20 } },
    {},
  );
  assert.equal(result.primary, 'typescript');
  assert.deepEqual(result.all, ['typescript']);
});

test('detectEcosystems ranks multiple inferred ecosystems by score desc', () => {
  const result = detectEcosystems(
    {
      languages: ['Python', 'TypeScript', 'Shell'],
      languageScores: { Python: 10, TypeScript: 80, Shell: 5 },
    },
    {},
  );
  assert.equal(result.primary, 'typescript');
  assert.deepEqual(result.all, ['typescript', 'python', 'shell']);
});

test('detectEcosystems returns primary:null on empty input without throwing', () => {
  const result = detectEcosystems({}, {});
  assert.equal(result.primary, null);
  assert.deepEqual(result.all, []);

  assert.doesNotThrow(() => detectEcosystems(null, null));
  assert.doesNotThrow(() => detectEcosystems(undefined, undefined));
});

test('detectEcosystems ignores non-ecosystem languages like Markdown', () => {
  const result = detectEcosystems(
    { languages: ['Markdown', 'Python'], languageScores: { Markdown: 99, Python: 1 } },
    {},
  );
  assert.deepEqual(result.all, ['python']);
});

test('descriptorFor returns the descriptor or null', () => {
  const rust = descriptorFor('rust');
  assert.ok(rust);
  assert.ok(rust.importSyntax.crate instanceof RegExp, 'rust importSyntax.crate must be RegExp');
  for (const id of ECOSYSTEM_IDS) {
    assert.ok(descriptorFor(id), `descriptorFor(${id}) should be truthy`);
  }
  assert.equal(descriptorFor('go'), null);
  assert.equal(descriptorFor(''), null);
  assert.equal(descriptorFor(undefined), null);
});

test('linters/formatters/typeCheckers specs all carry a string name', () => {
  for (const id of ECOSYSTEM_IDS) {
    for (const spec of DESCRIPTORS[id].linters) {
      assert.equal(typeof spec.name, 'string');
      assert.ok(Array.isArray(spec.files));
    }
    for (const spec of DESCRIPTORS[id].formatters) {
      assert.equal(typeof spec.name, 'string');
      assert.ok(Array.isArray(spec.files));
    }
    for (const spec of DESCRIPTORS[id].typeCheckers) {
      assert.equal(typeof spec.name, 'string');
      assert.ok(Array.isArray(spec.files));
    }
  }
});

// ---------------------------------------------------------------------------
// T101 language-parity breadth additions + P0 fixes
// ---------------------------------------------------------------------------

test('T101 P0-7: rust formatters reference no Cargo.toml (rustfmt false-positive removed)', () => {
  for (const spec of DESCRIPTORS.rust.formatters) {
    for (const f of spec.files) {
      assert.ok(
        !f.includes('Cargo.toml'),
        `rust formatter ${spec.name} still references Cargo.toml: ${JSON.stringify(spec.files)}`,
      );
    }
  }
  const rustfmt = DESCRIPTORS.rust.formatters.find((s) => s.name === 'rustfmt');
  assert.ok(rustfmt, 'rustfmt formatter present');
  assert.deepEqual([...rustfmt.files].sort(), ['.rustfmt.toml', 'rustfmt.toml']);
});

test('T101 P0-11: shell testFrameworks has no shellcheck; shellspec/shunit2 added; shellcheck stays linter+typeChecker', () => {
  assert.ok(
    !('shellcheck' in DESCRIPTORS.shell.testFrameworks),
    'shellcheck must not be a test framework',
  );
  for (const k of ['bats', 'shellspec', 'shunit2']) {
    assert.ok(k in DESCRIPTORS.shell.testFrameworks, `shell testFrameworks missing ${k}`);
  }
  assert.ok(DESCRIPTORS.shell.linters.some((s) => s.name === 'shellcheck'));
  assert.ok(DESCRIPTORS.shell.typeCheckers.some((s) => s.name === 'shellcheck'));
  // P0-13: dead beautysh formatter removed.
  assert.ok(
    !DESCRIPTORS.shell.formatters.some((s) => s.name === 'beautysh'),
    'dead beautysh formatter should be removed',
  );
});

test('T101 P0-17: javascript testFrameworks includes node:test marker (spreads into typescript)', () => {
  assert.ok(
    'node:test' in DESCRIPTORS.javascript.testFrameworks,
    'node:test marker missing from javascript',
  );
  assert.ok(
    'node:test' in DESCRIPTORS.typescript.testFrameworks,
    'node:test should spread into typescript via ...JAVASCRIPT.testFrameworks',
  );
});

test('T101 P0: rust importSyntax has self and super RegExps matching use self::/use super::', () => {
  const syn = DESCRIPTORS.rust.importSyntax;
  assert.ok(syn.self instanceof RegExp, 'rust importSyntax.self must be a RegExp');
  assert.ok(syn.super instanceof RegExp, 'rust importSyntax.super must be a RegExp');
  assert.ok(syn.self.test('    use self::foo::bar;'), 'self regex should match `use self::...`');
  assert.ok(syn.super.test('    use super::baz;'), 'super regex should match `use super::...`');
  assert.ok(!syn.self.test('    use crate::x;'), 'self regex must not match crate::');
});

test('T101 P0: typescript linters has no tsc (dedup with typeCheckers); tsc stays a typeChecker', () => {
  const names = DESCRIPTORS.typescript.linters.map((s) => s.name);
  assert.ok(!names.includes('tsc'), `tsc must not be a linter: ${JSON.stringify(names)}`);
  assert.ok(
    DESCRIPTORS.typescript.typeCheckers.some((s) => s.name === 'tsc'),
    'tsc must remain a typeChecker',
  );
});

test('T101: python markers include py.typed; markers is a string array on every descriptor', () => {
  assert.ok(
    Array.isArray(DESCRIPTORS.python.markers) && DESCRIPTORS.python.markers.includes('py.typed'),
    'python markers must include py.typed',
  );
  for (const id of ECOSYSTEM_IDS) {
    const m = DESCRIPTORS[id].markers;
    assert.ok(Array.isArray(m), `${id} markers must be an array`);
    for (const x of m) assert.equal(typeof x, 'string', `${id} markers must contain only strings`);
  }
});

test('T101: cross-ecosystem lockfile breadth (pdm.lock python; bun.lock js/ts)', () => {
  assert.ok(DESCRIPTORS.python.lockfiles.includes('pdm.lock'), 'python lockfiles must include pdm.lock');
  assert.ok(DESCRIPTORS.javascript.lockfiles.includes('bun.lock'), 'javascript lockfiles must include bun.lock');
  assert.ok(DESCRIPTORS.typescript.lockfiles.includes('bun.lock'), 'typescript lockfiles must include bun.lock');
});

test('T101: breadth spot-checks across ecosystems', () => {
  const pyLinters = DESCRIPTORS.python.linters.map((s) => s.name);
  for (const n of ['semgrep', 'pydocstyle', 'prospector', 'dlint']) {
    assert.ok(pyLinters.includes(n), `python linters missing ${n}`);
  }
  const pyFormatters = DESCRIPTORS.python.formatters.map((s) => s.name);
  for (const n of ['autopep8', 'yapf', 'blue', 'flynt']) {
    assert.ok(pyFormatters.includes(n), `python formatters missing ${n}`);
  }
  assert.ok(
    DESCRIPTORS.python.formatters.find((s) => s.name === 'ruff-format').files.includes('.ruff.toml'),
    'ruff-format files must include .ruff.toml',
  );
  const pyTc = DESCRIPTORS.python.typeCheckers.map((s) => s.name);
  for (const n of ['pytype', 'pyre-check', 'pyrefly']) {
    assert.ok(pyTc.includes(n), `python typeCheckers missing ${n}`);
  }
  for (const k of ['pytest-asyncio', 'pytest-xdist', 'pytest-mock', 'behave', 'robotframework']) {
    assert.ok(k in DESCRIPTORS.python.testFrameworks, `python testFrameworks missing ${k}`);
  }

  const jsLinters = DESCRIPTORS.javascript.linters.map((s) => s.name);
  for (const n of ['standard', 'jshint', 'oxlint']) {
    assert.ok(jsLinters.includes(n), `javascript linters missing ${n}`);
  }
  assert.ok(
    DESCRIPTORS.javascript.formatters.some((s) => s.name === 'dprint'),
    'javascript formatters missing dprint',
  );
  // P0-18: JS eslint now accepts .ts/.mts/.cts flat configs.
  const jsEslint = DESCRIPTORS.javascript.linters.find((s) => s.name === 'eslint');
  for (const f of ['eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts']) {
    assert.ok(jsEslint.files.includes(f), `JS eslint files missing ${f}`);
  }
  for (const k of ['tap', 'tape', 'uvu', 'jasmine']) {
    assert.ok(k in DESCRIPTORS.javascript.testFrameworks, `javascript testFrameworks missing ${k}`);
  }

  // TS distinct marker + breadth.
  assert.ok(
    DESCRIPTORS.typescript.linters.some((s) => s.name === '@typescript-eslint'),
    'typescript linters missing @typescript-eslint',
  );
  for (const k of ['ts-jest', '@swc/jest', 'ts-node', 'tsx', '@types/jest']) {
    assert.ok(k in DESCRIPTORS.typescript.testFrameworks, `typescript testFrameworks missing ${k}`);
  }

  // Shell + Rust breadth.
  assert.ok(
    DESCRIPTORS.shell.linters.some((s) => s.name === 'bashate'),
    'shell linters missing bashate',
  );
  const rustTf = Object.keys(DESCRIPTORS.rust.testFrameworks);
  for (const k of ['proptest', 'quickcheck', 'trybuild', 'rstest', 'criterion', 'mockall', 'insta']) {
    assert.ok(rustTf.includes(k), `rust testFrameworks missing ${k}`);
  }
  assert.ok(
    DESCRIPTORS.rust.typeCheckers.some((s) => s.name === 'rustc'),
    'rust typeCheckers must include rustc',
  );
});

// ---------------------------------------------------------------------------
// T007 b14: python test-file universe is tightened to real test modules; the
// other ecosystems' globs stay untouched.
// ---------------------------------------------------------------------------

test('T007 b14: python testFileGlobs are the disclosed real-module universe', () => {
  assert.deepEqual(DESCRIPTORS.python.testFileGlobs, [
    'tests/test_*.py',
    'tests/**/test_*.py',
    'conftest.py',
  ]);
});

test('T007 b14: non-python testFileGlobs are unchanged', () => {
  assert.deepEqual(DESCRIPTORS.javascript.testFileGlobs, ['**/*.test.{js,mjs,cjs,jsx}', '**/*.spec.{js,mjs,cjs,jsx}']);
  assert.deepEqual(DESCRIPTORS.typescript.testFileGlobs, ['**/*.{test,spec}.{ts,tsx,mts,cts}']);
  assert.deepEqual(DESCRIPTORS.shell.testFileGlobs, ['*.bats', 'tests/**/*.bats']);
  assert.deepEqual(DESCRIPTORS.rust.testFileGlobs, ['*_test.rs', 'tests/**/*.rs']);
});

test('T007 b14: fixture counting excludes scripts/smoke_test.py and tests/support/** via the descriptor globs', async () => {
  const files = {
    'pyproject.toml': '[project]\nname = "pydesc"\nversion = "0.1.0"\n',
    'tests/test_core.py': 'def test_core():\n    assert True\n',
    'tests/support/helper.py': 'def helper():\n    return 1\n',
    'scripts/smoke_test.py': 'def smoke():\n    return 1\n',
  };

  await withFixture('eco-t007-b14', files, async (dir) => {
    const res = await scanTesting(dir);
    assert.equal(res.findings.fileCount, 1, `fileCount must count only real test modules: ${res.findings.fileCount}`);
    assert.ok(
      res.findings.sampleFiles.some((p) => p.endsWith('test_core.py')),
      `sampleFiles must include test_core.py: ${JSON.stringify(res.findings.sampleFiles)}`,
    );
    assert.ok(
      !res.findings.sampleFiles.some((p) => p.includes('/support/')),
      `tests/support/** must be excluded: ${JSON.stringify(res.findings.sampleFiles)}`,
    );
    assert.ok(
      !res.findings.sampleFiles.some((p) => p.endsWith('smoke_test.py')),
      `scripts/smoke_test.py must be excluded: ${JSON.stringify(res.findings.sampleFiles)}`,
    );
  });
});
