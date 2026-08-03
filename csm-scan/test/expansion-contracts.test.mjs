import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPLICABILITY_FIELDS,
  assertDataOnly,
  CLAIM_STATUSES,
  ClaimContractError,
  computeCoverage,
  CONTRACT_LIMITS,
  COVERAGE_STATES,
  DIMENSION_IDS,
  DimensionContractError,
  PROVIDER_DIMENSION_COUNT,
  PROVIDER_DIMENSION_IDS,
  TOTAL_DIMENSION_COUNT,
  validateClaim,
  validateClaims,
  validateDimension,
  validateDimensions,
} from '../lib/scan/contracts/dimension.mjs';
import {
  createEvidence,
  createEvidenceId,
  DATA_LIMITS,
  DIMENSION_EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORIES,
  EVIDENCE_LIMITS,
  EvidenceContractError,
  normalizeEvidencePath,
  validateEvidence,
  validateEvidenceList,
} from '../lib/scan/contracts/evidence.mjs';
import {
  PROVIDER_CATEGORIES,
  ProviderContractError,
  validateProvider,
  validateProviders,
} from '../lib/scan/contracts/provider.mjs';

const SEARCH_OK = Object.freeze({
  supported: true,
  readable: true,
  complete: true,
  capped: false,
  error: false,
  malformed: false,
  ambiguous: false,
  filesInspected: 3,
  fileLimit: 100,
  bytesInspected: 300,
  byteLimit: 10_000,
  recordsInspected: 5,
  recordLimit: 1_000,
  omittedCount: 0,
});

const SEARCH_UNSUPPORTED = Object.freeze({
  ...SEARCH_OK,
  supported: false,
  readable: false,
  complete: false,
  filesInspected: 0,
  bytesInspected: 0,
  recordsInspected: 0,
});

const SEARCH_CAPPED = Object.freeze({
  ...SEARCH_OK,
  complete: false,
  capped: true,
  filesInspected: 100,
  omittedCount: 2,
});

function claimIdForDimension(id) {
  return `CLM-${id.slice(4, -3)}-expected-v1`;
}

function definition(id, expectedClaimIds = [claimIdForDimension(id)], applicability) {
  return {
    id,
    order: DIMENSION_IDS.indexOf(id),
    expectedClaimIds,
    applicability: applicability ?? {
      mode: 'all',
      rules: [{ field: 'repository_kind', operator: 'equals', value: 'source' }],
    },
    retryable: true,
    providerCapability: PROVIDER_DIMENSION_IDS.includes(id),
    rendererId: `RND-${id.slice(4, -3)}-v1`,
  };
}

function registry(apiClaimIds = ['CLM-api-expected-v1'], apiApplicability) {
  return DIMENSION_IDS.map((id) => definition(
    id,
    id === 'DIM-api-v1' ? apiClaimIds : [claimIdForDimension(id)],
    id === 'DIM-api-v1' ? apiApplicability : undefined,
  ));
}

function evidence(claimId, category = 'route', details = null, suffix = category, sourceKind) {
  return createEvidence({
    claimId,
    detectorId: 'DET-contract-fixture-v1',
    sourceKind: sourceKind ?? (category === 'search_space' ? 'search_result' : 'source'),
    category,
    path: 'src/example.mjs',
    locator: `line:1:${suffix}`,
    matchedKey: `key:${suffix}`,
    details,
  });
}

function rawClaim(id, status, records, overrides = {}) {
  const coverage = {
    observed: 'complete', inferred: 'complete', not_detected: 'complete',
    unsupported: 'unsupported', unverified: 'incomplete', not_applicable: 'excluded',
  }[status];
  return {
    id,
    dimensionId: 'DIM-api-v1',
    status,
    coverageState: coverage,
    evidenceIds: records.map(({ id: evidenceId }) => evidenceId),
    inputEvidenceIds: [],
    applicabilityEvidenceIds: [],
    derivationId: null,
    limitations: [],
    searchSpace: null,
    ...overrides,
  };
}

function applicabilityEvidence(claimId, facts, suffix = 'applicability') {
  return evidence(
    claimId,
    'applicability',
    { facts },
    suffix,
    'repository_metadata',
  );
}

test('T202R1 exported schema snapshot is exact, complete, and inert', () => {
  assert.deepEqual(CLAIM_STATUSES, [
    'observed', 'inferred', 'not_detected', 'unsupported', 'unverified', 'not_applicable',
  ]);
  assert.deepEqual(COVERAGE_STATES, ['complete', 'incomplete', 'unsupported', 'excluded']);
  assert.equal(TOTAL_DIMENSION_COUNT, 17);
  assert.equal(PROVIDER_DIMENSION_COUNT, 15);
  assert.equal(DIMENSION_IDS.length, 17);
  assert.equal(PROVIDER_DIMENSION_IDS.length, 15);
  assert.deepEqual(DIMENSION_IDS.filter((id) => !PROVIDER_DIMENSION_IDS.includes(id)), [
    'DIM-structure-v1', 'DIM-git-v1',
  ]);
  assert.deepEqual(APPLICABILITY_FIELDS, [
    'artifact_kind', 'ecosystem', 'is_git', 'language', 'repository_kind',
  ]);
  assert.equal(Object.isFrozen(CONTRACT_LIMITS), true);
  assert.equal(Object.isFrozen(EVIDENCE_LIMITS), true);
  assert.equal(Object.keys(PROVIDER_CATEGORIES).length, 15);
  for (const categories of Object.values(PROVIDER_CATEGORIES)) {
    for (const category of categories) assert.ok(EVIDENCE_CATEGORIES.includes(category), category);
  }
});

test('T202R1 complete registry owns exact dimensions, order, flags, claims, and renderers', () => {
  const input = registry();
  const validated = validateDimensions(input);
  input[10].expectedClaimIds.push('CLM-mutated-v1');
  input[10].applicability.rules[0].value = 'mutated';
  assert.deepEqual(validated.map(({ id }) => id), DIMENSION_IDS);
  assert.deepEqual(validated[10].expectedClaimIds, ['CLM-api-expected-v1']);
  assert.equal(validated[10].applicability.rules[0].value, 'source');
  assert.equal(Object.isFrozen(validated[10].applicability.rules[0]), true);
  assert.throws(() => validated.reverse(), TypeError);
});

test('T202R1 partial, unknown, reordered, mismatched, and duplicate registries fail closed', () => {
  assert.throws(() => validateDimensions(registry().slice(0, 16)), /exactly 17/);
  const unknown = registry();
  unknown[0] = { ...unknown[0], id: 'DIM-unknown-v1' };
  assert.throws(() => validateDimensions(unknown), /not registered/);
  const reordered = registry();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => validateDimensions(reordered), /order is not canonical/);
  assert.throws(() => validateDimension({ ...definition('DIM-api-v1'), order: 0 }), /order is not canonical/);
  assert.throws(() => validateDimension({
    ...definition('DIM-api-v1'), providerCapability: false,
  }), /providerCapability/);
  const renderer = registry();
  renderer[1] = { ...renderer[1], rendererId: renderer[0].rendererId };
  assert.throws(() => validateDimensions(renderer), /renderer identifiers/);
  const duplicateClaim = registry();
  duplicateClaim[1] = { ...duplicateClaim[1], expectedClaimIds: duplicateClaim[0].expectedClaimIds };
  assert.throws(() => validateDimensions(duplicateClaim), /globally unique/);
});

test('T202R1 evidence IDs bind category and canonical structured details', () => {
  const fields = {
    claimId: 'CLM-api-hash-v1',
    detectorId: 'DET-routes-v1',
    sourceKind: 'contract',
    category: 'route',
    path: 'api/openapi.yaml',
    locator: 'operation:users-list',
    matchedKey: 'GET:/users',
    details: null,
  };
  const first = createEvidence(fields);
  assert.equal(first.id, createEvidenceId(fields));
  assert.match(first.id, /^EVD-v1-[a-f0-9]{64}$/);
  assert.notEqual(first.id, createEvidenceId({ ...fields, category: 'rpc' }));

  const search = evidence('CLM-api-search-v1', 'search_space', SEARCH_OK);
  const changed = evidence('CLM-api-search-v1', 'search_space', { ...SEARCH_OK, filesInspected: 4 });
  assert.notEqual(search.id, changed.id);
  assert.equal(Object.isFrozen(search.details), true);
  assert.throws(() => { search.details.filesInspected = 0; }, TypeError);
});

test('T202R1 canonical evidence validation rejects forgery, relabeling, and detail mutation', () => {
  const valid = evidence('CLM-api-forgery-v1');
  assert.throws(() => validateEvidence({ ...valid, id: `EVD-v1-${'0'.repeat(64)}` }), /canonical evidence content/);
  assert.throws(() => validateEvidence({ ...valid, category: 'rpc' }), /canonical evidence content/);
  const search = evidence('CLM-api-forgery-search-v1', 'search_space', SEARCH_OK);
  assert.throws(() => validateEvidence({
    ...search, details: { ...search.details, recordsInspected: 6 },
  }), /canonical evidence content/);

  const claimId = 'CLM-api-forged-claim-v1';
  const forged = { ...evidence(claimId), id: `EVD-v1-${'0'.repeat(64)}` };
  const claims = registry([claimId]);
  assert.throws(() => validateClaims([
    rawClaim(claimId, 'observed', [forged]),
  ], [forged], claims), (error) => error instanceof ClaimContractError && error.code === 'INVALID_EVIDENCE');
  assert.throws(() => validateEvidenceList([valid, valid]), /duplicate identifier/);
});

test('T202R1 evidence paths, schemas, search counts, and sensitive fields are bounded', () => {
  for (const path of ['/etc/passwd', 'C:/secret', '//server/share', '../secret', 'src/../secret', './src', 'src\\file', 'src\0file']) {
    assert.throws(() => normalizeEvidencePath(path), EvidenceContractError, path);
  }
  assert.throws(() => evidence(
    'CLM-api-bad-count-v1', 'search_space', { ...SEARCH_OK, filesInspected: 101, fileLimit: 100 },
  ), /must not exceed/);
  assert.throws(() => evidence(
    'CLM-api-bad-limit-v1', 'search_space', { ...SEARCH_OK, fileLimit: 0 },
  ), /explicit search bound/);
  assert.throws(() => evidence(
    'CLM-api-bad-omitted-v1', 'search_space', { ...SEARCH_OK, complete: false, omittedCount: 1 },
  ), /require a capped search/);
  const secret = 'token-super-secret-value';
  const valid = evidence('CLM-api-sensitive-v1');
  assert.throws(
    () => validateEvidence({ ...valid, rawValue: secret }),
    (error) => error instanceof EvidenceContractError && !error.message.includes(secret),
  );
  assert.throws(() => validateEvidenceList(Array(EVIDENCE_LIMITS.count + 1).fill(valid)), /bounded/);
});

test('T202R1 six statuses accept mutually exclusive canonical evidence', () => {
  const ids = [
    'CLM-api-observed-v1', 'CLM-api-inferred-v1', 'CLM-api-absence-v1',
    'CLM-api-unsupported-v1', 'CLM-api-unverified-v1', 'CLM-api-na-v1',
  ];
  const observedEvidence = evidence(ids[0]);
  const inferredEvidence = evidence(ids[1], 'contract', null, 'input', 'contract');
  const absenceEvidence = evidence(ids[2], 'search_space', SEARCH_OK);
  const unsupportedEvidence = evidence(ids[3], 'search_space', SEARCH_UNSUPPORTED);
  const unverifiedEvidence = evidence(ids[4], 'search_space', SEARCH_CAPPED);
  const naEvidence = applicabilityEvidence(ids[5], [
    { field: 'repository_kind', present: true, value: 'metadata' },
  ]);
  const records = [
    observedEvidence, inferredEvidence, absenceEvidence, unsupportedEvidence,
    unverifiedEvidence, naEvidence,
  ];
  const claims = [
    rawClaim(ids[0], 'observed', [observedEvidence]),
    rawClaim(ids[1], 'inferred', [inferredEvidence], {
      inputEvidenceIds: [inferredEvidence.id], derivationId: 'DRV-api-from-contract-v1',
    }),
    rawClaim(ids[2], 'not_detected', [absenceEvidence], { searchSpace: SEARCH_OK }),
    rawClaim(ids[3], 'unsupported', [unsupportedEvidence], {
      searchSpace: SEARCH_UNSUPPORTED, limitations: ['format is unsupported'],
    }),
    rawClaim(ids[4], 'unverified', [unverifiedEvidence], {
      searchSpace: SEARCH_CAPPED, limitations: ['search cap reached'],
    }),
    rawClaim(ids[5], 'not_applicable', [naEvidence], {
      applicabilityEvidenceIds: [naEvidence.id],
    }),
  ];
  const result = validateClaims(claims, records, registry(ids));
  assert.deepEqual(result.map(({ status }) => status).sort(), [...CLAIM_STATUSES].sort());
  assert.equal(Object.isFrozen(result[0]), true);
  assert.throws(() => result.pop(), TypeError);
});

test('T202R1 search statuses reject cap, failure, unsupported overlap, omission, and mismatch', () => {
  const id = 'CLM-api-search-status-v1';
  const dimension = definition('DIM-api-v1', [id]);
  for (const cause of [
    { complete: false },
    { complete: false, capped: true },
    { complete: false, error: true },
    { complete: false, readable: false },
    { complete: false, malformed: true },
    { complete: false, ambiguous: true },
  ]) {
    const details = { ...SEARCH_OK, ...cause };
    const record = evidence(id, 'search_space', details, JSON.stringify(cause).replace(/[^a-z]/gi, '') || 'cause');
    assert.throws(() => validateClaim(
      rawClaim(id, 'not_detected', [record], { searchSpace: details }), [record], dimension,
    ), /does not match claim status/);
  }

  const unsupported = evidence(id, 'search_space', SEARCH_UNSUPPORTED, 'unsupported');
  assert.throws(() => validateClaim(
    rawClaim(id, 'unverified', [unsupported], { searchSpace: SEARCH_UNSUPPORTED }), [unsupported], dimension,
  ), /does not match claim status/);

  const omitted = { ...SEARCH_CAPPED, complete: false, omittedCount: 2 };
  const omittedEvidence = evidence(id, 'search_space', omitted, 'omitted');
  assert.throws(() => validateClaim(
    rawClaim(id, 'not_detected', [omittedEvidence], { searchSpace: omitted }), [omittedEvidence], dimension,
  ), /does not match claim status/);

  const matching = evidence(id, 'search_space', SEARCH_OK, 'mismatch');
  const different = { ...SEARCH_OK, filesInspected: 4 };
  assert.throws(() => validateClaim(
    rawClaim(id, 'not_detected', [matching], { searchSpace: different }), [matching], dimension,
  ), /must be identical/);
});

test('T202R1 applicability evaluates all operators and rejects unrelated or insufficient facts', () => {
  const cases = [
    ['equals', 'source', { present: true, value: 'metadata' }],
    ['not_equals', 'source', { present: true, value: 'source' }],
    ['in', ['source', 'library'], { present: true, value: 'metadata' }],
    ['exists', true, { present: false, value: null }],
  ];
  for (const [operator, value, fact] of cases) {
    const id = `CLM-api-app-${operator.replace('_', '-')}-v1`;
    const dimension = definition('DIM-api-v1', [id], {
      mode: 'all', rules: [{ field: 'repository_kind', operator, value }],
    });
    const record = applicabilityEvidence(id, [{ field: 'repository_kind', ...fact }], operator);
    const result = validateClaim(rawClaim(id, 'not_applicable', [record], {
      applicabilityEvidenceIds: [record.id],
    }), [record], dimension);
    assert.equal(result.status, 'not_applicable');
  }

  const id = 'CLM-api-app-negative-v1';
  const dimension = definition('DIM-api-v1', [id]);
  const unrelated = applicabilityEvidence(id, [{ field: 'language', present: true, value: 'rust' }], 'unrelated');
  assert.throws(() => validateClaim(rawClaim(id, 'not_applicable', [unrelated], {
    applicabilityEvidenceIds: [unrelated.id],
  }), [unrelated], dimension), /unrelated facts/);
  const trueFact = applicabilityEvidence(id, [
    { field: 'repository_kind', present: true, value: 'source' },
  ], 'true');
  assert.throws(() => validateClaim(rawClaim(id, 'not_applicable', [trueFact], {
    applicabilityEvidenceIds: [trueFact.id],
  }), [trueFact], dimension), /does not prove/);

  const anyDimension = definition('DIM-api-v1', [id], {
    mode: 'any',
    rules: [
      { field: 'repository_kind', operator: 'equals', value: 'source' },
      { field: 'language', operator: 'equals', value: 'rust' },
    ],
  });
  const insufficient = applicabilityEvidence(id, [
    { field: 'repository_kind', present: true, value: 'metadata' },
  ], 'insufficient');
  assert.throws(() => validateClaim(rawClaim(id, 'not_applicable', [insufficient], {
    applicabilityEvidenceIds: [insufficient.id],
  }), [insufficient], anyDimension), /does not prove/);

  const absent = applicabilityEvidence(id, [
    { field: 'repository_kind', present: false, value: null },
  ], 'absent');
  assert.throws(() => validateClaim(rawClaim(id, 'not_applicable', [absent, trueFact], {
    applicabilityEvidenceIds: [absent.id, trueFact.id],
  }), [absent, trueFact], dimension), /conflicting facts/);
});

test('T202R1 inference requires a derivation ID and direct canonical inputs', () => {
  const id = 'CLM-api-inference-v1';
  const dimension = definition('DIM-api-v1', [id]);
  const direct = evidence(id, 'contract', null, 'direct', 'contract');
  assert.throws(() => validateClaim(rawClaim(id, 'inferred', [direct], {
    inputEvidenceIds: [direct.id], derivationId: null,
  }), [direct], dimension), /derivationId/);
  const search = evidence(id, 'search_space', SEARCH_OK, 'search-only');
  assert.throws(() => validateClaim(rawClaim(id, 'inferred', [search], {
    inputEvidenceIds: [search.id], derivationId: 'DRV-search-only-v1',
  }), [search], dimension), /direct canonical input/);
  assert.throws(() => validateClaim(rawClaim(id, 'observed', [direct], {
    derivationId: 'DRV-not-allowed-v1',
  }), [direct], dimension), /only direct canonical evidence/);
  const applicability = applicabilityEvidence(id, [
    { field: 'repository_kind', present: true, value: 'metadata' },
  ]);
  assert.throws(() => validateClaim(rawClaim(id, 'observed', [applicability]), [applicability], dimension), /only direct/);
});

test('T202R1 aggregate claims enforce registry ownership and one canonical evidence universe', () => {
  const id = 'CLM-api-owned-v1';
  const record = evidence(id);
  const dimensions = registry([id]);
  const valid = rawClaim(id, 'observed', [record]);
  assert.equal(validateClaims([valid], [record], dimensions)[0].id, id);
  assert.throws(() => validateClaims([
    { ...valid, dimensionId: 'DIM-stack-v1' },
  ], [record], dimensions), /not owned/);
  assert.throws(() => validateClaims([
    { ...valid, dimensionId: 'DIM-unknown-v1' },
  ], [record], dimensions), /not registered/);
  assert.throws(() => validateClaims([
    { ...valid, id: 'CLM-api-not-expected-v1' },
  ], [record], dimensions), /not owned/);
  assert.throws(() => validateClaims([valid, valid], [record], dimensions), /duplicate identifiers/);
});

test('T202R1 coverage requires registry, canonical claims, and registry-owned denominator', () => {
  const observedId = 'CLM-api-coverage-observed-v1';
  const unsupportedId = 'CLM-api-coverage-unsupported-v1';
  const excludedId = 'CLM-api-coverage-excluded-v1';
  const missingId = 'CLM-api-coverage-missing-v1';
  const dimensions = registry([observedId, unsupportedId, excludedId, missingId]);
  const observed = evidence(observedId);
  const unsupported = evidence(unsupportedId, 'search_space', SEARCH_UNSUPPORTED);
  const excluded = applicabilityEvidence(excludedId, [
    { field: 'repository_kind', present: true, value: 'metadata' },
  ]);
  const records = [observed, unsupported, excluded];
  const claims = [
    rawClaim(observedId, 'observed', [observed]),
    rawClaim(unsupportedId, 'unsupported', [unsupported], { searchSpace: SEARCH_UNSUPPORTED }),
    rawClaim(excludedId, 'not_applicable', [excluded], { applicabilityEvidenceIds: [excluded.id] }),
  ];
  const coverage = computeCoverage(claims, records, dimensions);
  assert.deepEqual(coverage, {
    expected: 20,
    eligible: 18,
    complete: 1,
    incomplete: 17,
    unsupported: 1,
    excluded: 1,
    ratio: 1 / 18,
  });
  assert.throws(() => computeCoverage(claims, records), /explicit dimension registry/);
  assert.throws(() => computeCoverage([
    { id: observedId, coverageState: 'complete' },
  ], records, dimensions), /fields do not match/);
  assert.equal(Object.isFrozen(coverage), true);
});

test('T202R1 providers expose all planned categories and remain strict data-only records', () => {
  assert.ok(PROVIDER_CATEGORIES['DIM-assurance-v1'].includes('configuration'));
  assert.ok(PROVIDER_CATEGORIES['DIM-assurance-v1'].includes('tool_result'));
  assert.ok(PROVIDER_CATEGORIES['DIM-governance-v1'].includes('reference'));
  const dimensions = [...PROVIDER_DIMENSION_IDS].reverse().map((dimensionId) => ({
    dimensionId,
    categories: [...PROVIDER_CATEGORIES[dimensionId]],
  }));
  const provider = validateProvider({ id: 'PRV-fixture-v1', apiVersion: 1, dimensions });
  assert.deepEqual(provider.dimensions.map(({ dimensionId }) => dimensionId), [...PROVIDER_DIMENSION_IDS].sort());
  assert.equal(Object.isFrozen(provider.dimensions[0].categories), true);
  assert.throws(() => provider.dimensions.pop(), TypeError);
  const base = {
    id: 'PRV-fixture-v1', apiVersion: 1,
    dimensions: [{ dimensionId: 'DIM-api-v1', categories: ['route'] }],
  };
  for (const extra of [
    { run() {} }, { imports: ['./module.mjs'] }, { command: 'node app.mjs' },
    { template: '# heading' }, { path: 'plugins/provider' }, { regex: /route/g },
  ]) assert.throws(() => validateProvider({ ...base, ...extra }), ProviderContractError);
  assert.throws(() => validateProvider({
    ...base, dimensions: [{ dimensionId: 'DIM-api-v1', categories: ['arbitrary'] }],
  }), /not allowlisted/);
  assert.throws(() => validateProviders([base, base]), /duplicate identifiers/);
});

test('T202R2 arrays are canonical dense Array.prototype collections at every contract layer', () => {
  const sparse = (length = 1) => new Array(length);
  const stripped = (entries = []) => {
    const value = [...entries];
    Object.setPrototypeOf(value, null);
    return value;
  };
  const id = 'CLM-api-array-shape-v1';
  const direct = evidence(id);
  const baseClaim = rawClaim(id, 'observed', [direct]);
  const baseProvider = {
    id: 'PRV-array-shape-v1', apiVersion: 1,
    dimensions: [{ dimensionId: 'DIM-api-v1', categories: ['route'] }],
  };

  for (const [name, run] of [
    ['evidence root sparse', () => validateEvidenceList(sparse())],
    ['claims root stripped', () => validateClaims(stripped([baseClaim]), [direct], registry([id]))],
    ['dimensions root sparse', () => validateDimensions(sparse(16))],
    ['providers root stripped', () => validateProviders(stripped([baseProvider]))],
    ['expected claim IDs sparse', () => validateDimension({
      ...definition('DIM-api-v1', [id]), expectedClaimIds: sparse(),
    })],
    ['rules stripped', () => validateDimension({
      ...definition('DIM-api-v1', [id]),
      applicability: { mode: 'all', rules: stripped([
        { field: 'repository_kind', operator: 'equals', value: 'source' },
      ]) },
    })],
    ['rule values sparse', () => validateDimension({
      ...definition('DIM-api-v1', [id]),
      applicability: { mode: 'all', rules: [
        { field: 'repository_kind', operator: 'in', value: sparse() },
      ] },
    })],
    ['claim evidence IDs sparse', () => validateClaim({
      ...baseClaim, evidenceIds: sparse(),
    }, [direct], definition('DIM-api-v1', [id]))],
    ['claim limitations stripped', () => validateClaim({
      ...baseClaim, limitations: stripped([]),
    }, [direct], definition('DIM-api-v1', [id]))],
    ['applicability facts sparse', () => createEvidence({
      claimId: id,
      detectorId: 'DET-array-shape-v1',
      sourceKind: 'repository_metadata',
      category: 'applicability',
      path: '.',
      locator: 'repository:root',
      matchedKey: 'repository_kind',
      details: { facts: sparse() },
    })],
    ['provider dimensions sparse', () => validateProvider({
      ...baseProvider, dimensions: sparse(),
    })],
    ['provider categories stripped', () => validateProvider({
      ...baseProvider,
      dimensions: [{ dimensionId: 'DIM-api-v1', categories: stripped(['route']) }],
    })],
  ]) {
    assert.throws(run, (error) => error instanceof TypeError && error.code === 'DATA_ONLY', name);
  }
});

test('T202R2 collection limits precede descriptor inspection and object descriptor allocation', () => {
  let getterCalls = 0;
  const oversized = new Array(DATA_LIMITS.maxArray + 1);
  Object.defineProperty(oversized, '0', {
    enumerable: true,
    get() { getterCalls++; return 'not-read'; },
  });
  assert.throws(
    () => assertDataOnly(oversized, EvidenceContractError),
    (error) => error.code === 'ARRAY_LIMIT',
  );
  assert.equal(getterCalls, 0);

  const tooManyKeys = {};
  for (let index = 0; index <= DATA_LIMITS.maxObjectKeys; index++) tooManyKeys[`key${index}`] = index;
  assert.throws(
    () => assertDataOnly(tooManyKeys, EvidenceContractError),
    (error) => error.code === 'OBJECT_KEY_LIMIT',
  );
});

test('T202R2 aggregate evidence universe rejects orphan, wrong-owner, and unreferenced records', () => {
  const id = 'CLM-api-evidence-owner-v1';
  const direct = evidence(id, 'route', null, 'owned');
  const claim = rawClaim(id, 'observed', [direct]);
  const dimensions = registry([id]);

  const orphan = evidence('CLM-api-missing-owner-v1', 'route', null, 'orphan');
  assert.throws(
    () => validateClaims([claim], [direct, orphan], dimensions),
    (error) => error.code === 'ORPHAN_EVIDENCE',
  );

  const unreferenced = evidence(id, 'route', null, 'unreferenced');
  assert.throws(
    () => validateClaims([claim], [direct, unreferenced], dimensions),
    (error) => error.code === 'ORPHAN_EVIDENCE',
  );

  const wrongOwnerClaim = rawClaim(id, 'observed', [orphan]);
  assert.throws(
    () => validateClaims([wrongOwnerClaim], [orphan], dimensions),
    (error) => error.code === 'INVALID_EVIDENCE',
  );
});

test('T202R2 applicability rule and fact values use field-specific types', () => {
  const stringFields = ['artifact_kind', 'ecosystem', 'language', 'repository_kind'];
  for (const field of stringFields) {
    for (const [operator, value] of [['equals', true], ['not_equals', true], ['in', [true]]]) {
      assert.throws(() => validateDimension({
        ...definition('DIM-api-v1'),
        applicability: { mode: 'all', rules: [{ field, operator, value }] },
      }), /bounded safe ASCII/);
    }
    assert.throws(() => applicabilityEvidence('CLM-api-type-v1', [
      { field, present: true, value: true },
    ], `fact-${field}`), /bounded safe scalar/);
  }
  for (const [operator, value] of [['equals', 'true'], ['not_equals', 'true'], ['in', [true, 'false']]]) {
    assert.throws(() => validateDimension({
      ...definition('DIM-api-v1'),
      applicability: { mode: 'all', rules: [{ field: 'is_git', operator, value }] },
    }), /must be boolean/);
  }
  assert.throws(() => applicabilityEvidence('CLM-api-type-v1', [
    { field: 'is_git', present: true, value: 'true' },
  ], 'fact-is-git'), /must be boolean/);

  assert.equal(validateDimension({
    ...definition('DIM-api-v1'),
    applicability: { mode: 'all', rules: [{ field: 'language', operator: 'exists', value: true }] },
  }).applicability.rules[0].value, true);
});

test('T202R2 one immutable category map drives dimensions, providers, and claim admissibility', () => {
  assert.deepEqual(Object.keys(DIMENSION_EVIDENCE_CATEGORIES), DIMENSION_IDS);
  assert.equal(Object.isFrozen(DIMENSION_EVIDENCE_CATEGORIES), true);
  assert.deepEqual(Object.keys(PROVIDER_CATEGORIES), PROVIDER_DIMENSION_IDS);
  for (const id of PROVIDER_DIMENSION_IDS) {
    assert.strictEqual(PROVIDER_CATEGORIES[id], DIMENSION_EVIDENCE_CATEGORIES[id]);
  }

  const apiId = 'CLM-api-category-v1';
  const runtime = evidence(apiId, 'runtime', null, 'api-runtime');
  assert.throws(() => validateClaim(
    rawClaim(apiId, 'observed', [runtime]),
    [runtime],
    definition('DIM-api-v1', [apiId]),
  ), (error) => error.code === 'DIMENSION_CATEGORY');

  const structureId = 'CLM-structure-category-v1';
  const structure = evidence(structureId, 'directory_structure', null, 'structure', 'file_metadata');
  assert.equal(validateClaim(rawClaim(structureId, 'observed', [structure], {
    dimensionId: 'DIM-structure-v1',
  }), [structure], definition('DIM-structure-v1', [structureId])).status, 'observed');

  const gitId = 'CLM-git-category-v1';
  const git = evidence(gitId, 'history', null, 'history', 'git_metadata');
  assert.equal(validateClaim(rawClaim(gitId, 'observed', [git], {
    dimensionId: 'DIM-git-v1',
  }), [git], definition('DIM-git-v1', [gitId])).status, 'observed');
});

test('T202R1 proxy, depth, node, and reflection bombs fail with typed safe errors', () => {
  let traps = 0;
  const proxy = new Proxy({}, {
    getPrototypeOf() { traps++; throw new Error('secret-proxy-value'); },
    ownKeys() { traps++; throw new Error('secret-proxy-value'); },
    getOwnPropertyDescriptor() { traps++; throw new Error('secret-proxy-value'); },
  });
  assert.throws(
    () => validateEvidence(proxy),
    (error) => error instanceof EvidenceContractError && error.code === 'PROXY'
      && !error.message.includes('secret-proxy-value'),
  );
  assert.equal(traps, 0);

  for (const validate of [
    (value) => validateDimensions(value),
    (value) => validateClaims(value, [], registry()),
    (value) => validateProviders(value),
    (value) => validateEvidenceList(value),
  ]) {
    let arrayTraps = 0;
    const arrayProxy = new Proxy([], {
      get() { arrayTraps++; throw new Error('secret-array-value'); },
      getPrototypeOf() { arrayTraps++; throw new Error('secret-array-value'); },
    });
    assert.throws(
      () => validate(arrayProxy),
      (error) => error.code === 'PROXY' && !error.message.includes('secret-array-value'),
    );
    assert.equal(arrayTraps, 0);
  }

  let deep = { leaf: true };
  for (let index = 0; index <= DATA_LIMITS.maxDepth; index++) deep = { child: deep };
  assert.throws(
    () => assertDataOnly(deep, ClaimContractError),
    (error) => error instanceof ClaimContractError && error.code === 'DEPTH_LIMIT',
  );
  const nodes = Array.from({ length: 3000 }, () => [true]);
  assert.throws(
    () => assertDataOnly(nodes, ProviderContractError),
    (error) => error instanceof ProviderContractError && error.code === 'NODE_LIMIT',
  );

  const accessor = {};
  Object.defineProperty(accessor, 'rawValue', {
    enumerable: true,
    get() { throw new Error('secret-accessor-value'); },
  });
  assert.throws(
    () => validateEvidence(accessor),
    (error) => error instanceof EvidenceContractError
      && !error.message.includes('secret-accessor-value'),
  );
});
