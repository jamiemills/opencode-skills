import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { writeNORMS } from '../lib/scan/write.mjs';
import { resolveRealRepo } from './helpers/real-repo.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture (richness findings render identically: symbol
// naming, type hints, markers, version pins, pip-audit audit evidence).
const RESOLVED_REAL_REPO = resolveRealRepo();
const PERPLEXITY = RESOLVED_REAL_REPO.repo;

function buildFindings() {
  return {
    generated: '2026-01-01',
    repos: [
      {
        overview: {
          name: 'perplexity-cli',
          path: '/repo/perplexity-cli',
          languages: ['Python'],
          packageManager: 'uv',
          totalFiles: 42,
          isGit: true,
          gitRoot: '/repo',
        },
        deep: [
          {
            dimension: 'stack',
            signal: 'high',
            confidence: 'observed',
            coverage: 100,
            findings: {
              runtime: 'Python 3.12.3',
              language: 'Python',
              framework: 'click',
              packageManager: 'uv',
              type: 'module',
              main: 'src/perplexity_cli/__main__.py',
              name: 'perplexity-cli',
              version: '3.12.3',
              keyDeps: ['click'],
              deps: { click: '8.1.0' },
              keyDevDeps: ['pytest'],
              devDeps: { pytest: '8.0.0' },
              scripts: { test: 'pytest' },
            },
          },
          {
            dimension: 'git',
            signal: 'high',
            confidence: 'observed',
            coverage: 100,
            findings: {
              isGit: true,
              overview: 'conventional',
              branchPattern: 'feature/.*',
              defaultBranch: 'main',
              commitStyle: 'Conventional Commits',
              remote: 'pull_request_user',
              contributorCount: 3,
            },
          },
        ],
      },
    ],
  };
}

// A richer synthetic findings set exercising the G3 richness keys across the
// stack / config / conventions / operations dimensions, plus neutral
// cross-observations threaded through the top-level findings object.
function buildRichFindings() {
  return {
    generated: '2026-01-01',
    repos: [
      {
        crossObservations: [
          {
            description: 'conventions import style is ESM (import/export); package.json type is "commonjs"',
            dimensions: ['conventions', 'stack'],
          },
        ],
        overview: {
          name: 'rich-demo',
          path: '/repo/rich-demo',
          languages: ['TypeScript', 'Python'],
          packageManager: 'npm',
          totalFiles: 99,
          isGit: true,
          gitRoot: '/repo',
        },
        deep: [
          {
            dimension: 'stack',
            signal: 'high',
            confidence: 'observed',
            coverage: 100,
            findings: {
              runtime: 'Node.js 20.11.0',
              language: 'TypeScript',
              framework: 'None detected',
              packageManager: 'npm',
              name: 'rich-demo',
              nodeVersion: '20.11.0',
              rustVersion: '1.74.0',
              requiresPython: '>=3.10',
            },
          },
          {
            dimension: 'config',
            signal: 'high',
            confidence: 'observed',
            coverage: 100,
            findings: {
              lint: { config: 'eslint: eslint.config.mjs', style: 'flat' },
              format: 'prettier',
              typescript: {
                config: 'tsconfig.json',
                strict: true,
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                noImplicitAny: true,
                declaration: true,
                paths: { '@/*': ['src/*'] },
              },
              buildTools: [{ name: 'vite', config: 'vite.config.ts' }],
              runtimes: [{ name: 'deno', config: 'deno.json' }],
              markers: ['MANIFEST.in', 'py.typed', '.python-version'],
            },
          },
          {
            dimension: 'conventions',
            signal: 'high',
            confidence: 'inferred',
            coverage: 100,
            findings: {
              symbolNaming: {
                dominant: 'snake_case',
                counts: { snake_case: 866, camelCase: 12, PascalCase: 4, UPPER: 2, other: 1 },
                total: 885,
              },
              asyncUsage: { async: 12, await: 45, byEcosystem: {} },
              unsafeCount: { count: 0, kinds: { block: 0, fn: 0, impl: 0, trait: 0, extern: 0, other: 0 } },
              shellHygiene: {
                totalShellFiles: 5,
                filesWithPipefail: 4,
                pipefailAdoption: '80.0% (4/5 shell files)',
                shebang: { present: 5, envBased: 4, hardcoded: 1 },
                shellcheckDirectives: 2,
              },
              pythonTypeHints: {
                totalDefs: 1000,
                annotatedDefs: 999,
                paramAnnotated: 990,
                ratio: 99.9,
                futureAnnotations: true,
              },
              tsAnnotations: {
                interfaceCount: 45,
                typeCount: 20,
                interfaceVsTypeRatio: 2.25,
                annotationDensity: 62.5,
              },
            },
          },
          {
            dimension: 'operations',
            signal: 'high',
            confidence: 'observed',
            coverage: 100,
            findings: {
              hasJustfile: true,
              hasMakefile: true,
              monitoring: {
                libraries: [{ package: 'prometheus-client', label: 'Prometheus client' }],
              },
            },
          },
        ],
      },
    ],
  };
}

function buildSecurityFindings(security) {
  const findings = buildFindings();
  findings.repos[0].deep = [{ dimension: 'security', findings: security }];
  return findings;
}

test('does not over-escape dots, underscores, or hyphens in field values', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildFindings(), out);

  assert.ok(content.includes('perplexity-cli'), 'expected unescaped perplexity-cli');
  assert.ok(!content.includes('perplexity\\-cli'), 'hyphen must not be escaped');

  assert.ok(content.includes('Python 3.12.3'), 'expected unescaped version');
  assert.ok(!content.includes('3\\.12\\.3'), 'dot must not be escaped');

  assert.ok(content.includes('pull_request_user'), 'expected unescaped underscore');
  assert.ok(!content.includes('pull\\_request'), 'underscore must not be escaped');

  const overEscape = /\\[._-]/;
  assert.ok(!overEscape.test(content), `over-escape found: ${content.match(overEscape)?.[0]}`);
});

test('section meta line is a neutral coverage line with a basis', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildFindings(), out);

  assert.match(content, /> Coverage: \d+% of scanner fields reported · basis: observed/);
  assert.ok(!content.includes('Cohesion'), 'Cohesion label must be dropped');
  assert.ok(!content.includes('> **Signal**'), 'Signal label must be dropped');
  assert.ok(!content.includes('> **Confidence**'), 'grade-style Confidence header must be dropped');
});

test('renders the G3 richness findings (stack/config/conventions/operations)', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildRichFindings(), out);

  // stack version pins
  assert.ok(content.includes('**Version pins**'), 'stack version pins header missing');
  assert.ok(content.includes('Node `20.11.0`'), 'nodeVersion pin not rendered');
  assert.ok(content.includes('Rust MSRV `1.74.0`'), 'rustVersion pin not rendered');
  assert.ok(content.includes('requires-python `>=3.10`'), 'requiresPython pin not rendered');

  // config richness
  assert.ok(content.includes('**Build tools**: vite (`vite.config.ts`)'), 'buildTools not rendered');
  assert.ok(content.includes('**Alternative runtimes/manifests**: deno (`deno.json`)'), 'runtimes not rendered');
  assert.ok(content.includes('**Markers present**: MANIFEST.in, py.typed, .python-version'), 'markers not rendered');
  assert.ok(content.includes('module: NodeNext'), 'expanded typescript module not rendered');
  assert.ok(content.includes('moduleResolution: NodeNext'), 'expanded typescript moduleResolution not rendered');
  assert.ok(content.includes('noImplicitAny'), 'expanded typescript noImplicitAny not rendered');
  assert.ok(content.includes('declaration'), 'expanded typescript declaration not rendered');

  // conventions richness
  assert.ok(content.includes('**Symbol naming**: snake_case dominant (866 symbols)'), 'symbolNaming not rendered');
  assert.ok(content.includes('**Async/await usage**: 12 async declaration(s), 45 await reference(s)'), 'asyncUsage not rendered');
  assert.ok(content.includes('**Unsafe blocks**: 0'), 'unsafeCount not rendered');
  assert.ok(content.includes('**Shell hygiene**: pipefail adopted in 80.0% (4/5 shell files)'), 'shellHygiene not rendered');
  assert.ok(content.includes('Shebangs present in 5 file(s)'), 'shellHygiene shebang not rendered');
  assert.ok(content.includes('**Type hints**: 99.9% of defs annotated'), 'pythonTypeHints not rendered');
  assert.ok(content.includes('`from __future__ import annotations` present'), 'futureAnnotations not rendered');
  assert.ok(content.includes('**TS annotations**: 45 interface(s), 20 type alias(es); 62.5% annotation density'), 'tsAnnotations not rendered');

  // operations richness
  assert.ok(content.includes('**Justfile**: present'), 'hasJustfile not rendered');
  assert.ok(content.includes('**Monitoring/Observability**'), 'monitoring not rendered');
  assert.ok(content.includes('`prometheus-client`'), 'monitoring library not rendered');
});

test('renders cross-observations neutrally (no severity badges, neutral heading)', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildRichFindings(), out);

  assert.ok(content.includes('## Cross-observations'), 'neutral Cross-observations heading missing');
  assert.ok(
    content.includes('- conventions import style is ESM (import/export); package.json type is "commonjs"'),
    'cross-observation bullet not rendered neutrally',
  );
  assert.ok(!/\b(high|medium|low|critical)\s+severity\b/i.test(content), 'severity badges must not appear');
  assert.ok(!content.includes('## Contradictions'), 'must not use judgmental "Contradictions" heading');
  assert.ok(!content.includes('## Conflicts'), 'must not use judgmental "Conflicts" heading');
});

test('supports the single-repo top-level cross-observation compatibility fallback', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const findings = buildFindings();
  findings.contradictions = [{ description: 'top-level compatibility fact', dimensions: ['stack'] }];
  const content = await writeNORMS(findings, out);

  assert.match(content, /## Cross-observations[\s\S]*top-level compatibility fact/);
});

test('renders authoritative cross-observations within each repository', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const first = buildFindings().repos[0];
  const findings = {
    generated: '2026-01-01',
    contradictions: [{ description: 'top-level fact must not render', dimensions: [] }],
    repos: [
      { ...first, crossObservations: [{ description: 'first repository fact', dimensions: ['stack'] }] },
      {
        ...first,
        overview: { ...first.overview, name: 'second-repo', path: '/repo/second-repo' },
        crossObservations: [{ description: 'second repository fact', dimensions: ['git'] }],
      },
    ],
  };
  const content = await writeNORMS(findings, out);

  assert.equal((content.match(/## Cross-observations/g) || []).length, 2);
  assert.ok(content.indexOf('first repository fact') < content.indexOf('second repository fact'));
  assert.match(content, /first repository fact[\s\S]*Repository Overview[\s\S]*Name\*\*: second-repo[\s\S]*second repository fact/);
  assert.ok(!content.includes('top-level fact must not render'));
});

test('rendered output contains no banned judgmental voice terms', async () => {
  const out = join(tmpdir(), `norms-write-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildRichFindings(), out);

  const banned = /\b(should|must|ought|poor|poorly|good|bad|weak|strong|recommended|anti-pattern|smell|unfortunately|ideally|suboptimal)\b/i;
  const match = content.match(banned);
  assert.ok(!match, `banned voice term found: ${match?.[0]}`);
});

test('renders factual audit provenance for every structured evidence source', async () => {
  const out = join(tmpdir(), `norms-write-audit-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildSecurityFindings({
    hasAuditScript: true,
    auditEvidence: [
      { source: 'dependency', location: 'manifest', tool: 'pip-audit' },
      { source: 'package-script', location: 'package.json#scripts.audit', tool: 'npm audit' },
      { source: 'workflow', location: '.github/workflows/security.yml', tool: 'gitleaks' },
      { source: 'makefile', location: 'Makefile', tool: 'bandit' },
    ],
  }), out);

  assert.match(content, /\*\*Audit evidence\*\*:/);
  assert.ok(content.includes('Declared dependency: pip-audit'));
  assert.ok(content.includes('Package script audit: npm audit'));
  assert.ok(content.includes('Workflow reference (.github/workflows/security.yml): gitleaks'));
  assert.ok(content.includes('Makefile reference: bandit'));
  assert.ok(!content.includes('present in package.json scripts'));
  assert.ok(!content.includes('**Audit script**'));
});

test('renders a neutral fallback for legacy boolean-only audit findings', async () => {
  const out = join(tmpdir(), `norms-write-legacy-audit-${process.pid}-${Date.now()}.md`);
  const content = await writeNORMS(buildSecurityFindings({ hasAuditScript: true }), out);

  assert.ok(content.includes('**Audit evidence**: detected'));
  assert.ok(!content.includes('package.json'));
  assert.ok(!content.includes('**Audit script**'));
});

test('perplexity-cli pipeline renders the new richness findings and the neutral coverage line', { timeout: 120000 }, (t) => {
  if (PERPLEXITY === null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${RESOLVED_REAL_REPO.missing}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'norms-t115-'));
  const out = join(dir, 'NORMS.md');
  execSync(
    `node ${join(REPO_ROOT, 'scripts', 'scan.mjs')} --repos ${PERPLEXITY} --out ${out}`,
    { cwd: REPO_ROOT, stdio: 'pipe', timeout: 110000 },
  );
  const content = readFileSync(out, 'utf-8');

  // Neutral coverage line present, grade-style labels absent.
  assert.match(content, /> Coverage: \d+% of scanner fields reported · basis: (observed|inferred|unverified)/);
  assert.ok(!content.includes('> **Confidence**'), 'grade-style Confidence header must not appear');

  // Richness: at least one G3 finding surfaces for perplexity-cli.
  const hasRichness =
    content.includes('**Symbol naming**') ||
    content.includes('**Type hints**') ||
    content.includes('**Markers present**') ||
    content.includes('**Version pins**') ||
    content.includes('requires-python');
  assert.ok(hasRichness, 'no G3 richness finding rendered for perplexity-cli');

  // No mid-value over-escaping.
  assert.ok(!/\\[._-]/.test(content), 'over-escaping detected in pipeline output');

  assert.ok(!content.includes('present in package.json scripts'), 'must not infer package.json audit scripts');
  assert.ok(!content.includes('**Audit script**'), 'legacy Audit script label must not appear');
  assert.match(content, /Audit evidence[\s\S]*Declared dependency: pip-audit/);
});
