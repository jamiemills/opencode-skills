// T221 — inert cross-repository identity and edge synthesis.
//
// Owned by T221. Tests the privacy-safe repository/component identity
// normalization (`lib/scan/cross-repo/identity.mjs`), the exact reference
// resolution and global snapshot (`lib/scan/cross-repo/edges.mjs`), and the
// inert renderer factory (`lib/scan/cross-repo/render.mjs`).
//
// Scope (own-only): this test file plus the three cross-repo modules. Nothing
// else is edited or registered.
//
// Guarantees verified here:
//   1. Exact single-candidate references resolve to edges; zero candidates
//      remain external; multiple candidates remain ambiguous.
//   2. Ambiguity and unresolved/duplicate identities never enter graph metrics.
//   3. Duplicate scan ids and duplicate canonical repository ids produce
//      unresolved records that are never candidates.
//   4. Self references resolve to self-edges, counted separately from
//      cross-repository edges.
//   5. Scoped references disambiguate repos that share a short name.
//   6. Input order does not matter: reversed input yields byte-identical output,
//      including tied records that differ only in sourceKind.
//   7. Privacy: credentials, absolute paths, emails, identities, and
//      secret-style tokens/path segments never reach the snapshot; every
//      emitted record (external and ambiguous included) passes the T206 privacy
//      gate.
//   8. Determinism and caps: repeated runs are byte-identical and candidate /
//      edge / external / ambiguous / reference lists are capped with disclosed
//      flags.
//   9. Immutability: every output is deep-frozen.
//  10. Inertness: no production module imports the cross-repo modules; the
//      renderer is an unregistered inert factory; modules avoid the T201
//      forbidden capabilities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPrivacySafe } from '../lib/scan/shared/privacy.mjs';
import {
  CrossRepoError,
  IDENTITY_LIMITS,
  normalizeComponentRoots,
  normalizePackageCoordinates,
  normalizeVcsCoordinates,
  synthesizeRepositoryIdentities,
  vcsCoordinate,
} from '../lib/scan/cross-repo/identity.mjs';
import {
  EDGE_LIMITS,
  resolveReferences,
  synthesizeCrossRepository,
} from '../lib/scan/cross-repo/edges.mjs';
import {
  createCrossRepositoryRenderer,
  renderCrossRepositoryGlobal,
} from '../lib/scan/cross-repo/render.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

function synth(repositories, references) {
  return synthesizeCrossRepository({ repositories, references });
}

// ---------------------------------------------------------------------------
// Exact resolution
// ---------------------------------------------------------------------------

const EXACT_REPOS = [
  {
    scanId: 'scan:web',
    vcs: 'https://github.com/acme/web.git',
    componentRoots: ['packages/web'],
    manifests: [{ ecosystem: 'npm', name: 'web', version: '1.0.0', root: 'packages/web' }],
    workspaceNames: ['web'],
    contracts: ['order-service-v1'],
    events: ['orders.created'],
  },
  {
    scanId: 'scan:worker',
    vcs: 'git@github.com:acme/worker.git',
    contracts: ['ingest-task-v1'],
    events: ['ingest.completed'],
  },
];

const EXACT_REFS = [
  { scanId: 'scan:web', kind: 'vcs', value: 'git@github.com:acme/worker.git', path: 'package.json', sourceKind: 'manifest' },
  { scanId: 'scan:worker', kind: 'vcs', value: 'https://github.com/acme/web.git', path: 'Cargo.toml', sourceKind: 'manifest' },
  { scanId: 'scan:web', kind: 'path', value: './packages/web', path: '.', sourceKind: 'manifest' },
  { scanId: 'scan:web', kind: 'workspace', value: 'web', path: 'package.json', sourceKind: 'manifest' },
  { scanId: 'scan:worker', kind: 'contract', value: 'order-service-v1', path: 'proto/ingest.proto', sourceKind: 'contract' },
  { scanId: 'scan:web', kind: 'event', value: 'ingest.completed', path: 'worker-link.json', sourceKind: 'workflow' },
];

test('T221 exact: single-candidate references resolve to canonical sanitized edges', () => {
  const snapshot = synth(EXACT_REPOS, EXACT_REFS);
  const edges = snapshot.edges.edges;
  assert.equal(edges.length, 6);
  assert.equal(snapshot.metrics.edges, 6);
  assert.equal(snapshot.metrics.external, 0);
  assert.equal(snapshot.metrics.ambiguous, 0);
  assert.equal(snapshot.metrics.unresolved, 0);

  const byCoordinate = Object.fromEntries(edges.map((edge) => [edge.coordinate, edge]));
  const vcsEdge = byCoordinate['vcs:github.com/acme/worker'];
  assert.equal(vcsEdge.sourceRepository, 'vcs:github.com/acme/web');
  assert.equal(vcsEdge.targetRepository, 'vcs:github.com/acme/worker');
  assert.equal(vcsEdge.targetId, 'repository:vcs:github.com/acme/worker');
  assert.equal(vcsEdge.self, false);
  assert.equal(byCoordinate['vcs:github.com/acme/web'].sourceRepository, 'vcs:github.com/acme/worker');

  const pathEdge = byCoordinate['path:packages/web'];
  assert.equal(pathEdge.targetId, 'component:vcs:github.com/acme/web:packages/web');
  assert.equal(pathEdge.self, true);
  assert.equal(byCoordinate['workspace:web'].targetKind, 'component');

  const contractEdge = byCoordinate['contract:order-service-v1'];
  assert.equal(contractEdge.targetRepository, 'vcs:github.com/acme/web');
  assert.equal(contractEdge.self, false);
  assert.equal(byCoordinate['event:ingest.completed'].targetRepository, 'vcs:github.com/acme/worker');
  assert.equal(byCoordinate['event:ingest.completed'].sourceRepository, 'vcs:github.com/acme/web');
});

test('T221 exact: edge ids are deterministic SHA-256 hashes of canonical content', () => {
  const first = synth(EXACT_REPOS, EXACT_REFS);
  const second = synth(EXACT_REPOS, EXACT_REFS);
  assert.deepEqual(first.edges.edges.map(({ id }) => id), second.edges.edges.map(({ id }) => id));
  for (const edge of first.edges.edges) {
    assert.match(edge.id, /^EDG-v1-[a-f0-9]{64}$/);
  }
});

test('T221 exact: metrics count cross-repository and self edges separately', () => {
  const snapshot = synth(EXACT_REPOS, EXACT_REFS);
  const selfEdges = snapshot.edges.edges.filter((edge) => edge.self).length;
  assert.equal(snapshot.metrics.selfEdges, selfEdges);
  assert.equal(snapshot.metrics.crossRepositoryEdges, snapshot.metrics.edges - selfEdges);
  assert.equal(snapshot.metrics.crossRepositoryEdges + snapshot.metrics.selfEdges, snapshot.metrics.edges);
});

// ---------------------------------------------------------------------------
// Unresolved / external records
// ---------------------------------------------------------------------------

test('T221 unresolved: zero-candidate and unparseable references remain external records', () => {
  const snapshot = synth(
    [{ scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' }],
    [
      { scanId: 'scan:web', kind: 'vcs', value: 'https://github.com/acme/unknown.git', path: 'package.json', sourceKind: 'manifest' },
      { scanId: 'scan:web', kind: 'path', value: 'no/such/root', path: '.', sourceKind: 'manifest' },
      { scanId: 'scan:web', kind: 'workspace', value: '*', path: 'package.json', sourceKind: 'manifest' },
    ],
  );
  assert.equal(snapshot.edges.edges.length, 0);
  assert.equal(snapshot.metrics.edges, 0);
  assert.equal(snapshot.metrics.external, 3);
  const byReason = Object.fromEntries(snapshot.edges.external.map((record) => [record.reason, record]));
  assert.equal(byReason.no_candidates.kind, 'vcs');
  assert.equal(byReason.no_candidates.coordinate, 'vcs:github.com/acme/unknown');
  assert.equal(byReason.no_candidates.sourceRepository, 'vcs:github.com/acme/web');
  assert.equal(byReason.unparseable.coordinate, null);
  assert.equal(byReason.unparseable.kind, 'workspace');
});

test('T221 unresolved: references from an unknown owner remain external records', () => {
  const snapshot = synth(
    [{ scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' }],
    [{ scanId: 'scan:ghost', kind: 'vcs', value: 'github.com/acme/web', path: '.', sourceKind: 'manifest' }],
  );
  assert.equal(snapshot.metrics.external, 1);
  assert.equal(snapshot.edges.external[0].reason, 'unknown_owner');
  assert.equal(snapshot.edges.edges.length, 0);
});

// ---------------------------------------------------------------------------
// Ambiguous references (excluded from graph metrics)
// ---------------------------------------------------------------------------

const AMBIGUOUS_REPOS = [
  { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git', componentRoots: ['packages/web'] },
  { scanId: 'scan:site', vcs: 'https://github.com/acme/site.git', componentRoots: ['packages/web'] },
  { scanId: 'scan:gateway', vcs: 'https://github.com/acme/gateway.git' },
];

test('T221 ambiguous: multiple candidates remain ambiguous and never enter graph metrics', () => {
  const snapshot = synth(AMBIGUOUS_REPOS, [
    { scanId: 'scan:gateway', kind: 'path', value: 'packages/web', path: '.', sourceKind: 'config' },
    { scanId: 'scan:gateway', kind: 'vcs', value: 'github.com/acme/web', path: '.', sourceKind: 'config' },
  ]);
  assert.equal(snapshot.edges.ambiguous.length, 1);
  const ambiguous = snapshot.edges.ambiguous[0];
  assert.equal(ambiguous.kind, 'path');
  assert.equal(ambiguous.coordinate, 'path:packages/web');
  assert.equal(ambiguous.candidateCount, 2);
  assert.equal(ambiguous.candidates.length, 2);
  assert.deepEqual(ambiguous.candidates, [
    'component:vcs:github.com/acme/site:packages/web',
    'component:vcs:github.com/acme/web:packages/web',
  ]);
  assert.equal(ambiguous.candidatesCapped, false);

  assert.equal(snapshot.metrics.ambiguous, 1);
  assert.equal(snapshot.metrics.edges, 1, 'only the exact vcs reference is an edge');
  assert.equal(snapshot.edges.edges[0].coordinate, 'vcs:github.com/acme/web');
  assert.equal(
    snapshot.edges.edges.some((edge) => edge.coordinate === 'path:packages/web'),
    false,
    'ambiguous reference is excluded from the edge list',
  );
});

// ---------------------------------------------------------------------------
// Duplicate identities
// ---------------------------------------------------------------------------

test('T221 duplicate: same scan id produces unresolved records that are never candidates', () => {
  const snapshot = synth(
    [
      { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' },
      { scanId: 'scan:web', vcs: 'https://github.com/acme/other.git' },
    ],
    [{ scanId: 'scan:web', kind: 'vcs', value: 'github.com/acme/web', path: '.', sourceKind: 'manifest' }],
  );
  assert.equal(snapshot.identityTable.repositories.length, 0);
  assert.equal(snapshot.metrics.unresolved, 2);
  assert.ok(snapshot.identityTable.unresolved.every((record) => record.reason === 'duplicate_scan_id'));
  assert.equal(snapshot.metrics.repositories, 0);
  assert.equal(snapshot.metrics.external, 1, 'references to duplicate identities stay external');
});

test('T221 duplicate: missing scan ids produce unresolved missing_identity records', () => {
  const identities = synthesizeRepositoryIdentities([
    { vcs: 'https://github.com/acme/web.git' },
    { scanId: 'alice@example.com', vcs: 'https://github.com/acme/site.git' },
    { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' },
    { scanId: 'scan:web-mirror', vcs: 'https://github.com/acme/web.git' },
  ]);
  assert.equal(identities.repositories.length, 0);
  assert.equal(identities.unresolved.length, 4);
  assert.equal(identities.unresolved.filter((record) => record.reason === 'missing_identity').length, 2);
  assert.equal(identities.unresolved.filter((record) => record.reason === 'duplicate_identity').length, 2);
});

test('T221 duplicate-repo: identical canonical VCS coordinates are duplicates regardless of transport', () => {
  const snapshot = synth(
    [
      { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' },
      { scanId: 'scan:web-mirror', vcs: 'git@github.com:acme/web.git' },
      { scanId: 'scan:client', vcs: 'https://github.com/acme/client.git' },
    ],
    [{ scanId: 'scan:client', kind: 'vcs', value: 'github.com/acme/web', path: '.', sourceKind: 'config' }],
  );
  assert.equal(snapshot.metrics.unresolved, 2);
  assert.ok(snapshot.identityTable.unresolved.every((record) => record.reason === 'duplicate_identity'));
  assert.deepEqual(
    snapshot.identityTable.repositories.map((repo) => repo.repositoryId),
    ['vcs:github.com/acme/client'],
  );
  assert.equal(snapshot.metrics.external, 1, 'reference to a duplicate-repo coordinate is external');
  assert.equal(snapshot.metrics.edges, 0);
});

// ---------------------------------------------------------------------------
// Scoped references
// ---------------------------------------------------------------------------

test('T221 scoped: fully scoped references disambiguate repositories that share a short name', () => {
  const snapshot = synth(
    [
      { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' },
      { scanId: 'scan:mirror', vcs: 'https://gitlab.example.com/acme/web.git' },
      { scanId: 'scan:client', vcs: 'https://github.com/acme/client.git' },
    ],
    [
      { scanId: 'scan:client', kind: 'vcs', value: 'github.com/acme/web', path: '.', sourceKind: 'config' },
      { scanId: 'scan:client', kind: 'vcs', value: 'git@gitlab.example.com:acme/web.git', path: '.', sourceKind: 'config' },
    ],
  );
  const coordinates = snapshot.edges.edges.map((edge) => edge.coordinate).sort();
  assert.deepEqual(coordinates, ['vcs:github.com/acme/web', 'vcs:gitlab.example.com/acme/web']);
  const webEdge = snapshot.edges.edges.find((edge) => edge.coordinate === 'vcs:github.com/acme/web');
  const mirrorEdge = snapshot.edges.edges.find((edge) => edge.coordinate === 'vcs:gitlab.example.com/acme/web');
  assert.equal(webEdge.targetRepository, 'vcs:github.com/acme/web');
  assert.equal(mirrorEdge.targetRepository, 'vcs:gitlab.example.com/acme/web');
  assert.equal(snapshot.metrics.ambiguous, 0, 'scoped references are exact, never ambiguous');
});

// ---------------------------------------------------------------------------
// Self edges
// ---------------------------------------------------------------------------

test('T221 self-edge: references to the owning repository resolve to self-edges', () => {
  const snapshot = synth(
    [
      {
        scanId: 'scan:web',
        vcs: 'https://github.com/acme/web.git',
        componentRoots: ['packages/web'],
        manifests: [{ ecosystem: 'npm', name: 'web', root: 'packages/web' }],
      },
    ],
    [
      { scanId: 'scan:web', kind: 'vcs', value: 'https://github.com/acme/web.git', path: '.', sourceKind: 'repository_metadata' },
      { scanId: 'scan:web', kind: 'path', value: 'packages/web', path: '.', sourceKind: 'manifest' },
    ],
  );
  assert.equal(snapshot.metrics.edges, 2);
  assert.equal(snapshot.metrics.selfEdges, 2);
  assert.equal(snapshot.metrics.crossRepositoryEdges, 0);
  assert.ok(snapshot.edges.edges.every((edge) => edge.self === true));
});

// ---------------------------------------------------------------------------
// Reverse input order (determinism)
// ---------------------------------------------------------------------------

test('T221 reverse-order: reversed repository and reference order is byte-identical', () => {
  const forward = synth(EXACT_REPOS, EXACT_REFS);
  const reversed = synth([...EXACT_REPOS].reverse(), [...EXACT_REFS].reverse());
  assert.equal(JSON.stringify(forward), JSON.stringify(reversed));

  const tiedRepos = [
    { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git', componentRoots: ['packages/web'] },
    { scanId: 'scan:site', vcs: 'https://github.com/acme/site.git', componentRoots: ['packages/web'] },
    { scanId: 'scan:client', vcs: 'https://github.com/acme/client.git' },
  ];
  const tiedReferences = [
    { scanId: 'scan:client', kind: 'path', value: 'packages/web', path: 'link.json', sourceKind: 'manifest' },
    { scanId: 'scan:client', kind: 'path', value: 'packages/web', path: 'link.json', sourceKind: 'config' },
    { scanId: 'scan:client', kind: 'workspace', value: 'orphan-ws', path: 'package.json', sourceKind: 'workflow' },
    { scanId: 'scan:client', kind: 'workspace', value: 'orphan-ws', path: 'package.json', sourceKind: 'manifest' },
    { scanId: 'scan:client', kind: 'workspace', value: 'orphan-ws', path: 'package.json', sourceKind: 'config' },
  ];
  const forwardTied = synth(tiedRepos, tiedReferences);
  const reversedTied = synth(tiedRepos, [...tiedReferences].reverse());
  assert.equal(JSON.stringify(forwardTied), JSON.stringify(reversedTied),
    'tied records differing only in sourceKind sort byte-identically under reversed input');
  const externalKinds = forwardTied.edges.external.map((record) => record.sourceKind);
  assert.deepEqual(externalKinds, [...externalKinds].sort(), 'tied external records sort by sourceKind');
  const ambiguousKinds = forwardTied.edges.ambiguous.map((record) => record.sourceKind);
  assert.deepEqual(ambiguousKinds, [...ambiguousKinds].sort(), 'tied ambiguous records sort by sourceKind');
});

test('T221 determinism: repeated synthesis produces byte-identical snapshots', () => {
  const first = synth(AMBIGUOUS_REPOS, [
    { scanId: 'scan:gateway', kind: 'path', value: 'packages/web', path: '.', sourceKind: 'config' },
  ]);
  const second = synth(AMBIGUOUS_REPOS, [
    { scanId: 'scan:gateway', kind: 'path', value: 'packages/web', path: '.', sourceKind: 'config' },
  ]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test('T221 privacy: credentials, absolute paths, and identities never reach the snapshot', () => {
  const snapshot = synth(
    [
      {
        scanId: 'scan:web',
        vcs: 'https://alice:s3cr3t-t0ken@github.com/acme/web.git',
        componentRoots: ['/home/alice/code/web/packages/api', 'packages/api'],
        manifests: [{ ecosystem: 'npm', name: 'alice@example.com', version: '^1.0.0' }],
        workspaceNames: ['alice@example.com'],
      },
    ],
    [
      { scanId: 'scan:web', kind: 'vcs', value: 'https://bob:p%40ssw0rd@github.com/acme/worker.git', path: 'package.json', sourceKind: 'manifest' },
      { scanId: 'scan:web', kind: 'path', value: '/etc/passwd', path: 'config.yaml', sourceKind: 'config' },
    ],
  );

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'alice', 'bob', 's3cr3t-t0ken', 'p%40ssw0rd',
    '/home/alice', '/etc/passwd', 'alice@example.com', 'code/web',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }

  const webRepo = snapshot.identityTable.repositories[0];
  assert.equal(webRepo.repositoryId, 'vcs:github.com/acme/web', 'credentials are stripped from the VCS coordinate');
  assert.deepEqual(webRepo.componentRoots, ['packages/api'], 'absolute component root is dropped');
  assert.deepEqual(webRepo.packageCoordinates, [], 'email-like package names are dropped');

  const external = snapshot.edges.external;
  const vcsExternal = external.find((record) => record.kind === 'vcs');
  assert.equal(vcsExternal.coordinate, 'vcs:github.com/acme/worker', 'reference credentials are stripped');
  const pathExternal = external.find((record) => record.kind === 'path');
  assert.equal(pathExternal.coordinate, null, 'absolute path reference stays unparseable');
  assert.equal(pathExternal.reason, 'unparseable');

  assert.ok(assertPrivacySafe(snapshot), 'entire snapshot passes the T206 privacy gate');
});

test('T221 privacy: secret-style workspace references are dropped as unparseable and never emitted', () => {
  const snapshot = synth(
    [{ scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' }],
    [
      { scanId: 'scan:web', kind: 'workspace', value: 'token:ghp_\x740kenVaLue123', path: 'package.json', sourceKind: 'manifest' },
      { scanId: 'scan:web', kind: 'workspace', value: 'api_key:AKIA\x490S3CR3TKEY', path: 'package.json', sourceKind: 'manifest' },
      { scanId: 'scan:ghost', kind: 'workspace', value: 'token:ghp_\x75nknownOwner', path: 'package.json', sourceKind: 'manifest' },
    ],
  );
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'ghp_\x740kenVaLue123', 'AKIA\x490S3CR3TKEY', 'ghp_\x75nknownOwner', 'token:', 'api_key:',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
  const unparseable = snapshot.edges.external.filter((record) => record.reason === 'unparseable');
  assert.equal(unparseable.length, 2);
  assert.ok(unparseable.every((record) => record.kind === 'workspace' && record.coordinate === null),
    'secret-style workspace references stay unparseable with a null coordinate');
  assert.equal(snapshot.edges.external.some((record) => record.reason === 'unknown_owner'), true);
  assert.equal(snapshot.edges.edges.length, 0);
  assert.equal(snapshot.metrics.external, 3);
  assert.ok(assertPrivacySafe(snapshot), 'entire snapshot passes the T206 privacy gate');
});

test('T221 privacy: identity and edge primitives sanitize VCS coordinates', () => {
  const vcs = normalizeVcsCoordinates('https://carol:topsecret@github.com/acme/web.git#readme');
  assert.deepEqual(vcs, { host: 'github.com', namespace: 'acme', repo: 'web' });
  assert.equal(vcsCoordinate(vcs), 'vcs:github.com/acme/web');
  assert.equal(vcsCoordinate(normalizeVcsCoordinates('git@github.com:acme/web.git')), 'vcs:github.com/acme/web');
  assert.equal(normalizeVcsCoordinates('file:///srv/git/web.git'), null);
  assert.equal(normalizeVcsCoordinates('/srv/git/web.git'), null);
  assert.equal(normalizeVcsCoordinates('../web'), null);
  assert.equal(normalizeVcsCoordinates('https://github.com/acme'), null);
});

test('T221 privacy: package and component root normalization drops unsafe entries', () => {
  const packages = normalizePackageCoordinates([
    { ecosystem: 'node', name: '@acme/web', version: '1.0.0' },
    { ecosystem: 'python', name: 'rich', version: '>=3.10' },
    { ecosystem: 'javascript', name: 'leak@example.com', version: '1.0.0' },
  ]);
  assert.deepEqual(packages, ['package:pkg:npm/@acme/web@1.0.0', 'package:pkg:pypi/rich']);
  assert.deepEqual(normalizeComponentRoots(['packages/web', '/tmp/web', 'packages/../escape', './apps/site', 'apps/site']),
    ['apps/site', 'packages/web']);
});

// ---------------------------------------------------------------------------
// Caps and determinism of bounded lists
// ---------------------------------------------------------------------------

test('T221 caps: edge and reference lists are capped with disclosed flags', () => {
  const targets = [];
  const references = [];
  for (let index = 0; index < EDGE_LIMITS.edges + 200; index++) {
    const name = `target-${String(index).padStart(4, '0')}`;
    targets.push({ scanId: `scan:${name}`, vcs: `https://github.com/acme/${name}.git` });
    references.push({ scanId: 'scan:client', kind: 'vcs', value: `github.com/acme/${name}`, path: '.', sourceKind: 'config' });
  }
  const snapshot = synth(
    [{ scanId: 'scan:client', vcs: 'https://github.com/acme/client.git' }, ...targets],
    references,
  );
  assert.equal(snapshot.capped.edges, true);
  assert.equal(snapshot.edges.edges.length, EDGE_LIMITS.edges);
  assert.equal(snapshot.metrics.edges, EDGE_LIMITS.edges);
  assert.equal(snapshot.metrics.repositories, targets.length + 1);
});

test('T221 caps: candidate lists are capped at the explicit bound with full counts disclosed', () => {
  const repos = [{ scanId: 'scan:gateway', vcs: 'https://github.com/acme/gateway.git' }];
  for (let index = 0; index < EDGE_LIMITS.candidates + 20; index++) {
    repos.push({ scanId: `scan:repo-${index}`, vcs: `https://github.com/acme/repo-${index}.git`, componentRoots: ['packages/web'] });
  }
  const snapshot = synth(repos, [
    { scanId: 'scan:gateway', kind: 'path', value: 'packages/web', path: '.', sourceKind: 'config' },
  ]);
  assert.equal(snapshot.capped.candidates, true);
  const ambiguous = snapshot.edges.ambiguous[0];
  assert.equal(ambiguous.candidateCount, EDGE_LIMITS.candidates + 20);
  assert.equal(ambiguous.candidates.length, EDGE_LIMITS.candidates);
  assert.equal(ambiguous.candidatesCapped, true);
  assert.equal(snapshot.metrics.ambiguous, 1);
  assert.equal(snapshot.metrics.edges, 0, 'candidate-capped ambiguity still never enters graph metrics');
});

test('T221 caps: external references are capped and the reference input bound is disclosed', () => {
  const references = [];
  for (let index = 0; index < EDGE_LIMITS.references + 500; index++) {
    references.push({ scanId: 'scan:web', kind: 'vcs', value: 'github.com/acme/unknown', path: '.', sourceKind: 'config' });
  }
  const snapshot = synth([{ scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' }], references);
  assert.equal(snapshot.capped.references, true);
  assert.equal(snapshot.capped.external, true);
  assert.equal(snapshot.edges.external.length, EDGE_LIMITS.external);
  assert.equal(snapshot.metrics.external, EDGE_LIMITS.external);
});

test('T221 caps: ambiguous records are capped and sorted deterministically', () => {
  const repos = [
    { scanId: 'scan:client', vcs: 'https://github.com/acme/client.git' },
    { scanId: 'scan:web', vcs: 'https://github.com/acme/web.git', componentRoots: ['packages/web'] },
    { scanId: 'scan:site', vcs: 'https://github.com/acme/site.git', componentRoots: ['packages/web'] },
  ];
  const references = [];
  for (let index = 0; index < EDGE_LIMITS.ambiguous + 50; index++) {
    references.push({
      scanId: 'scan:client',
      kind: 'path',
      value: 'packages/web',
      path: `refs/${index}.json`,
      sourceKind: 'config',
    });
  }
  const snapshot = synth(repos, references);
  assert.equal(snapshot.capped.ambiguous, true);
  assert.equal(snapshot.edges.ambiguous.length, EDGE_LIMITS.ambiguous);
  assert.equal(snapshot.metrics.ambiguous, EDGE_LIMITS.ambiguous);
  assert.equal(snapshot.metrics.edges, 0);
  const paths = snapshot.edges.ambiguous.map((record) => record.path);
  assert.deepEqual(paths, [...paths].sort(), 'ambiguous records are deterministically sorted');
});

test('T221 caps: identity synthesis enforces the repository bound', () => {
  const many = [];
  for (let index = 0; index < IDENTITY_LIMITS.identities + 2; index++) {
    many.push({ scanId: `scan:${index}`, vcs: `https://github.com/acme/r-${index}.git` });
  }
  assert.throws(() => synthesizeRepositoryIdentities(many),
    (error) => error instanceof CrossRepoError && error.code === 'BOUND_EXCEEDED');
});

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

test('T221 errors: unknown reference kinds and malformed references fail closed with typed errors', () => {
  const snapshot = synth([{ scanId: 'scan:web', vcs: 'https://github.com/acme/web.git' }], []);
  assert.throws(() => resolveReferences({
    identities: snapshot.identityTable,
    references: [{ scanId: 'scan:web', kind: 'fuzzy', value: 'x', path: null, sourceKind: 'config' }],
  }), (error) => error instanceof CrossRepoError && error.code === 'UNKNOWN_KIND');
  assert.throws(() => resolveReferences({
    identities: snapshot.identityTable,
    references: [{ scanId: 'scan:web', kind: 'vcs', value: '', path: null, sourceKind: 'config' }],
  }), (error) => error instanceof CrossRepoError && error.code === 'INVALID_VALUE');
  assert.throws(() => resolveReferences({
    identities: snapshot.identityTable,
    references: [{ scanId: 'scan:web', kind: 'vcs', value: 'x', path: null, extra: true, sourceKind: 'config' }],
  }), (error) => error instanceof CrossRepoError && error.code === 'UNKNOWN_FIELD');
  assert.throws(() => synthesizeCrossRepository(null),
    (error) => error instanceof CrossRepoError && error.code === 'INVALID_TYPE');
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test('T221 immutability: snapshot, identities, edges, and metrics are deep-frozen', () => {
  const snapshot = synth(EXACT_REPOS, EXACT_REFS);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.identityTable));
  assert.ok(Object.isFrozen(snapshot.identityTable.repositories));
  assert.ok(Object.isFrozen(snapshot.identityTable.repositories[0]));
  assert.ok(Object.isFrozen(snapshot.identityTable.repositories[0].coordinates));
  assert.ok(Object.isFrozen(snapshot.identityTable.components[0]));
  assert.ok(Object.isFrozen(snapshot.edges.edges[0]));
  assert.ok(Object.isFrozen(snapshot.edges.external));
  assert.ok(Object.isFrozen(snapshot.metrics));
  assert.throws(() => snapshot.edges.edges.pop(), TypeError);
  assert.throws(() => { snapshot.metrics.edges = 0; }, TypeError);
  assert.throws(() => { snapshot.identityTable.repositories[0].repositoryId = 'mutated'; }, TypeError);
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

test('T221 render: factory produces deterministic neutral-factual Markdown', () => {
  const snapshot = synth(EXACT_REPOS, EXACT_REFS);
  const renderer = createCrossRepositoryRenderer();
  const first = renderer.render(snapshot);
  const second = renderer.render(snapshot);
  assert.equal(first, second);
  assert.match(first, /^## Cross-repository Architecture\n/);
  assert.match(first, /Resolved edges: 6/);
  assert.match(first, /### Repository identities \(2\)/);
  assert.match(first, /### Resolved edges \(6\)/);
  assert.match(first, /### Unresolved identities \(0\)/);
  assert.ok(first.includes('cross-repository'), 'scope labels are disclosed');
  assert.ok(first.includes('self'), 'self scope is disclosed');
  assert.ok(!first.includes('Recommendation'), 'no prescriptive prose');
  assert.equal(renderCrossRepositoryGlobal('repository', null), '');
});

test('T221 render: rendered output avoids judgmental prose', () => {
  const snapshot = synth(EXACT_REPOS, EXACT_REFS);
  const markdown = createCrossRepositoryRenderer().render(snapshot);
  const banned = [
    'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
    'better', 'worse', 'recommended', 'recommendation', 'ideally', 'unfortunately',
    'concern', 'concerning', 'problem', 'anti-pattern', 'smell', 'suboptimal',
    'inadequate', 'insufficient', 'contradiction', 'inconsistent', 'conflict', 'lacking',
  ];
  const pattern = new RegExp(`\\b(?:${banned.join('|')})\\b`, 'gi');
  assert.deepEqual(markdown.match(pattern) ?? [], []);
});

test('T221 render: factory rejects invalid render contexts and returns frozen renderers', () => {
  assert.throws(() => createCrossRepositoryRenderer({ context: null }), TypeError);
  assert.throws(() => createCrossRepositoryRenderer({ context: {} }), TypeError);
  const renderer = createCrossRepositoryRenderer();
  assert.ok(Object.isFrozen(renderer));
});

// ---------------------------------------------------------------------------
// Inertness — unregistered, capability-closed, and dependency-free
// ---------------------------------------------------------------------------

async function libScanFiles() {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
    }
  }
  await visit(join(LIB_ROOT, 'scan'));
  return files.sort();
}

function relativeImportTargets(source) {
  const targets = [];
  const pattern = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

test('T221 inert: no production module outside cross-repo imports the cross-repo modules', async () => {
  const files = await libScanFiles();
  const crossRepoDir = join(LIB_ROOT, 'scan', 'cross-repo');
  const activatedConsumers = new Set([
    join(LIB_ROOT, 'scan', 'pipeline', 'run.mjs'),
  ]);
  for (const file of files) {
    if (dirname(file) === crossRepoDir) continue;
    if (activatedConsumers.has(file)) continue;
    const source = await readFile(file, 'utf8');
    const resolved = relativeImportTargets(source).map((target) => join(dirname(file), target));
    for (const crossRepoFile of ['identity.mjs', 'edges.mjs', 'render.mjs']) {
      const target = join(crossRepoDir, crossRepoFile);
      assert.ok(!resolved.includes(target), `${file.replace(/\\/g, '/')} imports cross-repo/${crossRepoFile}`);
    }
  }
});

test('T221 inert: cross-repo modules avoid T201 forbidden capabilities on import', async () => {
  for (const file of ['identity.mjs', 'edges.mjs', 'render.mjs']) {
    const path = join(LIB_ROOT, 'scan', 'cross-repo', file);
    const source = await readFile(path, 'utf8');
    for (const forbidden of ['node:fs', 'node:child_process', 'node:process', 'node:vm', 'node:module']) {
      assert.ok(!source.includes(`'${forbidden}'`), `${file} must not import ${forbidden}`);
    }
    assert.ok(!/\brequire\s*\(/.test(source), `${file} must not use require`);
    assert.ok(!/\bimport\s*\(/.test(source), `${file} must not use dynamic import`);
    assert.equal(source.includes('writeFile'), false, `${file} must not write`);
    assert.equal(source.includes('writeNORMS'), false, `${file} must not invoke the writer`);
  }
});

test('T221 inert: the renderer factory is never registered in the production renderer map', async () => {
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  const write = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  assert.equal(existingTen.includes('cross-repo'), false);
  assert.equal(existingTen.includes('CrossRepository'), false);
  assert.equal(write.includes('cross-repo'), false);
  assert.equal(write.includes('CrossRepository'), false);
});

test('T221 inert: modules export data and pure factories, never execution surfaces', async () => {
  const identitySource = await readFile(join(LIB_ROOT, 'scan', 'cross-repo', 'identity.mjs'), 'utf8');
  const edgesSource = await readFile(join(LIB_ROOT, 'scan', 'cross-repo', 'edges.mjs'), 'utf8');
  for (const source of [identitySource, edgesSource]) {
    for (const forbidden of ['execute(', 'writeFile', 'writeNORMS']) {
      assert.equal(source.includes(forbidden), false, `cross-repo module exposes execution surface ${forbidden}`);
    }
  }
  assert.match(identitySource, /export\s+(?:function|const)\s+synthesizeRepositoryIdentities\b/);
  assert.match(edgesSource, /export\s+(?:function|const)\s+synthesizeCrossRepository\b/);
  assert.match(edgesSource, /export\s+(?:function|const)\s+resolveReferences\b/);
  assert.match(identitySource, /export\s+(?:function|const)\s+normalizeVcsCoordinates\b/);
});
