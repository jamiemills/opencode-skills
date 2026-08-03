import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';

import { withFixture } from './harness.mjs';
import { scan } from '../lib/scan/deep/config.mjs';

const REAL_REPO = '/home/jamiemills/code/projects/perplexity-cli';

// ---------------------------------------------------------------------------
// Python fixture
// ---------------------------------------------------------------------------

const PYPROJECT = `\
[project]
name = "demo-py"
version = "0.1.0"

[tool.ruff]
line-length = 100

[tool.ruff.format]
docstring-code-format = true

[tool.pyright]
include = ["src/"]
typeCheckingMode = "strict"

[tool.bandit]
exclude_dirs = ["tests"]
`;

const LEFTHOOK = `\
pre-commit:
  commands:
    ruff-check:
      run: ruff check
    ruff-format:
      run: ruff format
`;

test('config scan: python fixture detects ruff linter/formatter, pyright typechecker, lefthook hook', async () => {
  await withFixture(
    'config-py',
    {
      'pyproject.toml': PYPROJECT,
      'lefthook.yml': LEFTHOOK,
      'src/demo/__init__.py': '',
    },
    async (dir) => {
      const res = await scan(dir);
      const f = res.findings;

      assert.equal(res.dimension, 'config');
      assert.equal(res.signal, 'high');

      const linterNames = f.linters.map((l) => l.name);
      assert.ok(linterNames.includes('ruff'), `linters should include ruff: ${JSON.stringify(linterNames)}`);
      // ruff's config reference should point at pyproject.toml (the [tool.ruff] section).
      const ruff = f.linters.find((l) => l.name === 'ruff');
      assert.ok(ruff.config.includes('pyproject.toml'), `ruff config ref: ${ruff.config}`);

      // format summary is a comma-joined names string and must include ruff (ruff-format).
      assert.ok(typeof f.format === 'string', 'format should be a string');
      assert.ok(
        f.format.includes('ruff') || f.format.includes('black'),
        `format should include ruff or black: ${f.format}`,
      );

      // typeCheckers carry pyright (parallel to the TS typescript finding).
      const tcNames = f.typeCheckers.map((t) => t.name);
      assert.ok(tcNames.includes('pyright'), `typeCheckers should include pyright: ${JSON.stringify(tcNames)}`);

      // Python ecosystem must NOT populate the TS-only `typescript` summary.
      assert.equal(f.typescript, null);

      // lint summary derives from the primary (first detected) linter.
      assert.ok(f.lint, 'lint summary should be present');
      assert.ok(f.lint.config.includes('ruff'), `lint.config: ${f.lint.config}`);
      assert.ok(['flat', 'legacy', 'multi'].includes(f.lint.style), `lint.style: ${f.lint.style}`);

      // hooks present and includes lefthook.
      assert.ok(Array.isArray(f.hooks) && f.hooks.length > 0, 'hooks array should be non-empty');
      const hookIds = f.hooks.map((h) => `${h.tool}|${h.file}`);
      assert.ok(
        hookIds.some((s) => s.includes('lefthook')),
        `hooks should include lefthook: ${JSON.stringify(f.hooks)}`,
      );
    },
  );
});

test('config scan: python fixture without lefthook has empty hooks and still high signal (ruff)', async () => {
  await withFixture(
    'config-py-nohook',
    { 'pyproject.toml': PYPROJECT, 'src/demo/__init__.py': '' },
    async (dir) => {
      const res = await scan(dir);
      assert.equal(res.findings.hooks.length, 0);
      assert.equal(res.signal, 'high');
    },
  );
});

// ---------------------------------------------------------------------------
// JavaScript fixture
// ---------------------------------------------------------------------------

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'demo-js',
    version: '1.0.0',
    scripts: { lint: 'eslint .', format: 'prettier --write .' },
  },
  null,
  2,
);

test('config scan: JS fixture detects eslint + prettier (flat config style)', async () => {
  await withFixture(
    'config-js',
    {
      'package.json': PACKAGE_JSON,
      'eslint.config.mjs': 'export default [];\n',
      '.prettierrc.json': '{ "singleQuote": true }\n',
      'index.js': "console.log('hi');\n",
    },
    async (dir) => {
      const res = await scan(dir);
      const f = res.findings;

      assert.equal(res.dimension, 'config');
      assert.equal(res.signal, 'high');

      const linterNames = f.linters.map((l) => l.name);
      assert.ok(linterNames.includes('eslint'), `linters should include eslint: ${JSON.stringify(linterNames)}`);

      const formatterNames = f.formatters.map((x) => x.name);
      assert.ok(formatterNames.includes('prettier'), `formatters should include prettier: ${JSON.stringify(formatterNames)}`);

      assert.ok(f.lint, 'lint summary should be present');
      assert.equal(f.lint.style, 'flat', `eslint.config.mjs is flat style: ${f.lint.style}`);
      assert.ok(f.lint.config.includes('eslint'), `lint.config: ${f.lint.config}`);

      assert.ok(typeof f.format === 'string' && f.format.includes('prettier'), `format: ${f.format}`);

      assert.ok(f.scripts && f.scripts.lint, 'npm scripts should be captured');
    },
  );
});

test('config scan: JS fixture with legacy .eslintrc.json reports legacy style', async () => {
  await withFixture(
    'config-js-legacy',
    {
      'package.json': PACKAGE_JSON,
      '.eslintrc.json': '{ "root": true }\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      assert.ok(res.findings.lint, 'lint should be detected');
      assert.equal(res.findings.lint.style, 'legacy', `.eslintrc.json is legacy: ${res.findings.lint.style}`);
    },
  );
});

// ---------------------------------------------------------------------------
// ESLint flat config (.ts/.mts/.cts) detection (P0-18)
// ---------------------------------------------------------------------------

test('config scan: eslint.config.ts is detected as flat style', async () => {
  await withFixture(
    'config-eslint-ts',
    {
      'package.json': PACKAGE_JSON,
      'eslint.config.ts': 'export default [];\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const f = res.findings;
      const linterNames = f.linters.map((l) => l.name);
      assert.ok(linterNames.includes('eslint'), `linters should include eslint: ${JSON.stringify(linterNames)}`);
      assert.equal(f.lint.style, 'flat', `eslint.config.ts is flat: ${f.lint.style}`);
      const eslint = f.linters.find((l) => l.name === 'eslint');
      assert.equal(eslint.config, 'eslint.config.ts', `eslint config ref: ${eslint.config}`);
    },
  );
});

test('config scan: eslint.config.mts is detected', async () => {
  await withFixture(
    'config-eslint-mts',
    {
      'package.json': PACKAGE_JSON,
      'eslint.config.mts': 'export default [];\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const eslint = res.findings.linters.find((l) => l.name === 'eslint');
      assert.ok(eslint, 'eslint should be detected via eslint.config.mts');
      assert.equal(eslint.config, 'eslint.config.mts');
    },
  );
});

// ---------------------------------------------------------------------------
// shfmt false-positive fix (P0-12): .editorconfig alone must NOT imply shfmt
// ---------------------------------------------------------------------------

test('config scan: generic .editorconfig does NOT imply shfmt', async () => {
  const editorconfig = `\
root = true

[*]
indent_style = space
indent_size = 2

[*.py]
indent_size = 4
`;
  await withFixture(
    'config-editorconfig-noshell',
    {
      '.editorconfig': editorconfig,
      'scripts/deploy.sh': '#!/bin/bash\necho hi\n',
    },
    async (dir) => {
      // Force shell ecosystem resolution (shell has no manifest of its own).
      const res = await scan(dir, { languages: ['Shell'] });
      const formatterNames = res.findings.formatters.map((x) => x.name);
      assert.ok(
        !formatterNames.includes('shfmt'),
        `shfmt must NOT be reported for a non-shell editorconfig: ${JSON.stringify(formatterNames)}`,
      );
    },
  );
});

test('config scan: .editorconfig with a [*.sh] section DOES imply shfmt', async () => {
  const editorconfig = `\
root = true

[*]
indent_style = space

[*.sh]
indent_size = 2
shell_variant = posix
`;
  await withFixture(
    'config-editorconfig-shell',
    {
      '.editorconfig': editorconfig,
      'scripts/deploy.sh': '#!/bin/bash\necho hi\n',
    },
    async (dir) => {
      const res = await scan(dir, { languages: ['Shell'] });
      const formatterNames = res.findings.formatters.map((x) => x.name);
      assert.ok(
        formatterNames.includes('shfmt'),
        `shfmt should be reported when editorconfig has a shell section: ${JSON.stringify(formatterNames)}`,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// tsconfig paths real map + expanded fields
// ---------------------------------------------------------------------------

test('config scan: tsconfig paths map is preserved (not boolean)', async () => {
  const tsconfig = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noImplicitAny: true,
        baseUrl: '.',
        paths: { '@/*': ['src/*'], '@lib/*': ['lib/*'] },
        composite: false,
        declaration: true,
      },
      extends: '@tsconfig/strictest/tsconfig.json',
      references: [{ path: './shared' }],
    },
    null,
    2,
  );
  await withFixture(
    'config-tsconfig-paths',
    {
      'package.json': JSON.stringify({ name: 'demo-ts', version: '1.0.0', devDependencies: { typescript: '^5.0.0' } }),
      'tsconfig.json': tsconfig,
      'index.ts': 'export const x = 1;\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const ts = res.findings.typescript;
      assert.ok(ts, 'typescript finding should be present');
      assert.equal(ts.config, 'tsconfig.json');
      assert.equal(ts.strict, true);
      assert.equal(ts.target, 'ES2022');
      // paths must be the REAL map, not a boolean.
      assert.deepEqual(ts.paths, { '@/*': ['src/*'], '@lib/*': ['lib/*'] });
      // expanded fields
      assert.equal(ts.module, 'ESNext');
      assert.equal(ts.moduleResolution, 'Bundler');
      assert.equal(ts.noImplicitAny, true);
      assert.equal(ts.baseUrl, '.');
      assert.equal(ts.extends, '@tsconfig/strictest/tsconfig.json');
      assert.deepEqual(ts.references, [{ path: './shared' }]);
      assert.equal(ts.composite, false);
      assert.equal(ts.declaration, true);

      // tsc must be in typeCheckers, NOT in linters (P0).
      const tcNames = res.findings.typeCheckers.map((t) => t.name);
      assert.ok(tcNames.includes('tsc'), `typeCheckers should include tsc: ${JSON.stringify(tcNames)}`);
      const linterNames = res.findings.linters.map((l) => l.name);
      assert.ok(!linterNames.includes('tsc'), `tsc must NOT be in linters: ${JSON.stringify(linterNames)}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Bundlers / build tools (P1)
// ---------------------------------------------------------------------------

test('config scan: vite.config.ts is detected as a build tool', async () => {
  await withFixture(
    'config-vite',
    {
      'package.json': PACKAGE_JSON,
      'vite.config.ts': 'export default {};\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const names = res.findings.buildTools.map((b) => b.name);
      assert.ok(names.includes('vite'), `buildTools should include vite: ${JSON.stringify(names)}`);
      const vite = res.findings.buildTools.find((b) => b.name === 'vite');
      assert.equal(vite.config, 'vite.config.ts');
    },
  );
});

test('config scan: turbo.json + webpack detected as build tools', async () => {
  await withFixture(
    'config-build-multi',
    {
      'package.json': PACKAGE_JSON,
      'turbo.json': '{ "$schema": "https://turbo.build/schema.json" }\n',
      'webpack.config.js': 'module.exports = {};\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const names = res.findings.buildTools.map((b) => b.name);
      assert.ok(names.includes('turbo'), `buildTools should include turbo: ${JSON.stringify(names)}`);
      assert.ok(names.includes('webpack'), `buildTools should include webpack: ${JSON.stringify(names)}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Alternative runtimes: deno / bun / jsconfig (P1)
// ---------------------------------------------------------------------------

test('config scan: deno.json + bunfig.toml detected as runtimes', async () => {
  await withFixture(
    'config-runtimes',
    {
      'package.json': PACKAGE_JSON,
      'deno.json': '{ "tasks": {} }\n',
      'bunfig.toml': '[install]\nregistry = "https://registry.npmjs.org"\n',
      'index.js': 'x\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const names = res.findings.runtimes.map((r) => r.name);
      assert.ok(names.includes('deno'), `runtimes should include deno: ${JSON.stringify(names)}`);
      assert.ok(names.includes('bun'), `runtimes should include bun: ${JSON.stringify(names)}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Rust fixture: rustc type-checker, no rustfmt false-positive (P1)
// ---------------------------------------------------------------------------

test('config scan: Rust fixture detects rustc typechecker, NOT rustfmt', async () => {
  const cargo = `\
[package]
name = "demo-rs"
version = "0.1.0"
edition = "2021"

[dependencies]
`;
  await withFixture(
    'config-rust',
    {
      'Cargo.toml': cargo,
      'src/main.rs': 'fn main() {}\n',
    },
    async (dir) => {
      const res = await scan(dir);
      const f = res.findings;

      const tcNames = f.typeCheckers.map((t) => t.name);
      assert.ok(tcNames.includes('rustc'), `typeCheckers should include rustc: ${JSON.stringify(tcNames)}`);

      const formatterNames = f.formatters.map((x) => x.name);
      assert.ok(
        !formatterNames.includes('rustfmt'),
        `rustfmt must NOT be reported without rustfmt.toml: ${JSON.stringify(formatterNames)}`,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Ecosystem markers (P1)
// ---------------------------------------------------------------------------

test('config scan: Python ecosystem markers (MANIFEST.in) are surfaced', async () => {
  await withFixture(
    'config-markers',
    {
      'pyproject.toml': PYPROJECT,
      'MANIFEST.in': 'include README.md\n',
      'py.typed': '',
      'src/demo/__init__.py': '',
    },
    async (dir) => {
      const res = await scan(dir);
      assert.ok(
        res.findings.markers.includes('MANIFEST.in'),
        `markers should include MANIFEST.in: ${JSON.stringify(res.findings.markers)}`,
      );
      assert.ok(
        res.findings.markers.includes('py.typed'),
        `markers should include py.typed: ${JSON.stringify(res.findings.markers)}`,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Empty repo: signal low, lint/format null, arrays empty
// ---------------------------------------------------------------------------

test('config scan: empty fixture yields low signal and null lint/format', async () => {
  await withFixture('config-empty', { 'README.md': '# nothing here\n' }, async (dir) => {
    const res = await scan(dir);
    assert.equal(res.signal, 'low');
    assert.equal(res.findings.lint, null);
    assert.equal(res.findings.format, null);
    assert.equal(res.findings.typescript, null);
    assert.deepEqual(res.findings.linters, []);
    assert.deepEqual(res.findings.formatters, []);
    assert.deepEqual(res.findings.typeCheckers, []);
    assert.deepEqual(res.findings.hooks, []);
    assert.deepEqual(res.findings.buildTools, []);
    assert.deepEqual(res.findings.runtimes, []);
    assert.deepEqual(res.findings.markers, []);
  });
});

// ---------------------------------------------------------------------------
// Real perplexity-cli integration
// ---------------------------------------------------------------------------

test('config scan: real perplexity-cli -> ruff+pyright+bandit+vulture, ruff format, lefthook hook', async () => {
  if (!existsSync(REAL_REPO)) {
    // Skip when the real repo is not present in this environment.
    return;
  }

  const res = await scan(REAL_REPO);
  const f = res.findings;

  assert.equal(res.dimension, 'config');
  assert.equal(res.signal, 'high');

  const linterNames = f.linters.map((l) => l.name);
  for (const expected of ['ruff', 'pyright', 'bandit', 'vulture']) {
    assert.ok(linterNames.includes(expected), `linters should include ${expected}: ${JSON.stringify(linterNames)}`);
  }

  assert.ok(typeof f.format === 'string', 'format should be a string');
  assert.ok(f.format.includes('ruff'), `format should include ruff: ${f.format}`);

  const hookTools = f.hooks.map((h) => h.tool);
  assert.ok(hookTools.includes('lefthook'), `hooks should include lefthook: ${JSON.stringify(hookTools)}`);

  // Python repo: TS summary must be null even though typeCheckers is populated.
  assert.equal(f.typescript, null);
  const tcNames = f.typeCheckers.map((t) => t.name);
  assert.ok(tcNames.includes('pyright'), `typeCheckers should include pyright: ${JSON.stringify(tcNames)}`);

  // Ecosystem markers: perplexity-cli ships MANIFEST.in.
  assert.ok(
    Array.isArray(f.markers) && f.markers.includes('MANIFEST.in'),
    `markers should include MANIFEST.in: ${JSON.stringify(f.markers)}`,
  );

  // Evidence summary for the human reader.
  console.log('  [perplexity-cli config] linters   =', JSON.stringify(f.linters.map((l) => `${l.name}@${l.config}`)));
  console.log('  [perplexity-cli config] formatters=', JSON.stringify(f.formatters.map((x) => x.name)));
  console.log('  [perplexity-cli config] typeCheck=', JSON.stringify(tcNames));
  console.log('  [perplexity-cli config] hooks     =', JSON.stringify(f.hooks.map((h) => h.file)));
  console.log('  [perplexity-cli config] markers   =', JSON.stringify(f.markers));
  console.log('  [perplexity-cli config] lint      =', JSON.stringify(f.lint));
});
