import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withFixture, surveyOverview } from './harness.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { files as javascriptFiles, parityFiles as javascriptParityFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { scan as scanArchitecture } from '../lib/scan/deep/architecture.mjs';
import { scan as scanConfig } from '../lib/scan/deep/config.mjs';
import { scan as scanConventions } from '../lib/scan/deep/conventions.mjs';
import { scan as scanDocumentation } from '../lib/scan/deep/documentation.mjs';
import { scan as scanSecurity } from '../lib/scan/deep/security.mjs';
import { scan as scanStack } from '../lib/scan/deep/stack.mjs';
import { scan as scanTesting } from '../lib/scan/deep/testing.mjs';
import { DESCRIPTORS } from '../lib/scan/shared/ecosystem.mjs';
import { readManifest } from '../lib/scan/shared/manifest.mjs';

function edgesFrom(result, file) {
  return result.findings.importGraph.graph[file] || [];
}

async function scanFixture(name, files, scanner) {
  return withFixture(name, files, async (dir) => {
    const overview = await surveyOverview(dir);
    return scanner(dir, overview);
  });
}

export const P0_CASES = [
  {
    name: 'P0-01 TS import type emits no runtime edge',
    run: async () => {
      const result = await scanFixture('p0-01-ts-type', typescriptFiles, scanArchitecture);
      const edges = edgesFrom(result, 'src/index.ts');
      assert.ok(edges.includes('src/util.ts'), `runtime alias edge missing: ${JSON.stringify(edges)}`);
      assert.ok(!edges.includes('src/types.ts'), `type-only edge emitted: ${JSON.stringify(edges)}`);
      assert.ok(!result.findings.modules.includes('src/public.d.ts'), '.d.ts entered the runtime module set');
    },
  },
  {
    name: 'P0-02 JS/TS path alias resolves',
    run: async () => {
      const result = await scanFixture('p0-02-ts-alias', typescriptFiles, scanArchitecture);
      assert.ok(edgesFrom(result, 'src/index.ts').includes('src/util.ts'));
    },
  },
  {
    name: 'P0-03 Python multiline and PEP420 imports resolve',
    run: async () => {
      const result = await scanFixture('p0-03-python-imports', pythonFiles, scanArchitecture);
      const edges = edgesFrom(result, 'src/demo/cli.py');
      assert.ok(edges.includes('src/demo/parts/alpha.py'), `alpha edge missing: ${JSON.stringify(edges)}`);
      assert.ok(edges.includes('src/demo/parts/beta.py'), `beta edge missing: ${JSON.stringify(edges)}`);
      assert.ok(edges.includes('src/acme/plugins/loader.py'), `PEP 420 edge missing: ${JSON.stringify(edges)}`);
    },
  },
  {
    name: 'P0-04 Python docstring forward detection is positive',
    run: async () => {
      const result = await scanFixture('p0-04-python-docstrings', pythonFiles, scanConventions);
      const coverage = result.findings.docstrings.coverage.Python;
      assert.ok(parseInt(coverage, 10) > 0, `expected positive Python docstring coverage, got ${coverage}`);
    },
  },
  {
    name: 'P0-05 Python relative import is classified relative',
    run: async () => {
      const result = await scanFixture('p0-05-python-relative', pythonFiles, scanConventions);
      const style = result.findings.importStyle.byEcosystem.python;
      assert.ok(style.relativeImports > 0, `relative imports not counted: ${JSON.stringify(style)}`);
    },
  },
  {
    name: 'P0-06 PEP735 dependency-groups populate manifest devDependencies',
    run: async () => {
      await withFixture('p0-06-pep735', pythonFiles, async (dir) => {
        const manifest = readManifest(dir);
        assert.equal(manifest.devDependencies.pytest, '>=8');
        assert.equal(manifest.devDependencies.mypy, '>=1.10');
        assert.equal(manifest.dependencies.httpx, '>=0.27');
      });
    },
  },
  {
    name: 'P0-07 Cargo.toml alone does not imply rustfmt',
    run: async () => {
      const files = {
        'Cargo.toml': '[package]\nname = "cargo-only"\nversion = "0.1.0"\nedition = "2021"\n',
        'src/lib.rs': 'pub fn value() -> u8 { 1 }\n',
      };
      const result = await scanFixture('p0-07-cargo-only', files, scanConfig);
      assert.ok(!result.findings.formatters.some((tool) => tool.name === 'rustfmt'));
    },
  },
  {
    name: 'P0-08 Rust nested mod resolves file-as-directory without sibling false edge',
    run: async () => {
      const result = await scanFixture('p0-08-rust-mod', rustFiles, scanArchitecture);
      const edges = edgesFrom(result, 'src/a/b.rs');
      assert.ok(edges.includes('src/a/b/foo.rs'), `nested module edge missing: ${JSON.stringify(edges)}`);
      assert.ok(!edges.includes('src/a/foo.rs'), `false sibling edge emitted: ${JSON.stringify(edges)}`);
    },
  },
  {
    name: 'P0-09 Rust self and super resolve while external serde has no internal edge',
    run: async () => {
      const result = await scanFixture('p0-09-rust-uses', rustFiles, scanArchitecture);
      const edges = edgesFrom(result, 'src/a/b.rs');
      assert.ok(edges.includes('src/a/b/local.rs'), `self edge missing: ${JSON.stringify(edges)}`);
      assert.ok(edges.includes('src/a/sibling.rs'), `super edge missing: ${JSON.stringify(edges)}`);
      assert.ok(!edges.some((edge) => /serde/i.test(edge)), `external serde edge emitted: ${JSON.stringify(edges)}`);
    },
  },
  {
    name: 'P0-10 Rust unsafe is counted',
    run: async () => {
      const result = await scanFixture('p0-10-rust-unsafe', rustFiles, scanConventions);
      assert.ok(result.findings.unsafeCount.count > 0, JSON.stringify(result.findings.unsafeCount));
    },
  },
  {
    name: 'P0-11 shellcheck is tooling and absent from shell testFrameworks',
    run: async () => {
      await withFixture('p0-11-shellcheck', shellFiles, async (dir) => {
        const overview = await surveyOverview(dir);
        const [testing, config] = await Promise.all([
          scanTesting(dir, overview),
          scanConfig(dir, overview),
        ]);
        assert.ok(!testing.findings.framework.some((name) => /shellcheck/i.test(name)));
        assert.ok(config.findings.linters.some((tool) => tool.name === 'shellcheck'));
        assert.ok(config.findings.typeCheckers.some((tool) => tool.name === 'shellcheck'));
      });
    },
  },
  {
    name: 'P0-12 generic editorconfig does not imply shfmt',
    run: async () => {
      const result = await scanFixture('p0-12-editorconfig', shellFiles, scanConfig);
      assert.ok(!result.findings.formatters.some((tool) => tool.name === 'shfmt'));
    },
  },
  {
    name: 'P0-13 beautysh dead descriptor entry is absent',
    run: async () => {
      assert.ok(!DESCRIPTORS.shell.formatters.some((tool) => tool.name === 'beautysh'));
    },
  },
  {
    name: 'P0-14 shell moduleSystem is n/a sourced scripts',
    run: async () => {
      const result = await scanFixture('p0-14-shell-modules', shellFiles, scanConventions);
      assert.equal(result.findings.moduleSystem.inferred, 'n/a (sourced scripts)');
    },
  },
  {
    name: 'P0-15 Python and Rust comment metrics agree across scanners',
    run: async () => {
      const files = {
        'src/app.py': '"""Module docs."""\n# comment\ndef value():\n    """Return one."""\n    return 1\n',
        'src/lib.rs': '//! Crate docs.\n/// Return one.\npub fn value() -> u8 { 1 }\n',
      };
      await withFixture('p0-15-comments', files, async (dir) => {
        const overview = {
          path: dir,
          languages: ['Python', 'Rust'],
          ecosystems: { primary: 'python', all: ['python', 'rust'] },
          files: Object.keys(files),
        };
        const [conventions, documentation] = await Promise.all([
          scanConventions(dir, overview),
          scanDocumentation(dir, overview),
        ]);
        assert.match(
          conventions.findings.commentDensity,
          new RegExp(`^${documentation.findings.commentRatio.ratio}%(?:\\s|$)`),
        );
      });
    },
  },
  {
    name: 'P0-16 bun.lock selects bun and reports a lockfile',
    run: async () => {
      await withFixture('p0-16-bun-lock', javascriptParityFiles, async (dir) => {
        const overview = await surveyOverview(dir);
        const [stack, security] = await Promise.all([
          scanStack(dir, overview),
          scanSecurity(dir, overview),
        ]);
        assert.equal(stack.findings.packageManager, 'bun');
        assert.equal(security.findings.hasLockfile, true);
      });
    },
  },
  {
    name: 'P0-17 node:test is detected',
    run: async () => {
      const result = await scanFixture('p0-17-node-test', javascriptFiles, scanTesting);
      assert.ok(result.findings.framework.some((name) => name.includes('node:test')));
    },
  },
  {
    name: 'P0-18 eslint.config.ts is detected as flat config',
    run: async () => {
      const result = await scanFixture('p0-18-eslint-ts', javascriptFiles, scanConfig);
      assert.ok(result.findings.linters.some((tool) => tool.name === 'eslint' && tool.config === 'eslint.config.ts'));
      assert.equal(result.findings.lint.style, 'flat');
    },
  },
  {
    name: 'P0-19 JavaScript spec file is counted',
    run: async () => {
      const result = await scanFixture('p0-19-js-spec', javascriptFiles, scanTesting);
      assert.ok(result.findings.sampleFiles.includes('src/util.spec.js'));
      assert.ok(result.findings.naming.some((glob) => glob.includes('spec')));
    },
  },
  {
    name: 'P0-20 Rust workspace root unions member dependencies',
    run: async () => {
      await withFixture('p0-20-rust-workspace', rustFiles, async (dir) => {
        const manifest = readManifest(dir);
        assert.deepEqual(manifest.workspace.members, ['crates/alpha', 'crates/beta']);
        assert.equal(manifest.dependencies.anyhow, '1');
        assert.equal(manifest.dependencies.tokio, '1');
      });
    },
  },
  {
    name: 'P0-21 language standards are detected rather than asserted',
    run: async () => {
      const files = {
        'app.py': 'def value():\n    return 1\n',
        'app.ts': 'export const value: number = 1;\n',
        'lib.rs': 'pub fn value() -> u8 { 1 }\n',
      };
      await withFixture('p0-21-standards', files, async (dir) => {
        const overview = {
          path: dir,
          languages: ['Python', 'TypeScript', 'Rust'],
          ecosystems: { primary: 'python', all: ['python', 'typescript', 'rust'] },
          files: Object.keys(files),
        };
        const result = await scanConventions(dir, overview);
        const standards = result.findings.languageStandards.standards.join(' ');
        assert.doesNotMatch(standards, /PEP 484|@typescript-eslint|rustfmt|clippy/i);
      });
    },
  },
];

assert.equal(P0_CASES.length, 21, 'the explicit P0 parity matrix must contain exactly 21 cases');
assert.equal(new Set(P0_CASES.map(({ name }) => name)).size, 21, 'P0 parity case names must be unique');

for (const { name, run } of P0_CASES) test(name, run);
