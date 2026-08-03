// T216 Assurance & Supply Chain dimension — focused test suite.
//
// Covers the static parsers (manifests, lockfiles, pins, sources, licenses,
// SBOM/VEX/SARIF, tool configuration/results, accessibility artifacts,
// attestations, standards references), the deterministic privacy-safe model,
// the T210-compatible provider, the inert renderer, and the end-to-end
// scanner. Includes positive fixtures per artifact class, malformed/unsupported
// atomicity, privacy canaries, caps, no-verdict vocabulary, and zero-leak voice
// checks.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  ASSURANCE_CATEGORIES,
  ASSURANCE_DIMENSION_ID,
  ASSURANCE_LIMITS,
  ASSURANCE_STATUSES,
  AssuranceModelError,
  buildAssuranceModel,
  createMatchedKey,
  recordId,
} from '../lib/scan/deep/assurance/model.mjs';
import {
  classifyAssurancePath,
  discoverAssuranceArtifacts,
  extractAssuranceArtifact,
} from '../lib/scan/deep/assurance/parsers.mjs';
import { scanAssurance } from '../lib/scan/deep/assurance/scanner.mjs';
import {
  ASSURANCE_PROVIDER_ID,
  assuranceObservations,
  assuranceProviderResult,
} from '../lib/scan/providers/assurance.mjs';
import {
  createAssuranceRenderer,
  renderAssurance,
} from '../lib/scan/render/assurance.mjs';
import {
  ASSURANCE_STANDARD_PACK_VERSION,
  ASSURANCE_STANDARD_JOINS,
  resolveAssuranceStandard,
  validateAssuranceStandardsPack,
} from '../lib/scan/standards/assurance-pack.mjs';
import { EXISTING_TEN_RENDERER_MAP } from '../lib/scan/render/existing-ten.mjs';
import { PROVIDER_CATEGORIES } from '../lib/scan/contracts/provider.mjs';
import { EVIDENCE_SOURCE_KINDS } from '../lib/scan/contracts/evidence.mjs';
import { withFixture } from './harness.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

function textArtifact(path, text) {
  return extractAssuranceArtifact({ path, text, value: null, format: 'text' });
}

function jsonArtifact(path, value) {
  return extractAssuranceArtifact({ path, text: '', value, format: 'json' });
}

function recordsOf(result) {
  return result.records;
}

function diagnosticsOf(result) {
  return result.diagnostics;
}

function modelOf(result, files = 1) {
  return buildAssuranceModel({
    records: result.records,
    diagnostics: result.diagnostics,
    measurement: { filesInspected: files, bytesInspected: 1, recordsInspected: 1 },
  });
}

// No-verdict vocabulary: the assurance renderer must never assert compliance,
// conformance, compatibility, vulnerability, or any synthesized pass/fail.
const BANNED_VOICE = Object.freeze([
  'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'recommendation', 'ideally',
  'unfortunately', 'concern', 'concerning', 'problem', 'anti-pattern', 'smell',
  'suboptimal', 'inadequate', 'insufficient', 'contradiction', 'inconsistent',
  'inconsistency', 'conflict', 'lacking',
]);

const BANNED_VERDICT = Object.freeze([
  'compliant', 'compliance', 'conformant', 'conformance', 'compatible',
  'compatibility', 'vulnerable', 'vulnerability', 'affected', 'severity',
  'exploitable', 'exposed', 'pass', 'failed', 'fail', 'remediate', 'fixed',
]);

function findVoiceHits(markdown) {
  const pattern = new RegExp(`\\b(?:${[...BANNED_VOICE, ...BANNED_VERDICT].join('|')})\\b`, 'gi');
  const prose = markdown.replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
  return [...prose.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

// ---------------------------------------------------------------------------
// Model — schema, determinism, immutability, caps, privacy
// ---------------------------------------------------------------------------

test('T216 model: category snapshot, statuses, and limits are exact and frozen', () => {
  assert.deepEqual(ASSURANCE_CATEGORIES, [
    'accessibility', 'attestation', 'configuration', 'license', 'lock',
    'manifest', 'pin', 'sarif', 'sbom', 'source', 'standard', 'tool_result', 'vex',
  ]);
  assert.deepEqual(ASSURANCE_STATUSES, ['observed', 'unverified']);
  assert.equal(ASSURANCE_DIMENSION_ID, 'DIM-assurance-v1');
  assert.equal(Object.isFrozen(ASSURANCE_LIMITS), true);
  assert.equal(Object.isFrozen(ASSURANCE_CATEGORIES), true);
  for (const category of ASSURANCE_CATEGORIES) {
    assert.ok(PROVIDER_CATEGORIES['DIM-assurance-v1'].includes(category), category);
  }
});

test('T216 model: deep-frozen deterministic model with exact summary', () => {
  const records = [
    { category: 'manifest', path: 'package.json', status: 'observed', details: { format: 'package_json', ecosystem: 'javascript' } },
    { category: 'pin', path: 'package.json', status: 'observed', details: { package: 'lodash', scope: 'manifest', version: '4.17.21' } },
  ];
  const first = buildAssuranceModel({ records, measurement: { filesInspected: 2 } });
  const second = buildAssuranceModel({
    records: [...records].reverse(),
    measurement: { filesInspected: 7 },
  });
  assert.notEqual(first, second);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(buildAssuranceModel({ records, measurement: { filesInspected: 2 } })),
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.equal(Object.isFrozen(first.manifest[0]), true);
  assert.equal(Object.isFrozen(first.manifest[0].details), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.manifest.push({}), TypeError);
  assert.throws(() => first.manifest[0].path = 'mutated', TypeError);

  assert.equal(first.summary.manifests, 1);
  assert.equal(first.summary.pins, 1);
  assert.equal(first.summary.records, 2);
  assert.equal(first.summary.filesInspected, 2);
  assert.equal(first.cappedTotal, false);
  assert.deepEqual(Object.keys(first).sort(), [
    'accessibility', 'attestation', 'cappedTotal', 'configuration', 'diagnostics',
    'license', 'lock', 'manifest', 'pin', 'sarif', 'sbom', 'searchSpace',
    'source', 'standard', 'summary', 'tool_result', 'vex',
  ]);
});

test('T216 model: matchedKey identities are stable and record ids are prefixed hashes', () => {
  const candidate = {
    category: 'pin', path: 'requirements.txt', status: 'observed',
    details: { package: 'requests', scope: 'requirements', version: '2.31.0' },
  };
  assert.equal(createMatchedKey(candidate), 'pin:requests:2.31.0');
  assert.equal(createMatchedKey({ ...candidate, category: 'manifest', details: { format: 'package_json', ecosystem: 'javascript' } }), 'manifest:package_json');
  assert.equal(createMatchedKey({ ...candidate, category: 'standard', details: { registryId: 'std:owasp-cyclonedx:1.7', editionKey: '1.7', disposition: 'metadata_only' } }), 'standard:std:owasp-cyclonedx:1.7');
  assert.match(recordId({ category: 'pin', matchedKey: 'pin:requests:2.31.0', path: 'requirements.txt' }), /^asc-[a-f0-9]{24}$/);
});

test('T216 model: invalid categories, statuses, identities, and paths fail with typed errors', () => {
  const bad = (overrides) => buildAssuranceModel({
    records: [{
      category: 'manifest', path: 'package.json', status: 'observed',
      details: { format: 'package_json', ecosystem: 'javascript' },
      ...overrides,
    }],
    measurement: { filesInspected: 1 },
  });
  assert.throws(() => bad({ category: 'language' }), (e) => e instanceof AssuranceModelError && e.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => bad({ status: 'observed-evil' }), AssuranceModelError);
  assert.throws(() => bad({ path: '/etc/passwd' }), AssuranceModelError);
  assert.throws(() => bad({ path: '../escape' }), AssuranceModelError);
  assert.throws(() => bad({ details: { format: 'package_json' } }), AssuranceModelError);
  assert.throws(() => bad({ details: { format: 'package_json', ecosystem: 'javascript', extra: 1 } }), AssuranceModelError);
  const privacyFiltered = buildAssuranceModel({
    records: [{
      category: 'manifest', path: 'package.json', status: 'observed',
      details: { format: 'package_json', ecosystem: 'alice@example.test' },
    }],
    measurement: { filesInspected: 1 },
  });
  assert.equal(privacyFiltered.manifest.length, 0, 'sensitive details are privacy-filtered');
  assert.deepEqual(privacyFiltered.diagnostics, [{ path: 'package.json', status: 'unverified', reason: 'PRIVACY' }]);
});

test('T216 model: vex statementCount is a bounded non-negative integer', () => {
  const base = {
    category: 'vex', path: 'openvex.json', status: 'observed',
    details: { format: 'OpenVEX', specVersion: '0.2.0', statementCount: 3 },
  };
  const model = buildAssuranceModel({ records: [base], measurement: { filesInspected: 1 } });
  assert.equal(model.vex[0].details.statementCount, 3);
  assert.throws(() => buildAssuranceModel({
    records: [{ ...base, details: { ...base.details, statementCount: -1 } }],
    measurement: { filesInspected: 1 },
  }), AssuranceModelError);
  assert.throws(() => buildAssuranceModel({
    records: [{ ...base, details: { ...base.details, statementCount: '3' } }],
    measurement: { filesInspected: 1 },
  }), AssuranceModelError);
});

test('T216 model: privacy violations are dropped and become unverified PRIVACY diagnostics', () => {
  const records = [
    {
      category: 'pin', path: 'requirements.txt', status: 'observed',
      details: { package: 'alice@example.test', scope: 'requirements', version: '1.0.0' },
    },
    {
      category: 'manifest', path: 'package.json', status: 'observed',
      details: { format: 'package_json', ecosystem: 'javascript' },
    },
  ];
  const model = buildAssuranceModel({ records, measurement: { filesInspected: 2 } });
  assert.deepEqual(model.manifest.map(({ details }) => details.format), ['package_json']);
  assert.deepEqual(model.diagnostics, [{
    path: 'requirements.txt', status: 'unverified', reason: 'PRIVACY',
  }]);
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes('alice@example.test'), false);
});

test('T216 model: per-category caps are disclosed and never drop silently', () => {
  const flood = Array.from({ length: ASSURANCE_LIMITS.pins + 10 }, (_, index) => ({
    category: 'pin', path: 'requirements.txt', status: 'observed',
    details: { package: `pkg-${index}`, scope: 'requirements', version: '1.0.0' },
  }));
  const model = buildAssuranceModel({ records: flood, measurement: { filesInspected: 1 } });
  assert.equal(model.summary.pins, ASSURANCE_LIMITS.pins);
  assert.equal(model.summary.capped.pins, true);
  assert.equal(model.cappedTotal, true);
});

// ---------------------------------------------------------------------------
// Standards pack
// ---------------------------------------------------------------------------

test('T216 standards pack: versioned, metadata-only, and validated against the registry', () => {
  assert.equal(ASSURANCE_STANDARD_PACK_VERSION, 1);
  assert.equal(Object.isFrozen(ASSURANCE_STANDARD_JOINS), true);
  assert.ok(ASSURANCE_STANDARD_JOINS.every(Object.isFrozen));
  for (const join of ASSURANCE_STANDARD_JOINS) {
    assert.equal(join.disposition, 'metadata_only');
    assert.ok(['std:owasp-cyclonedx:1.7', 'std:spdx-spec:2.3.0', 'std:openvex-spec:0.2.0',
      'std:oasis-sarif:2.1.0-errata01', 'std:w3c-wcag:2.2-rec-20241212'].includes(join.registryId));
  }
  assert.deepEqual(validateAssuranceStandardsPack(), ASSURANCE_STANDARD_JOINS);
});

test('T216 standards pack: exact identity joins resolve; unknown identities never resolve', () => {
  assert.equal(resolveAssuranceStandard('sbom:CycloneDX:1.7')?.registryId, 'std:owasp-cyclonedx:1.7');
  assert.equal(resolveAssuranceStandard('sbom:SPDX:SPDX-2.3')?.registryId, 'std:spdx-spec:2.3.0');
  assert.equal(resolveAssuranceStandard('vex:OpenVEX:0.2.0')?.registryId, 'std:openvex-spec:0.2.0');
  assert.equal(resolveAssuranceStandard('sarif:2.1.0')?.registryId, 'std:oasis-sarif:2.1.0-errata01');
  assert.equal(resolveAssuranceStandard('accessibility:WCAG:2.2')?.registryId, 'std:w3c-wcag:2.2-rec-20241212');
  assert.equal(resolveAssuranceStandard('sbom:CycloneDX:1.6'), null);
  assert.equal(resolveAssuranceStandard('sbom:SPDX:SPDX-2.2'), null);
  assert.equal(resolveAssuranceStandard('vex:OpenVEX:1.0'), null);
  assert.equal(resolveAssuranceStandard('sarif:2.0'), null);
  assert.equal(resolveAssuranceStandard('accessibility:WCAG:2.1'), null);
  assert.equal(resolveAssuranceStandard('nonsense'), null);
});

test('T216 standards pack: records carry metadata only, no compliance prose', () => {
  const serialized = JSON.stringify(ASSURANCE_STANDARD_JOINS);
  for (const term of ['should', 'must', 'compliant', 'conform', 'compatible', 'vulnerable', 'require']) {
    assert.equal(new RegExp(`\\b${term}\\b`, 'i').test(serialized), false, `no ${term}`);
  }
});

// ---------------------------------------------------------------------------
// Parsers — path classification and discovery
// ---------------------------------------------------------------------------

test('T216 parsers: classifyAssurancePath recognizes assurance artifacts', () => {
  assert.deepEqual(classifyAssurancePath('package.json'), { kind: 'manifest', format: 'json' });
  assert.deepEqual(classifyAssurancePath('Cargo.toml'), { kind: 'manifest', format: 'text' });
  assert.deepEqual(classifyAssurancePath('pyproject.toml'), { kind: 'manifest', format: 'text' });
  assert.deepEqual(classifyAssurancePath('requirements.txt'), { kind: 'manifest', format: 'text' });
  assert.deepEqual(classifyAssurancePath('requirements-dev.txt'), { kind: 'manifest', format: 'text' });
  assert.deepEqual(classifyAssurancePath('Gemfile'), { kind: 'manifest', format: 'text' });
  assert.deepEqual(classifyAssurancePath('package-lock.json'), { kind: 'lock', format: 'json' });
  assert.deepEqual(classifyAssurancePath('yarn.lock'), { kind: 'lock', format: 'text' });
  assert.deepEqual(classifyAssurancePath('Cargo.lock'), { kind: 'lock', format: 'text' });
  assert.deepEqual(classifyAssurancePath('bun.lockb'), { kind: 'lock', format: 'binary' });
  assert.deepEqual(classifyAssurancePath('sbom.json'), { kind: 'sbom', format: 'json' });
  assert.deepEqual(classifyAssurancePath('a.cdx.json'), { kind: 'sbom', format: 'json' });
  assert.deepEqual(classifyAssurancePath('a.spdx.json'), { kind: 'sbom', format: 'json' });
  assert.deepEqual(classifyAssurancePath('openvex.json'), { kind: 'vex', format: 'json' });
  assert.deepEqual(classifyAssurancePath('a.vex.json'), { kind: 'vex', format: 'json' });
  assert.deepEqual(classifyAssurancePath('a.sarif'), { kind: 'sarif', format: 'json' });
  assert.deepEqual(classifyAssurancePath('a.sarif.json'), { kind: 'sarif', format: 'json' });
  assert.deepEqual(classifyAssurancePath('.gitleaks.toml'), { kind: 'configuration', format: 'text' });
  assert.deepEqual(classifyAssurancePath('osv-scanner.toml'), { kind: 'configuration', format: 'text' });
  assert.deepEqual(classifyAssurancePath('osv-scanner-results.json'), { kind: 'tool_result', format: 'text' });
  assert.deepEqual(classifyAssurancePath('accessibility.md'), { kind: 'accessibility', format: 'text' });
  assert.deepEqual(classifyAssurancePath('.pa11yci.json'), { kind: 'accessibility', format: 'text' });
  assert.deepEqual(classifyAssurancePath('a.intoto.jsonl'), { kind: 'attestation', format: 'text' });
  assert.deepEqual(classifyAssurancePath('provenance.intoto.jsonl'), { kind: 'attestation', format: 'text' });
  assert.deepEqual(classifyAssurancePath('a.sigstore.json'), { kind: 'attestation', format: 'text' });
  assert.deepEqual(classifyAssurancePath('LICENSE'), { kind: 'license', format: 'text' });
  assert.deepEqual(classifyAssurancePath('LICENSE-MIT'), { kind: 'license', format: 'text' });
  assert.equal(classifyAssurancePath('src/main.js'), null);
  assert.equal(classifyAssurancePath('README.md'), null);
});

test('T216 parsers: discovery returns only assurance candidates in stable order', () => {
  const files = [
    'src/main.js', 'package.json', 'README.md', 'Cargo.lock', 'requirements-dev.txt',
    'openvex.json', 'docs/a11y.md', 'LICENSE',
  ];
  assert.deepEqual(discoverAssuranceArtifacts(files), [
    'Cargo.lock', 'LICENSE', 'docs/a11y.md', 'openvex.json', 'package.json', 'requirements-dev.txt',
  ]);
});

// ---------------------------------------------------------------------------
// Parsers — manifests, pins, sources, licenses
// ---------------------------------------------------------------------------

test('T216 parsers: package.json extracts manifest, license, exact pins, and git sources', () => {
  const result = jsonArtifact('package.json', {
    license: 'MIT',
    dependencies: {
      lodash: '4.17.21',
      express: '^4.0.0',
      repo: 'git+https://github.com/acme/repo.git',
    },
    devDependencies: { eslint: '8.0.0' },
  });
  const byCategory = (category) => recordsOf(result).filter((r) => r.category === category);
  assert.deepEqual(byCategory('manifest').map((r) => r.details), [
    { ecosystem: 'javascript', format: 'package_json' },
  ]);
  assert.deepEqual(byCategory('license').map((r) => r.details), [
    { declared: 'manifest', identifier: 'MIT' },
  ]);
  const pins = byCategory('pin').map((r) => r.details);
  assert.ok(pins.some((p) => p.package === 'lodash' && p.version === '4.17.21' && p.scope === 'manifest'));
  assert.equal(pins.some((p) => p.package === 'express'), false, 'ranges are not pins');
  assert.deepEqual(byCategory('source').map((r) => [r.details.kind, r.details.host]), [
    ['git', 'github.com'],
  ]);
});

test('T216 parsers: requirements.txt extracts pins and index sources, skipping ranges', () => {
  const result = textArtifact('requirements.txt', [
    'requests==2.31.0',
    'flask>=2.0',
    '--index-url https://pypi.org/simple',
    '--extra-index-url https://test.pypi.org/simple',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'requests', scope: 'requirements', version: '2.31.0' },
  ]);
  const sources = recordsOf(result).filter((r) => r.category === 'source').map((r) => r.details);
  assert.deepEqual(sources.map((s) => s.host).sort(), ['pypi.org', 'test.pypi.org']);
});

test('T216 parsers: pyproject.toml extracts manifest, license, pins, and uv index', () => {
  const result = textArtifact('pyproject.toml', [
    '[project]',
    'name = "demo"',
    'license = "MIT"',
    'dependencies = ["requests==2.31.0", "click>=8.0"]',
    '[tool.uv]',
    'index-url = "https://pypi.org/simple"',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'manifest').map((r) => r.details), [
    { ecosystem: 'python', format: 'pyproject_toml' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'license').map((r) => r.details), [
    { declared: 'manifest', identifier: 'MIT' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'requests', scope: 'manifest', version: '2.31.0' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'source').map((r) => r.details), [
    { host: 'pypi.org', kind: 'index', label: 'index' },
  ]);
});

test('T216 parsers: Cargo.toml extracts license and pinned equals-versions only', () => {
  const result = textArtifact('Cargo.toml', [
    '[package]',
    'name = "demo"',
    'license = "MIT OR Apache-2.0"',
    '[dependencies]',
    'serde = "1.0.200"',
    'pin = { version = "=1.2.3" }',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'license').map((r) => r.details), [
    { declared: 'manifest', identifier: 'MIT' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'pin', scope: 'manifest', version: '1.2.3' },
  ]);
});

test('T216 parsers: composer.json extracts manifest and license', () => {
  const result = jsonArtifact('composer.json', {
    license: 'MIT',
    require: { php: '^8.0' },
  });
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'manifest').map((r) => r.details), [
    { ecosystem: 'php', format: 'composer_json' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'license').map((r) => r.details), [
    { declared: 'manifest', identifier: 'MIT' },
  ]);
});

// ---------------------------------------------------------------------------
// Parsers — lockfiles and pins/sources
// ---------------------------------------------------------------------------

test('T216 parsers: package-lock extracts lock, pins, and registry sources', () => {
  const result = jsonArtifact('package-lock.json', {
    lockfileVersion: 3,
    packages: {
      '': { name: 'demo', version: '1.0.0' },
      'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
    },
  });
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'lock').map((r) => r.details), [
    { format: 'npm' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'lodash', scope: 'lockfile', version: '4.17.21' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'source').map((r) => r.details), [
    { host: 'registry.npmjs.org', kind: 'registry', label: 'registry' },
  ]);
});

test('T216 parsers: Cargo.lock extracts lock, pins, and crates.io source', () => {
  const result = textArtifact('Cargo.lock', [
    'version = 3',
    '',
    '[[package]]',
    'name = "serde"',
    'version = "1.0.200"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'lock').map((r) => r.details), [
    { format: 'cargo' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'serde', scope: 'lockfile', version: '1.0.200' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'source').map((r) => r.details), [
    { host: 'github.com', kind: 'registry', label: 'crates.io' },
  ]);
});

test('T216 parsers: uv.lock and Pipfile.lock extract pins and sources', () => {
  const uv = textArtifact('uv.lock', [
    '[[package]]',
    'name = "requests"',
    'version = "2.31.0"',
    'source = { registry = "https://pypi.org/simple" }',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(uv).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'requests', scope: 'lockfile', version: '2.31.0' },
  ]);
  assert.deepEqual(recordsOf(uv).filter((r) => r.category === 'source').map((r) => r.details), [
    { host: 'pypi.org', kind: 'index', label: 'index' },
  ]);

  const pipfile = jsonArtifact('Pipfile.lock', {
    default: { requests: { version: '==2.31.0' } },
    _meta: { sources: [{ url: 'https://pypi.org/simple' }] },
  });
  assert.deepEqual(recordsOf(pipfile).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'requests', scope: 'lockfile', version: '==2.31.0' },
  ]);
});

test('T216 parsers: yarn.lock extracts pins and resolved sources', () => {
  const result = textArtifact('yarn.lock', [
    '"lodash@^4.17.21":',
    '  version "4.17.21"',
    '  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"',
    '',
  ].join('\n'));
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'lock').map((r) => r.details), [
    { format: 'yarn' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'pin').map((r) => r.details), [
    { package: 'lodash', scope: 'lockfile', version: '4.17.21' },
  ]);
});

test('T216 parsers: presence-only lockfiles are recorded without content parsing', () => {
  for (const [path, format] of [['go.sum', 'go'], ['Gemfile.lock', 'gemfile'], ['mix.lock', 'mix'], ['pnpm-lock.yaml', 'pnpm']]) {
    const result = textArtifact(path, 'opaque content');
    assert.deepEqual(recordsOf(result).filter((r) => r.category === 'lock').map((r) => r.details), [
      { format },
    ]);
    assert.deepEqual(diagnosticsOf(result), []);
  }
});

// ---------------------------------------------------------------------------
// Parsers — SBOM / VEX / SARIF and standards joins
// ---------------------------------------------------------------------------

test('T216 parsers: CycloneDX SBOM 1.7 projects safely and joins its standard', () => {
  const result = jsonArtifact('sbom.json', {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    metadata: { authors: [{ email: 'alice@example.test' }] },
    components: [{ name: 'pkg', version: '1.0.0', purl: 'pkg:npm/pkg@1.0.0', licenses: [{ license: { id: 'MIT' } }] }],
  });
  const sboms = recordsOf(result).filter((r) => r.category === 'sbom');
  assert.equal(sboms.length, 1);
  assert.equal(sboms[0].details.format, 'CycloneDX');
  assert.equal(sboms[0].details.specVersion, '1.7');
  assert.deepEqual(sboms[0].details.projection.packageCoordinates, ['pkg:npm/pkg@1.0.0']);
  assert.deepEqual(sboms[0].details.projection.licenses, ['MIT']);
  assert.equal(JSON.stringify(sboms[0]).includes('alice@example.test'), false, 'T206 projection strips contacts');
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'standard').map((r) => r.details.registryId), [
    'std:owasp-cyclonedx:1.7',
  ]);
});

test('T216 parsers: SPDX SBOM joins the SPDX standard; unknown spec versions never join', () => {
  const spdx = jsonArtifact('a.spdx.json', { spdxVersion: 'SPDX-2.3', packages: [{ name: 'pkg', versionInfo: '1.0.0', licenseConcluded: 'MIT' }] });
  assert.equal(recordsOf(spdx).filter((r) => r.category === 'sbom').length, 1);
  assert.deepEqual(recordsOf(spdx).filter((r) => r.category === 'standard').map((r) => r.details.registryId), [
    'std:spdx-spec:2.3.0',
  ]);
  const old = jsonArtifact('old.json', { bomFormat: 'CycloneDX', specVersion: '1.6', components: [] });
  assert.equal(recordsOf(old).filter((r) => r.category === 'standard').length, 0, '1.6 is not in the registry');
});

test('T216 parsers: VEX is projected to metadata only with no vulnerability content', () => {
  const result = jsonArtifact('openvex.json', {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': 'https://example.test/vex',
    statements: [
      { vulnerability: { id: 'CVE-2024-0001' }, status: 'not_affected', justification: 'component_not_present' },
      { vulnerability: { id: 'CVE-2024-0002' }, status: 'affected' },
    ],
  });
  const vexes = recordsOf(result).filter((r) => r.category === 'vex');
  assert.equal(vexes.length, 1);
  assert.equal(vexes[0].details.format, 'OpenVEX');
  assert.equal(vexes[0].details.specVersion, '0.2.0');
  assert.equal(vexes[0].details.statementCount, 2);
  const serialized = JSON.stringify(recordsOf(result));
  assert.equal(serialized.includes('CVE-'), false, 'vulnerability identifiers are never captured');
  assert.equal(/not_affected|affected|justification/i.test(serialized), false, 'no verdict language');
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'standard').map((r) => r.details.registryId), [
    'std:openvex-spec:0.2.0',
  ]);
});

test('T216 parsers: SARIF projects via T206 and joins its standard', () => {
  const result = jsonArtifact('result.sarif', {
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'safe-tool' } },
      results: [{ ruleId: 'RULE-1', message: { text: 'Alice Example' } }],
    }],
  });
  const sarifs = recordsOf(result).filter((r) => r.category === 'sarif');
  assert.equal(sarifs.length, 1);
  assert.equal(sarifs[0].details.version, '2.1.0');
  assert.equal(sarifs[0].details.projection.resultCount, 1);
  assert.equal(JSON.stringify(sarifs[0]).includes('Alice Example'), false, 'messages are stripped');
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'standard').map((r) => r.details.registryId), [
    'std:oasis-sarif:2.1.0-errata01',
  ]);
});

test('T216 parsers: unknown SBOM/VEX/SARIF schemas are unsupported diagnostics', () => {
  const unknownSbom = jsonArtifact('sbom.json', { title: 'not a known schema' });
  assert.deepEqual(diagnosticsOf(unknownSbom), [{ path: 'sbom.json', status: 'unsupported', reason: 'UNKNOWN_SCHEMA' }]);
  const unknownVex = jsonArtifact('openvex.json', { '@context': 'https://other.dev/ns', statements: [] });
  assert.deepEqual(diagnosticsOf(unknownVex), [{ path: 'openvex.json', status: 'unsupported', reason: 'UNKNOWN_SCHEMA' }]);
  const notSarif = jsonArtifact('a.sarif', { version: '2.0', runs: [] });
  assert.equal(recordsOf(notSarif).filter((r) => r.category === 'sarif').length, 1, '2.0 is still a SARIF document');
  assert.equal(recordsOf(notSarif).filter((r) => r.category === 'standard').length, 0);
});

// ---------------------------------------------------------------------------
// Parsers — configuration, tool results, accessibility, attestations, licenses
// ---------------------------------------------------------------------------

test('T216 parsers: tool configuration is presence-only with the tool name', () => {
  for (const [path, tool] of [['.gitleaks.toml', 'gitleaks'], ['osv-scanner.toml', 'osv-scanner'], ['.snyk', 'snyk'], ['dependency-check.properties', 'dependency-check']]) {
    const result = textArtifact(path, 'opaque rules content');
    assert.deepEqual(recordsOf(result), [{ category: 'configuration', path, status: 'observed', details: { tool } }], path);
    assert.deepEqual(diagnosticsOf(result), []);
  }
});

test('T216 parsers: tool results are presence-only and never expose content', () => {
  const result = textArtifact('osv-scanner-results.json', JSON.stringify({ results: [{ id: 'CVE-2024-0001' }] }));
  assert.deepEqual(recordsOf(result), [{
    category: 'tool_result', path: 'osv-scanner-results.json', status: 'observed',
    details: { format: 'json', tool: 'osv-scanner' },
  }]);
  assert.equal(JSON.stringify(recordsOf(result)).includes('CVE-'), false);
});

test('T216 parsers: accessibility statements declare WCAG and join its standard', () => {
  const result = textArtifact('accessibility.md', 'This site aims to follow WCAG 2.2 guidelines.\n');
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'accessibility').map((r) => r.details), [
    { declared: 'wcag:2.2', kind: 'statement' },
  ]);
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'standard').map((r) => r.details.registryId), [
    'std:w3c-wcag:2.2-rec-20241212',
  ]);
});

test('T216 parsers: accessibility without a declared version never joins a standard', () => {
  const result = textArtifact('a11y.md', 'Notes about accessible design.\n');
  assert.deepEqual(recordsOf(result).filter((r) => r.category === 'accessibility').map((r) => r.details), [
    { declared: null, kind: 'statement' },
  ]);
  assert.equal(recordsOf(result).filter((r) => r.category === 'standard').length, 0);
});

test('T216 parsers: attestations are presence-only with declared format and kind', () => {
  assert.deepEqual(recordsOf(textArtifact('a.intoto.jsonl', '{"_type":"https://in-toto.io/Statement/v1"}')).map((r) => r.details), [
    { format: 'in-toto', kind: 'statement' },
  ]);
  assert.deepEqual(recordsOf(textArtifact('build.att', 'opaque')).map((r) => r.details), [
    { format: 'in-toto', kind: 'link' },
  ]);
  assert.deepEqual(recordsOf(textArtifact('a.sigstore.json', 'opaque')).map((r) => r.details), [
    { format: 'sigstore', kind: 'bundle' },
  ]);
});

test('T216 parsers: license files are presence-only and manifest identifiers are bounded', () => {
  assert.deepEqual(recordsOf(textArtifact('LICENSE', 'opaque text')).map((r) => r.details), [
    { declared: 'file', identifier: null },
  ]);
  assert.deepEqual(recordsOf(textArtifact('COPYING', 'opaque')).map((r) => r.details), [
    { declared: 'file', identifier: null },
  ]);
});

test('T216 parsers: unsupported assurance-like content is a typed diagnostic, never a crash', () => {
  const result = extractAssuranceArtifact({ path: 'LICENSES.md', text: 'x', value: null, format: 'text' });
  assert.deepEqual(diagnosticsOf(result), [{ path: 'LICENSES.md', status: 'unsupported', reason: 'UNSUPPORTED' }]);
  const malformedPackage = jsonArtifact('package.json', { license: 'MIT' });
  assert.deepEqual(malformedPackage.records.length > 0, true);
});

// ---------------------------------------------------------------------------
// Provider (T210 base)
// ---------------------------------------------------------------------------

test('T216 provider: emits only DIM-assurance categories via the provider foundation', () => {
  const model = buildAssuranceModel({
    records: [
      { category: 'manifest', path: 'package.json', status: 'observed', details: { format: 'package_json', ecosystem: 'javascript' } },
      { category: 'sbom', path: 'sbom.json', status: 'observed', details: { format: 'CycloneDX', specVersion: '1.7', projection: { format: 'CycloneDX', specVersion: '1.7', componentCount: 1, licenses: [], packageCoordinates: ['pkg@1.0.0'] } } },
      { category: 'standard', path: 'sbom.json', status: 'observed', details: { registryId: 'std:owasp-cyclonedx:1.7', editionKey: '1.7', disposition: 'metadata_only' } },
    ],
    measurement: { filesInspected: 2 },
  });
  const results = assuranceProviderResult(model);
  assert.equal(results.length, 1);
  const providerResult = results[0];
  assert.equal(providerResult.providerId, ASSURANCE_PROVIDER_ID);
  assert.equal(providerResult.dimensionId, 'DIM-assurance-v1');
  assert.equal(Object.isFrozen(providerResult), true);
  assert.equal(Object.isFrozen(providerResult.observations), true);
  for (const observation of providerResult.observations) {
    assert.ok(PROVIDER_CATEGORIES['DIM-assurance-v1'].includes(observation.category));
    assert.ok(EVIDENCE_SOURCE_KINDS.includes(observation.sourceKind));
  }
  const categories = new Set(providerResult.observations.map(({ category }) => category));
  assert.deepEqual([...categories].sort(), ['manifest', 'sbom', 'standard']);
});

test('T216 provider: deterministic, immutable, and empty for empty/foreign input', () => {
  const model = buildAssuranceModel({
    records: [{ category: 'manifest', path: 'package.json', status: 'observed', details: { format: 'package_json', ecosystem: 'javascript' } }],
    measurement: { filesInspected: 1 },
  });
  const first = assuranceProviderResult(model);
  const second = assuranceProviderResult(model);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(assuranceProviderResult(null), []);
  assert.deepEqual(assuranceObservations({}), []);
  const emptyModel = buildAssuranceModel({ records: [], measurement: { filesInspected: 0 } });
  assert.deepEqual(assuranceProviderResult(emptyModel)[0].observations, []);
});

// ---------------------------------------------------------------------------
// Renderer (INERT factory)
// ---------------------------------------------------------------------------

test('T216 renderer: neutral inert factory renders the model without verdicts', () => {
  const model = buildAssuranceModel({
    records: [
      { category: 'manifest', path: 'package.json', status: 'observed', details: { format: 'package_json', ecosystem: 'javascript' } },
      { category: 'standard', path: 'sbom.json', status: 'observed', details: { registryId: 'std:owasp-cyclonedx:1.7', editionKey: '1.7', disposition: 'metadata_only' } },
    ],
    diagnostics: [{ path: 'broken.json', status: 'malformed', reason: 'MALFORMED' }],
    measurement: { filesInspected: 3 },
  });
  const output = createAssuranceRenderer().render(model);
  assert.ok(output.startsWith('## Assurance & Supply Chain'));
  assert.ok(output.includes('package_json'));
  assert.ok(output.includes('std:owasp-cyclonedx:1.7'));
  assert.ok(output.includes('metadata_only'));
  assert.ok(output.includes('MALFORMED'));
  assert.ok(output.includes('malformed'));
  assert.equal(output.includes('\r'), false);
  assert.deepEqual(findVoiceHits(output), []);
  const noInput = renderAssurance('repo', null);
  assert.equal(noInput, '');
});

test('T216 renderer: empty model renders a factual no-detected line', () => {
  const model = buildAssuranceModel({ records: [], measurement: { filesInspected: 4 } });
  const output = createAssuranceRenderer().render(model);
  assert.match(output, /No declared supply-chain evidence detected in 4 inspected file\(s\)\./);
  assert.deepEqual(findVoiceHits(output), []);
});

test('T216 renderer: deterministic byte-identical output and invalid context rejection', () => {
  const model = buildAssuranceModel({
    records: [{ category: 'manifest', path: 'package.json', status: 'observed', details: { format: 'package_json', ecosystem: 'javascript' } }],
    measurement: { filesInspected: 1 },
  });
  const first = renderAssurance('x', model);
  const second = renderAssurance('x', model);
  assert.equal(first, second);
  assert.throws(() => createAssuranceRenderer({ context: {} }), /escapeField/);
  assert.equal(Object.isFrozen(createAssuranceRenderer()), true);
});

test('T216 renderer is INERT: not registered in write or existing-ten renderers', async () => {
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP).sort(), [
    'architecture', 'config', 'conventions', 'documentation', 'git',
    'operations', 'security', 'stack', 'structure', 'testing',
  ]);
  assert.equal(EXISTING_TEN_RENDERER_MAP.assurance, undefined);
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  assert.equal(existingTen.includes('render/assurance.mjs'), false, 'existing-ten must not import the assurance renderer');
  const write = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  assert.equal(write.includes('render/assurance.mjs'), false, 'write must not import the assurance renderer');
});

// ---------------------------------------------------------------------------
// Scanner — end-to-end fixtures
// ---------------------------------------------------------------------------

test('T216 scanner: full inventory fixture across pins, sources, locks, licenses, SBOM, SARIF, accessibility', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'demo', license: 'MIT', dependencies: { lodash: '4.17.21' } }),
    'requirements.txt': 'requests==2.31.0\n--index-url https://pypi.org/simple\n',
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/lodash': { version: '4.17.21' } } }),
    'Cargo.lock': 'version = 3\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n',
    'LICENSE': 'opaque',
    'sbom.json': JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.7', components: [{ name: 'pkg', version: '1.0.0' }] }),
    'a.sarif': JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'tool' } }, results: [] }] }),
    'accessibility.md': 'WCAG 2.2 statement\n',
    '.gitleaks.toml': 'title = "gitleaks"',
    'osv-scanner-results.json': JSON.stringify({ results: [{ id: 'CVE-2024-0001' }] }),
    'a.intoto.jsonl': '{"_type":"https://in-toto.io/Statement/v1"}',
    'src/main.js': 'export function f() {}',
  };
  await withFixture('assurance-full', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    const { model } = result;
    assert.equal(model.summary.manifests, 2);
    assert.equal(model.summary.locks, 2);
    assert.equal(model.summary.pins, 4);
    assert.equal(model.summary.sources, 1);
    assert.equal(model.summary.licenses, 2);
    assert.equal(model.summary.sboms, 1);
    assert.equal(model.summary.sarifs, 1);
    assert.equal(model.summary.configurations, 1);
    assert.equal(model.summary.toolResults, 1);
    assert.equal(model.summary.accessibility, 1);
    assert.equal(model.summary.attestations, 1);
    assert.equal(model.summary.standards, 3);
    assert.equal(model.summary.diagnostics, 0);
    assert.equal(model.searchSpace.complete, true);
    const serialized = JSON.stringify(model);
    assert.equal(serialized.includes(dir), false, 'absolute paths never appear');
    assert.equal(serialized.includes('CVE-'), false, 'tool result content never appears');
  });
});

test('T216 scanner: malformed result artifacts never invalidate manifest evidence', async () => {
  const files = {
    'package.json': JSON.stringify({ license: 'MIT', dependencies: { lodash: '4.17.21' } }),
    'sbom.json': 'not valid json at all',
    'a.sarif': '{ broken',
    'openvex.json': 'also broken',
    'requirements.txt': 'requests==2.31.0\n',
  };
  await withFixture('assurance-malformed', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    const { model, artifacts } = result;
    assert.equal(model.summary.manifests, 2, 'manifest evidence survives');
    assert.equal(model.summary.pins, 2, 'manifest and requirements pins survive');
    assert.equal(model.summary.sboms, 0);
    assert.equal(model.summary.sarifs, 0);
    assert.equal(model.summary.vexes, 0);
    assert.ok(model.diagnostics.length >= 3, 'malformed results are disclosed');
    const malformed = artifacts.filter((entry) => entry.status === 'malformed').map(({ path }) => path);
    assert.deepEqual(malformed.sort(), ['a.sarif', 'openvex.json', 'sbom.json']);
  });
});

test('T216 scanner: unsupported and unreadable peers are diagnostics without erasing valid evidence', async () => {
  const files = {
    'package.json': JSON.stringify({ license: 'MIT' }),
    'not-an-assurance-file.txt': 'ignored',
    'requirements.txt': 'requests==2.31.0\n',
  };
  await withFixture('assurance-atomicity', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    assert.equal(result.model.summary.manifests, 2, 'package.json and requirements.txt are both manifests');
    assert.equal(result.model.summary.pins, 1);
    assert.ok(result.model.manifest.every((entry) => entry.path !== 'not-an-assurance-file.txt'));
  });
});

test('T216 scanner: privacy canaries never reach the model or provider', async () => {
  const files = {
    'package.json': JSON.stringify({
      name: 'demo',
      license: 'MIT',
      dependencies: { 'alice@example.test': '1.0.0' },
    }),
    'sbom.json': JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      metadata: { authors: [{ email: 'alice@example.test' }] },
      components: [{ name: 'safe', version: '1.0.0', externalReferences: [{ url: 'https://user:pass@example.test/repo' }] }],
    }),
    'a.sarif': JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'tool' } }, results: [{ message: { text: 'Alice Example private file /home/alice/x' } }] }],
    }),
  };
  await withFixture('assurance-privacy', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    const { model } = result;
    const serialized = JSON.stringify(model);
    for (const canary of ['alice@example.test', 'user:pass', '/home/alice', 'Alice Example', dir]) {
      assert.equal(serialized.includes(canary), false, `canary leaked: ${canary}`);
    }
    assert.equal(model.summary.sboms, 1, 'projected SBOM survives');
    assert.equal(model.summary.sarifs, 1, 'projected SARIF survives');
    const providerResult = assuranceProviderResult(model)[0];
    assert.equal(JSON.stringify(providerResult).includes('alice@example.test'), false);
  });
});

test('T216 scanner: deterministic repeated runs are byte-identical and T202-compatible', async () => {
  const files = {
    'package.json': JSON.stringify({ license: 'MIT', dependencies: { lodash: '4.17.21' } }),
    'requirements.txt': 'requests==2.31.0\n--index-url https://pypi.org/simple\n',
    'sbom.json': JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.7', components: [{ name: 'pkg', version: '1.0.0' }] }),
  };
  await withFixture('assurance-determinism', files, async (dir) => {
    const first = await scanAssurance({ root: dir, files: Object.keys(files) });
    const second = await scanAssurance({ root: dir, files: Object.keys(files) });
    assert.equal(JSON.stringify(first.model), JSON.stringify(second.model));
    assert.equal(Object.isFrozen(first.model), true);
    assert.deepEqual(Object.keys(first.model.searchSpace).sort(), [
      'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
      'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
      'recordLimit', 'recordsInspected', 'supported',
    ]);
    assert.equal(first.model.searchSpace.complete, true);
    assert.equal(first.model.searchSpace.supported, true);
    assert.equal(first.model.searchSpace.readable, true);
  });
});

test('T216 scanner: cap fixtures disclose truncation and never drop silently', async () => {
  const pins = {};
  for (let index = 0; index < ASSURANCE_LIMITS.pins + 20; index++) {
    pins[`pkg-${index}`] = '1.0.0';
  }
  const files = { 'package.json': JSON.stringify({ dependencies: pins }) };
  await withFixture('assurance-cap', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    assert.equal(result.model.summary.pins, ASSURANCE_LIMITS.pins);
    assert.equal(result.model.summary.capped.pins, true);
    assert.equal(result.model.cappedTotal, true);
    assert.equal(result.model.summary.records, ASSURANCE_LIMITS.pins + 1);
  });
});

test('T216 scanner: binary lockfiles are presence-only and never fail decoding', async () => {
  const files = { 'bun.lockb': Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]) };
  await withFixture('assurance-binary', files, async (dir) => {
    const result = await scanAssurance({ root: dir, files: Object.keys(files) });
    assert.deepEqual(result.model.lock.map(({ details }) => details.format), ['bun']);
    assert.deepEqual(result.model.diagnostics, []);
  });
});

test('T216 scanner: explicit requests drive the scan without discovery', async () => {
  const files = { 'package.json': JSON.stringify({ license: 'MIT' }) };
  await withFixture('assurance-requests', files, async (dir) => {
    const result = await scanAssurance({ root: dir, requests: [{ path: 'package.json', format: 'json', sensitivity: 'internal' }] });
    assert.equal(result.model.summary.manifests, 1);
    assert.equal(result.model.summary.licenses, 1);
  });
});

// ---------------------------------------------------------------------------
// Inertness and source policy
// ---------------------------------------------------------------------------

test('T216 inertness: assurance modules never touch fs, child_process, or execution surfaces', async () => {
  const owned = [
    'lib/scan/deep/assurance/model.mjs',
    'lib/scan/deep/assurance/parsers.mjs',
    'lib/scan/deep/assurance/scanner.mjs',
    'lib/scan/providers/assurance.mjs',
    'lib/scan/render/assurance.mjs',
    'lib/scan/standards/assurance-pack.mjs',
  ];
  for (const relative of owned) {
    const source = await readFile(join(LIB_ROOT, '..', relative), 'utf8');
    for (const forbidden of [
      "from 'node:fs", "from 'node:child_process", "from 'node:process", "from 'node:vm",
      "from 'node:module", 'require(', 'execFile(', 'execSync(', 'spawn(', 'writeFile(',
    ]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not contain ${forbidden}`);
    }
  }
  const providerSource = await readFile(join(LIB_ROOT, 'scan', 'providers', 'assurance.mjs'), 'utf8');
  const rendererSource = await readFile(join(LIB_ROOT, 'scan', 'render', 'assurance.mjs'), 'utf8');
  for (const source of [providerSource, rendererSource]) {
    for (const surface of ['scan(', 'run(', 'execute(', 'writeNORMS', 'enrich(', 'validate(']) {
      assert.equal(source.includes(surface), false, 'inert modules expose no execution surfaces');
    }
  }
});

test('T216 standards pack: only registered metadata-only registry IDs are referenced', () => {
  const serialized = JSON.stringify(ASSURANCE_STANDARD_JOINS);
  for (const registryId of [
    'std:owasp-cyclonedx:1.7', 'std:spdx-spec:2.3.0', 'std:openvex-spec:0.2.0',
    'std:oasis-sarif:2.1.0-errata01', 'std:w3c-wcag:2.2-rec-20241212',
  ]) {
    assert.ok(serialized.includes(registryId), registryId);
  }
  assert.equal(serialized.includes('std:owasp-asvs:5.0.0'), false, 'no control-claiming standards are referenced');
  assert.equal(serialized.includes('std:pci-dss:4.0.1'), false);
  assert.equal(serialized.includes('std:iso-iec-27001:2022'), false);
  assert.equal(serialized.includes('std:aicpa-soc2-tsc:2017-rpof-2022'), false);
});
