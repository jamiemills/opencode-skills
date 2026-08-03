import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFixture, surveyOverview } from './harness.mjs';
import { scan } from '../lib/scan/deep/conventions.mjs';
import { countComments } from '../lib/scan/shared/comments.mjs';

const PERPLEXITY = '/home/jamiemills/code/projects/perplexity-cli';
const hasPerplexity = existsSync(`${PERPLEXITY}/pyproject.toml`);

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
  { skip: !hasPerplexity ? 'perplexity-cli not present' : false },
  async () => {
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
