import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withFixture } from './harness.mjs';
import { survey } from '../lib/scan/survey.mjs';
import { enrich } from '../lib/scan/enrich.mjs';
import { validate } from '../lib/scan/validate.mjs';
import { writeNORMS } from '../lib/scan/write.mjs';
import * as structure from '../lib/scan/deep/structure.mjs';
import * as stack from '../lib/scan/deep/stack.mjs';
import * as config from '../lib/scan/deep/config.mjs';
import * as testing from '../lib/scan/deep/testing.mjs';
import * as conventions from '../lib/scan/deep/conventions.mjs';
import * as git from '../lib/scan/deep/git.mjs';
import * as architecture from '../lib/scan/deep/architecture.mjs';
import * as documentation from '../lib/scan/deep/documentation.mjs';
import * as security from '../lib/scan/deep/security.mjs';
import * as operations from '../lib/scan/deep/operations.mjs';
import { files as pythonFiles } from './fixtures/python.mjs';
import { parityFiles as javascriptFiles } from './fixtures/javascript.mjs';
import { files as typescriptFiles } from './fixtures/typescript.mjs';
import { files as rustFiles } from './fixtures/rust.mjs';
import { files as shellFiles } from './fixtures/shell.mjs';

// Mirrors scripts/scan.mjs: survey -> 10 deep scanners -> enrich -> validate
// -> writeNORMS. Single-repo, no retry loop. Returns the written markdown.
async function runPipeline(repoPath) {
  const overview = await survey(repoPath);

  const deepResults = (await Promise.all([
    structure.scan(repoPath, overview),
    stack.scan(repoPath, overview),
    config.scan(repoPath, overview),
    testing.scan(repoPath, overview),
    conventions.scan(repoPath, overview),
    git.scan(repoPath, overview),
    architecture.scan(repoPath, overview),
    documentation.scan(repoPath, overview),
    security.scan(repoPath, overview),
    operations.scan(repoPath, overview),
  ])).filter(Boolean);

  const enriched = await enrich(deepResults, overview);
  const validated = await validate(enriched);

  const out = join(
    tmpdir(),
    `norms-golden-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  try {
    return await writeNORMS(
      {
        generated: '2026-01-01',
        repos: [{ overview, deep: validated.findings, crossObservations: validated.contradictions }],
      },
      out,
    );
  } finally {
    await unlink(out).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

// Matches a backslash immediately followed by '.', '_', or '-' — the
// over-escape pattern that was previously emitted for hyphens/dots/underscores.
const OVER_ESCAPE = /\\[._-]/;

function assertNeutralMetadata(markdown, ecosystem) {
  assert.match(markdown, /> Coverage: \d+% of scanner fields reported · basis: (?:observed|inferred|unverified)/);
  assert.doesNotMatch(markdown, /\b(?:Cohesion|Signal):/);
  assert.doesNotMatch(markdown, /^#{1,6}\s+(?:Contradictions|Conflicts)\b/im);
  assert.ok(
    !OVER_ESCAPE.test(markdown),
    `${ecosystem}: markdown must not over-escape . _ - (found ${markdown.match(OVER_ESCAPE)?.[0]})`,
  );
}

test('T021 golden: python fixture pipeline produces Python, uv, ruff, pytest, and an ASCII/C4 graph with Python', async () => {
  const UVLOCK = 'version = 1\n\n[[package]]\nname = "demo"\nversion = "0.1.0"\n';
  const fixtureFiles = {
    ...pythonFiles,
    'uv.lock': UVLOCK,
    '.ruff_cache/content': 'noise\n',
  };

  const markdown = await withFixture('golden-py', fixtureFiles, runPipeline);

  assert.ok(markdown.includes('Python'), 'markdown must mention Python');
  assert.ok(markdown.includes('uv'), 'markdown must mention uv (package manager)');
  assert.ok(
    /ruff/i.test(markdown),
    'markdown must mention ruff (the fixture declares [tool.ruff])',
  );
  assert.ok(
    /pytest/i.test(markdown),
    'markdown must mention pytest (the fixture declares [tool.pytest.ini_options])',
  );

  assert.ok(
    /```[\s\S]*?Python[\s\S]*?```/.test(markdown),
    'markdown must contain a fenced ASCII/C4 diagram referencing Python',
  );
  assert.match(markdown, /Symbol naming.*snake_case dominant/);
  assert.match(markdown, /Type hints.*\d+(?:\.\d+)?% of defs annotated/);
  assert.match(markdown, /Comment density.*comment lines/);
  assert.ok(!markdown.includes('.hypothesis'), 'markdown must exclude Hypothesis cache noise');
  assert.ok(!markdown.includes('.ruff_cache'), 'markdown must exclude ruff cache noise');
  assertNeutralMetadata(markdown, 'python');
});

test('T113 golden: JavaScript fixture renders Node, Bun, tests, workspace architecture, and neutral metadata', async () => {
  const markdown = await withFixture('golden-js', javascriptFiles, runPipeline);

  assert.match(markdown, /Languages.*JavaScript/);
  assert.match(markdown, /Runtime.*Bun/);
  assert.match(markdown, /Version pins.*Node/);
  assert.match(markdown, /Package Manager.*bun/);
  assert.match(markdown, /Framework.*node:test/);
  assert.match(markdown, /packages\/app\/src\/index\.js[\s\S]*?@demo\/shared/);
  assert.match(markdown, /Architecture is inferred heuristically[\s\S]*?[1-9]\d* internal dependency edges/);
  assertNeutralMetadata(markdown, 'javascript');
});

test('T113 golden: TypeScript fixture renders compiler depth, spec tests, coherent architecture, and neutral metadata', async () => {
  const tsconfig = JSON.parse(typescriptFiles['tsconfig.json']);
  tsconfig.compilerOptions.moduleResolution = 'node16';
  tsconfig.compilerOptions.noImplicitAny = true;
  const fixtureFiles = {
    ...typescriptFiles,
    'tsconfig.json': `${JSON.stringify(tsconfig, null, 2)}\n`,
  };
  const markdown = await withFixture('golden-ts', fixtureFiles, runPipeline);

  assert.match(markdown, /Languages.*TypeScript/);
  assert.match(markdown, /TypeScript.*tsconfig\.json.*moduleResolution: node16.*noImplicitAny.*path aliases/);
  assert.match(markdown, /Test files.*spec.*ts/);
  assert.match(markdown, /Sample files.*src\/index\.spec\.ts/);
  assert.match(markdown, /Architecture is inferred heuristically[\s\S]*?[1-9]\d* internal dependency edges/);
  assert.doesNotMatch(markdown, /public\.d\.ts[\s\S]{0,100}(?:dependency edge|May use)/i);
  assertNeutralMetadata(markdown, 'typescript');
});

test('T113 golden: Rust fixture renders Cargo workspace, type checking, conventions, and generic detections', async () => {
  const cargo = rustFiles['Cargo.toml'].replace(
    '[dependencies]\n',
    '[dependencies]\nsqlx = "0.8"\ntracing = "0.1"\nargon2 = "0.5"\nvalidator = "0.18"\n',
  );
  const markdown = await withFixture(
    'golden-rust',
    { ...rustFiles, 'Cargo.toml': cargo },
    runPipeline,
  );

  assert.match(markdown, /Languages.*Rust/);
  assert.match(markdown, /Type checking.*rustc/);
  assert.match(markdown, /Package Manager.*cargo/);
  assert.match(markdown, /crates\/(?:alpha|beta)/);
  assert.match(markdown, /Dependencies[\s\S]*?sqlx[\s\S]*?tracing[\s\S]*?argon2[\s\S]*?validator/);
  assert.match(markdown, /Unsafe usage.*\d+/);
  assert.match(markdown, /ContainerDb\([^\n]*SQLx|SQLx[\s\S]*?Database/i);
  assert.match(markdown, /Authentication.*Argon2/i);
  assert.match(markdown, /Input validation.*Validator/i);
  assert.match(markdown, /Monitoring[\s\S]*?tracing/i);
  assertNeutralMetadata(markdown, 'rust');
});

test('T113 golden: Shell fixture renders shellcheck roles, sourced modules, hygiene, and no shfmt false positive', async () => {
  const markdown = await withFixture('golden-shell', shellFiles, runPipeline);

  assert.match(markdown, /Languages.*Shell/);
  assert.match(markdown, /Lint.*shellcheck/);
  assert.match(markdown, /Type checking.*shellcheck/);
  assert.doesNotMatch(markdown, /Framework[^\n]*shellcheck/i);
  assert.match(markdown, /Module system.*n\/a \(sourced scripts\)/);
  assert.match(markdown, /Shell hygiene.*pipefail adopted in \d+(?:\.\d+)?%/);
  assert.match(markdown, /Shebangs present in \d+ file/);
  assert.doesNotMatch(markdown, /Format[^\n]*shfmt/i);
  assertNeutralMetadata(markdown, 'shell');
});

test('T021 golden: real perplexity-cli repo (skipped if path absent)', async () => {
  const REPO = '/home/jamiemills/code/projects/perplexity-cli';
  if (!existsSync(REPO)) {
    console.warn(`[T021] skipping real-repo golden check — ${REPO} not present`);
    return;
  }

  const markdown = await runPipeline(REPO);

  assert.ok(
    /Python \(declared:/.test(markdown),
    'markdown must render declaration-backed Python runtime evidence',
  );
  assert.ok(markdown.includes('uv'), 'markdown must mention uv');
  assert.ok(markdown.includes('Click'), 'markdown must mention Click');
  assert.ok(/pytest/i.test(markdown), 'markdown must mention pytest');
  const testCount = markdown.match(/Test files\*\*: (\d+)/)?.[1];
  assert.ok(testCount, 'markdown must report the real repository test-file count');
  assert.ok(
    Number(testCount) >= 240 && Number(testCount) <= 320,
    `test-file count must remain near the observed 269 (got ${testCount})`,
  );
  assert.ok(
    /Lockfile[\s\S]{0,40}present/.test(markdown),
    'markdown must report Lockfile ... present',
  );
  assert.match(markdown, /Security tooling[^\n]*gitleaks[^\n]*SECURITY\.md[^\n]*pip-audit/i);
  assert.match(markdown, /Symbol naming.*snake_case dominant/);
  assert.match(markdown, /Type hints.*\d+(?:\.\d+)?% of defs annotated/);
  assert.match(markdown, /Version pins.*requires-python.*>=3\.12/);
  assert.match(markdown, /Markers present.*MANIFEST\.in/);

  assert.ok(
    !markdown.includes('.hypothesis'),
    'markdown must not leak .hypothesis cache noise from the real repo',
  );
  assert.ok(
    !markdown.includes('.ruff_cache'),
    'markdown must not leak .ruff_cache noise from the real repo',
  );
  assert.ok(
    !markdown.includes('perplexity\\-cli'),
    'markdown must not over-escape hyphen in perplexity-cli',
  );
  assertNeutralMetadata(markdown, 'perplexity-cli');
});
