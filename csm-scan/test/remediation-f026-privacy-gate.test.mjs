// F-026 — the fail-before-write privacy gate now covers the ten legacy
// dimension models via an explicit structural allowlist.
//
// Before this fix assertFindingsPrivacy skipped every legacy dimension, so a
// legacy-scanner leak only surfaced in combination with a render-sanitizer gap.
// After the fix legacy models pass a value-level gate (assertLegacyPrivacySafe)
// enforcing the one invariant every legacy model documents — repository-relative
// paths only. Absolute host paths are rejected; underscore-prefixed internal
// keys, emails embedded in relative paths, bare scopes, scoped names, detection
// labels, and pre-render secret shapes (which the F-025-unified render redactor
// handles) are allowed.
//
// Seeded fixtures only.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertLegacyPrivacySafe } from '../lib/scan/shared/privacy.mjs';
import { assertFindingsPrivacy } from '../lib/scan/pipeline/run.mjs';

test('F-026: the legacy allowlist accepts legitimate legacy-model content', () => {
  assert.doesNotThrow(() => assertLegacyPrivacySafe({
    labels: ['Basic Auth URL', 'Frame Options', 'Content Type Options'],
    deps: ['@scope/pkg', '@typescript-eslint', 'pydantic', 'aws-sdk'],
    docs: ['docs/alice@example.test.md', 'README.md'],
    layers: { _repoPath: '/host/internal/path', coreModules: ['src/a.js'] },
    thresholds: 'diff-cover fail_under=80',
    spec: 'AKIA\x49OSFODNN7EXAMPLE', // pre-render secret shape; render redactor handles it
  }));
});

test('F-026: the legacy gate rejects absolute host paths in legacy values', () => {
  for (const value of [
    { path: '/abs/host/path/secret' },
    { path: 'C:\\Windows\\system' },
    { path: '\\\\server\\share' },
  ]) {
    assert.throws(
      () => assertLegacyPrivacySafe(value),
      (error) => error && error.code === 'SENSITIVE_VALUE',
      `expected absolute path to be rejected: ${JSON.stringify(value)}`,
    );
  }
});

test('F-026: assertFindingsPrivacy rejects a legacy dimension leak before the write', () => {
  const findings = {
    generated: '2026-01-01',
    repos: [{
      overview: { name: 'leaky-legacy', path: '.', languages: [], totalFiles: 0 },
      deep: [{
        dimension: 'documentation',
        signal: 'high',
        findings: {
          readme: { path: 'README.md' },
          sourceRoot: '/abs/host/leak',
        },
      }],
    }],
    global: { metrics: { repositories: 0, components: 0, edges: 0, selfEdges: 0, crossRepositoryEdges: 0, external: 0, ambiguous: 0, unresolved: 0 } },
  };
  assert.throws(
    () => assertFindingsPrivacy(findings),
    (error) => error && error.code === 'PRIVACY_LEAK',
    'a legacy dimension leak must abort with PRIVACY_LEAK',
  );
});

test('F-026: assertFindingsPrivacy accepts legacy findings that are structurally clean', () => {
  const findings = {
    generated: '2026-01-01',
    repos: [{
      overview: { name: 'clean', path: '.', languages: [], totalFiles: 0 },
      deep: [{
        dimension: 'documentation',
        signal: 'high',
        findings: {
          readme: { path: 'README.md', sections: 2 },
          docs: ['docs/alice@example.test.md'],
          license: { name: 'MIT' },
          layers: { _repoPath: '/host/internal' },
        },
      }],
    }],
    global: { metrics: { repositories: 0, components: 0, edges: 0, selfEdges: 0, crossRepositoryEdges: 0, external: 0, ambiguous: 0, unresolved: 0 } },
  };
  assert.doesNotThrow(() => assertFindingsPrivacy(findings));
});
