import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFixture, surveyOverview } from './harness.mjs';
import { resolveRealRepo } from './helpers/real-repo.mjs';
import { scan } from '../lib/scan/deep/conventions.mjs';
import { renderConventions } from '../lib/scan/render/conventions.mjs';
import { countComments } from '../lib/scan/shared/comments.mjs';

// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture (same conventions: PEP 8, try/except/raise,
// setuptools backend).
const PERPLEXITY = resolveRealRepo().repo;
const PERPLEXITY_MISSING = resolveRealRepo().missing;

test('python fixture: PEP 8 absolute imports, try/except/raise, build backend', async () => {
  const files = {
    'pyproject.toml': [
      '[build-system]',
      'requires = ["hatchling"]',
      'build-backend = "hatchling.build"',
      '',
      '[project]',
      'name = "demo"',
      'version = "0.1.0"',
      '',
    ].join('\n'),
    'src/demo/core.py': [
      'import os',
      'import sys',
      'from typing import Any',
      '',
      'def f(x: Any) -> int:',
      '    try:',
      '        return int(x)',
      '    except (TypeError, ValueError):',
      '        raise RuntimeError("bad input")',
      '',
      'class DemoError(Exception):',
      '    pass',
      '',
    ].join('\n'),
    'src/demo/util.py': ['from demo.core import f', ''].join('\n'),
  };

  await withFixture('conv-py', files, async (dir) => {
    const res = await scan(dir, { path: dir });
    assert.equal(res.dimension, 'conventions');
    assert.ok(Array.isArray(res.findings.errorHandling.patterns));

    const { importStyle, errorHandling, moduleSystem } = res.findings;

    assert.ok(
      /PEP 8|absolute/i.test(importStyle.type),
      `importStyle.type was: ${importStyle.type}`,
    );
    assert.ok(importStyle.samples.length > 0, 'importStyle should carry samples');

    assert.ok(errorHandling.patterns.includes('try'), `patterns: ${errorHandling.patterns}`);
    assert.ok(errorHandling.patterns.includes('except'), `patterns: ${errorHandling.patterns}`);
    assert.ok(errorHandling.patterns.includes('raise'), `patterns: ${errorHandling.patterns}`);
    assert.ok(errorHandling.counts.try > 0);
    assert.ok(errorHandling.counts.raise > 0);

    assert.ok(/hatchling/i.test(moduleSystem.inferred), `inferred: ${moduleSystem.inferred}`);
    assert.equal(moduleSystem.packageJsonType, null);
  });
});

test('javascript fixture: ESM/CJS detection, try/throw', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', type: 'module' }),
    'src/index.mjs': [
      'import { foo } from "./foo.mjs";',
      '',
      'export function run() {',
      '  try {',
      '    foo();',
      '  } catch (err) {',
      '    throw new Error("failed: " + err.message);',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/foo.mjs': ['export function foo() {', '  return 1;', '}', ''].join('\n'),
  };

  await withFixture('conv-js', files, async (dir) => {
    const res = await scan(dir, { path: dir });
    const { importStyle, errorHandling, moduleSystem } = res.findings;

    assert.ok(/ESM|CJS|Mixed/.test(importStyle.type), `type: ${importStyle.type}`);
    assert.ok(importStyle.esmCount > 0, `esmCount: ${importStyle.esmCount}`);

    assert.ok(
      errorHandling.patterns.some((p) => p.includes('try')),
      `patterns: ${errorHandling.patterns}`,
    );
    assert.ok(
      errorHandling.patterns.some((p) => p.includes('throw')),
      `patterns: ${errorHandling.patterns}`,
    );

    assert.equal(moduleSystem.packageJsonType, 'module');
    assert.equal(moduleSystem.inferred, 'ESM');
  });
});

test('rust fixture: use imports, Result/? error handling, cargo edition', async () => {
  const files = {
    'Cargo.toml': [
      '[package]',
      'name = "demo"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      '',
    ].join('\n'),
    'src/main.rs': [
      'use std::fs;',
      '',
      'fn main() -> Result<(), Box<dyn std::error::Error>> {',
      '    let _content = fs::read_to_string("x.txt")?;',
      '    Ok(())',
      '}',
      '',
    ].join('\n'),
    'src/lib.rs': ['use std::collections::HashMap;', ''].join('\n'),
  };

  await withFixture('conv-rs', files, async (dir) => {
    const res = await scan(dir, { path: dir });
    const { importStyle, errorHandling, moduleSystem } = res.findings;

    assert.ok(/use/i.test(importStyle.type), `type: ${importStyle.type}`);

    assert.ok(
      errorHandling.patterns.some((p) => p.includes('Result') || p.includes('?')),
      `patterns: ${errorHandling.patterns}`,
    );

    assert.match(moduleSystem.inferred, /cargo/i);
    assert.match(moduleSystem.inferred, /2021/);
    assert.equal(moduleSystem.packageJsonType, null);
  });
});

test(
  'real perplexity-cli: PEP 8 absolute imports, try/except/raise, setuptools backend',
  async (t) => {
    if (PERPLEXITY_MISSING !== null) {
      t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${PERPLEXITY_MISSING}`);
      return;
    }
    const overview = await surveyOverview(PERPLEXITY);
    const res = await scan(PERPLEXITY, overview);
    const { importStyle, errorHandling, moduleSystem } = res.findings;

    assert.ok(
      /PEP 8|absolute/i.test(importStyle.type),
      `importStyle.type was: ${importStyle.type}`,
    );

    assert.ok(
      errorHandling.patterns.includes('try'),
      `patterns: ${errorHandling.patterns}`,
    );
    assert.ok(errorHandling.patterns.includes('except'), `patterns: ${errorHandling.patterns}`);
    assert.ok(errorHandling.patterns.includes('raise'), `patterns: ${errorHandling.patterns}`);

    assert.ok(
      /setuptools/i.test(moduleSystem.inferred),
      `inferred: ${moduleSystem.inferred}`,
    );
    assert.equal(moduleSystem.packageJsonType, null);
  },
);

// ---------------------------------------------------------------------------
// T108 acceptance tests
// ---------------------------------------------------------------------------

test('T108/P0-4: Python docstring coverage detected by looking forward into body', async () => {
  const files = {
    'pyproject.toml': '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
    'src/demo/core.py': [
      '"""Module."""',
      '',
      'def documented(x):',
      '    """Has a docstring."""',
      '    return x',
      '',
      'def undocumented(y):',
      '    return y',
      '',
    ].join('\n'),
  };

  await withFixture('conv-py-doc', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Python'] });
    const cov = res.findings.docstrings.coverage['Python'];
    assert.ok(cov, 'expected Python docstring coverage');
    // 1 of 2 functions documented -> 50%. The old lines[i-1] check found 0%.
    const pct = parseInt(cov, 10);
    assert.ok(pct > 0, `docstring coverage should be >0, got: ${cov}`);
    assert.match(cov, /1\/2/);
  });
});

test('T108/P0-5: relative imports classified as relative (not absolute)', async () => {
  const files = {
    'pyproject.toml': '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
    'src/demo/a.py': ['from . import b', 'from ..pkg import c', ''].join('\n'),
    'src/demo/b.py': ['value = 1', ''].join('\n'),
  };

  await withFixture('conv-py-rel', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Python'] });
    const py = res.findings.importStyle.byEcosystem.python;
    assert.ok(py, 'expected python importStyle entry');
    assert.ok(py.relativeImports > 0, `relativeImports: ${JSON.stringify(py)}`);
    assert.equal(py.absoluteImports, 0, `absoluteImports should be 0: ${JSON.stringify(py)}`);
    assert.match(py.type, /relative/i);
  });
});

test('T108/P0-10: Rust unsafe block/fn/impl counted', async () => {
  const files = {
    'Cargo.toml': '[package]\nname = "d"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': [
      'unsafe fn raw() {}',
      'unsafe impl Send for X {}',
      'fn w() { unsafe { let _p = 0 as *const u32; } }',
      '',
    ].join('\n'),
  };

  await withFixture('conv-rs-unsafe', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Rust'] });
    assert.ok(res.findings.unsafeCount.count > 0, `unsafeCount: ${JSON.stringify(res.findings.unsafeCount)}`);
    const kinds = res.findings.unsafeCount.kinds;
    assert.ok((kinds.fn || 0) + (kinds.impl || 0) + (kinds.block || 0) >= 3, `kinds: ${JSON.stringify(kinds)}`);
  });
});

test('T108/P0-14: Shell moduleSystem is not "auto"; pipefail adoption computed', async () => {
  const files = {
    'good.sh': ['#!/usr/bin/env bash', 'set -euo pipefail', 'echo hi', ''].join('\n'),
    'bad.sh': ['#!/bin/bash', 'echo hi', ''].join('\n'),
  };

  await withFixture('conv-sh', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['Shell'],
      ecosystems: { primary: 'shell', all: ['shell'] },
      files: ['good.sh', 'bad.sh'],
    });
    const { moduleSystem, shellHygiene } = res.findings;
    assert.ok(
      !/auto/i.test(moduleSystem.inferred),
      `shell moduleSystem must not be 'auto': ${moduleSystem.inferred}`,
    );
    assert.equal(moduleSystem.inferred, 'n/a (sourced scripts)');
    assert.ok(shellHygiene, 'expected shellHygiene');
    assert.equal(shellHygiene.totalShellFiles, 2);
    assert.equal(shellHygiene.filesWithPipefail, 1);
    assert.match(shellHygiene.pipefailAdoption, /50%/);
    assert.equal(shellHygiene.shebang.envBased, 1);
    assert.equal(shellHygiene.shebang.hardcoded, 1);
  });
});

test('T108/P0-15+helper: conventions commentDensity === shared comments.mjs for a shared Python+Rust sample', async () => {
  const py = [
    '"""Module docstring."""',
    'def add(a, b):',
    '    """Add."""',
    '    return a + b',
    '# trailing hash comment',
    '',
  ].join('\n');
  const rs = [
    '//! module',
    '/// item',
    'fn main() { let _x = 1; }',
  ].join('\n');

  const files = {
    'src/app.py': py,
    'src/main.rs': rs,
  };

  await withFixture('conv-cd', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['Python', 'Rust'],
      ecosystems: { primary: 'python', all: ['python', 'rust'] },
      files: ['src/app.py', 'src/main.rs'],
    });
    const cd = res.findings.commentDensity;
    assert.ok(cd, 'expected a comment density string');

    // Independently compute via the shared helper over the exact same sample.
    const pr = countComments(readFileSync(join(dir, 'src/app.py'), 'utf-8'), 'python');
    const rr = countComments(readFileSync(join(dir, 'src/main.rs'), 'utf-8'), 'rust');
    const commentLines = pr.commentLines + rr.commentLines;
    const totalLines = pr.totalLines + rr.totalLines;
    const expectedPct = ((commentLines / totalLines) * 100).toFixed(1);

    assert.match(
      cd,
      new RegExp(`^${expectedPct.replace('.', '\\.')}% \\(${commentLines} comment lines / ${totalLines} total`),
      `conventions=${cd} vs shared=${expectedPct}% ${commentLines}/${totalLines}`,
    );
  });
});

test('T108/P1: file-naming sampling excludes .md / config files', async () => {
  const files = {
    'README.md': '# title',
    'package.json': '{}',
    'src/myComponent.ts': 'export const x = 1;',
    'src/helper.ts': 'export const y = 2;',
  };

  await withFixture('conv-fn', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['TypeScript'],
      ecosystems: { primary: 'typescript', all: ['typescript'] },
      files: ['README.md', 'package.json', 'src/myComponent.ts', 'src/helper.ts'],
    });
    const fn = res.findings.fileNaming;
    // Only the two .ts files are sampled (camelCase names).
    assert.equal(fn.total, 2, `total: ${JSON.stringify(fn)}`);
    assert.equal(fn.dominant, 'camelCase');
  });
});

test('T108/P0-21: language standards are detected, not asserted', async () => {
  // Python fixture with NO type-checker / linter config and NO pyproject.toml.
  const files = { 'mod.py': 'def f():\n    return 1\n' };

  await withFixture('conv-std-none', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['Python'],
      ecosystems: { primary: 'python', all: ['python'] },
      files: ['mod.py'],
    });
    const stds = res.findings.languageStandards.standards;
    assert.ok(
      !stds.some((s) => /PEP 484/.test(s)),
      `PEP 484 must not be asserted without config: ${JSON.stringify(stds)}`,
    );
  });

  // Python fixture WITH mypy.ini -> PEP 484 asserted.
  const filesWith = { 'mod.py': 'def f():\n    return 1\n', 'mypy.ini': '[mypy]\nstrict = True\n' };
  await withFixture('conv-std-mypy', filesWith, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['Python'],
      ecosystems: { primary: 'python', all: ['python'] },
      files: ['mod.py', 'mypy.ini'],
    });
    const stds = res.findings.languageStandards.standards;
    assert.ok(stds.some((s) => /PEP 484/.test(s)), `expected PEP 484 with mypy.ini: ${JSON.stringify(stds)}`);
  });
});

test('T108/P1: symbol naming + async usage + custom exceptions surface for Python', async () => {
  const files = {
    'pyproject.toml': '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n',
    'src/demo/core.py': [
      'async def fetch_data(url):',
      '    """Fetch."""',
      '    return await coro()',
      '',
      'class MyError(Exception):',
      '    pass',
      '',
    ].join('\n'),
  };

  await withFixture('conv-py-rich', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Python'] });
    assert.ok(res.findings.symbolNaming.total > 0, 'symbolNaming should count symbols');
    assert.equal(res.findings.asyncUsage.byEcosystem.python.async, 1);
    assert.equal(res.findings.asyncUsage.byEcosystem.python.await, 1);
    assert.ok(
      (res.findings.errorHandling.counts['custom exceptions'] || 0) >= 1,
      `custom exceptions: ${JSON.stringify(res.findings.errorHandling.counts)}`,
    );
    assert.ok(res.findings.pythonTypeHints != null, 'pythonTypeHints should be present');
  });
});

// ---------------------------------------------------------------------------
// T003 fixture tests: production-source-universe measurement (A011)
// ---------------------------------------------------------------------------

test('T003/A011: async counts cover the full production source tree and exclude tests', async () => {
  const files = {
    'pyproject.toml': [
      '[build-system]',
      'requires = ["hatchling"]',
      'build-backend = "hatchling.build"',
      '',
      '[project]',
      'name = "asyncdemo"',
      'version = "0.1.0"',
      '',
    ].join('\n'),
    'src/asyncdemo/core.py': [
      'async def fetch_one(url):',
      '    return await request(url)',
      '',
      'async def fetch_many(urls):',
      '    first = await request(urls[0])',
      '    return [await request(u) for u in urls]',
      '',
      'def request(url):',
      '    return url',
      '',
    ].join('\n'),
    'src/asyncdemo/util.py': [
      'async def poll_once():',
      '    return await tick()',
      '',
      'async def poll_until(limit):',
      '    total = await tick(limit)',
      '    return await tick(total)',
      '',
      'def tick(limit=1):',
      '    return limit',
      '',
    ].join('\n'),
    // Async code in the tests directory must NOT leak into the production
    // source universe counts (b1 root cause: tests inflated the sample).
    'tests/test_async.py': [
      'async def test_a():',
      '    await fake_await()',
      '    await fake_await()',
      '',
      'async def test_b():',
      '    await fake_await()',
      '',
    ].join('\n'),
  };

  await withFixture('conv-async-universe', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Python'] });
    const au = res.findings.asyncUsage;
    assert.equal(au.byEcosystem.python.async, 4, `async: ${JSON.stringify(au)}`);
    assert.equal(au.byEcosystem.python.await, 6, `await: ${JSON.stringify(au)}`);
    assert.equal(au.byEcosystem.python.files, 2, `source files: ${JSON.stringify(au)}`);
    assert.equal(au.sourceFiles, 2, `total source files: ${JSON.stringify(au)}`);

    const markdown = renderConventions('repo', res.findings);
    assert.match(markdown, /4 async declaration\(s\), 6 await reference\(s\) across 2 production source files/);
  });
});

test('T003/A011: docstring coverage is measured over src/ with the exemption disclosed', async () => {
  const files = {
    'pyproject.toml': [
      '[build-system]',
      'requires = ["hatchling"]',
      'build-backend = "hatchling.build"',
      '',
      '[project]',
      'name = "docdemo"',
      'version = "0.1.0"',
      '',
    ].join('\n'),
    'src/docdemo/core.py': [
      '"""Module."""',
      '',
      'def documented_one():',
      '    """Doc one."""',
      '    return 1',
      '',
      'def documented_two(',
      '    value: int,',
      ') -> int:',
      '    """Doc two (multi-line signature)."""',
      '    return value',
      '',
      'def undocumented():',
      '    return 2',
      '',
      'class Widget:',
      '    """Widget docs."""',
      '',
      '    def __init__(self):',
      '        self.x = 1',
      '',
      '    def act(self):',
      '        """Act docs."""',
      '        return 3',
      '',
    ].join('\n'),
    // Undocumented test functions must not dilute the src/ coverage figure
    // (b6 root cause: mixed test + src universe).
    'tests/test_core.py': [
      'def test_a():',
      '    assert 1',
      '',
      'def test_b():',
      '    assert 2',
      '',
    ].join('\n'),
  };

  await withFixture('conv-doc-universe', files, async (dir) => {
    const res = await scan(dir, { path: dir, languages: ['Python'] });
    const cov = res.findings.docstrings.coverage['Python'];
    assert.ok(cov, 'expected Python docstring coverage');
    // 4 of 5 production-source items documented; __init__ is exempt.
    assert.match(cov, /4\/5/);
    assert.match(cov, /production source/);
    assert.match(cov, /tests, __init__ and magic methods exempt/);

    const markdown = renderConventions('repo', res.findings);
    assert.match(
      markdown,
      /Coverage: 80% \(4\/5 functions documented in production source; tests, __init__ and magic methods exempt\)/,
    );
  });
});

test('T003/A011: file naming classifies the full universe; mononyms are not camelCase', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'namedemo', type: 'module' }),
    'src/util/myComponent.ts': 'export const a = 1;\n',
    'src/util/helper.ts': 'export const b = 2;\n',
    'src/util/component_handler.ts': 'export const c = 3;\n',
    'src/util/another_handler.ts': 'export const d = 4;\n',
    'src/util/ParseUtil.ts': 'export const e = 5;\n',
    'src/util/api-client.ts': 'export const f = 6;\n',
  };

  await withFixture('conv-naming-universe', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['TypeScript'],
      ecosystems: { primary: 'typescript', all: ['typescript'] },
      files: Object.keys(files),
    });
    const fn = res.findings.fileNaming;
    assert.equal(fn.total, 6, `total: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns.snake_case, 2, `snake_case: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns.camelCase, 1, `true camelCase only: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns.PascalCase, 1, `PascalCase: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns['kebab-case'], 1, `kebab-case: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns.other, 1, `mononym helper must classify as other: ${JSON.stringify(fn)}`);
    assert.equal(fn.dominant, 'snake_case');
    assert.ok(
      !(fn.samples.camelCase || []).includes('helper'),
      `mononym must not appear as a camelCase sample: ${JSON.stringify(fn.samples)}`,
    );

    const markdown = renderConventions('repo', res.findings);
    assert.match(markdown, /snake_case across 6 source files \(full source-file enumeration\)/);
    assert.match(markdown, /camelCase: 1/);
  });
});

test('T003/A011: a mononym-only naming set yields zero camelCase', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'monodemo', type: 'module' }),
    'src/cli.ts': 'export const a = 1;\n',
    'src/auth.ts': 'export const b = 2;\n',
    'src/models.ts': 'export const c = 3;\n',
  };

  await withFixture('conv-naming-mononyms', files, async (dir) => {
    const res = await scan(dir, {
      path: dir,
      languages: ['TypeScript'],
      ecosystems: { primary: 'typescript', all: ['typescript'] },
      files: Object.keys(files),
    });
    const fn = res.findings.fileNaming;
    assert.equal(fn.patterns.camelCase, 0, `mononyms must not be camelCase: ${JSON.stringify(fn)}`);
    assert.equal(fn.patterns.other, 3, `mononyms classify as other: ${JSON.stringify(fn)}`);
    assert.equal(fn.dominant, 'other');
  });
});

// ---------------------------------------------------------------------------
// T006 — enforced conventions-block citation line
// ---------------------------------------------------------------------------

test('T006: the enforced conventions-block citation line renders in Code Conventions', () => {
  const findings = {
    importStyle: { type: 'absolute (PEP 8)', hasTypeImports: false, hasDynamicImports: false, samples: [] },
    fileNaming: { dominant: 'snake_case', total: 2, patterns: { snake_case: 2 } },
    errorHandling: { patterns: ['try'] },
    moduleSystem: { inferred: 'setuptools' },
    commentDensity: '10.0% (1 comment / 10 code lines)',
    enforcedConventionsBlock: { ruleCount: 20, sourcePath: '.opencode/plugins/pxcli-quality.ts' },
  };
  const markdown = renderConventions('repo', findings);
  assert.ok(
    markdown.includes(
      '- **Enforced conventions block**: 20 rules declared in `.opencode/plugins/pxcli-quality.ts` (tokenized facts in Development Practices)',
    ),
    `citation line missing:\n${markdown}`,
  );
});

test('T006: the citation line is gated on the enforced-conventions fact (baseline-safe)', () => {
  const findings = {
    importStyle: { type: 'absolute (PEP 8)', hasTypeImports: false, hasDynamicImports: false, samples: [] },
    fileNaming: { dominant: 'snake_case', total: 2, patterns: { snake_case: 2 } },
    errorHandling: { patterns: ['try'] },
    moduleSystem: { inferred: 'setuptools' },
    commentDensity: '10.0% (1 comment / 10 code lines)',
  };
  const markdown = renderConventions('repo', findings);
  assert.equal(markdown.includes('Enforced conventions block'), false,
    'findings without the enforced-conventions fact must not render the citation');
  assert.match(markdown, /## Code Conventions/);
  assert.match(markdown, /\*\*Import style\*\*/);
});
