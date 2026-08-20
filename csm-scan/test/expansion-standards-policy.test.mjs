import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  reuseDisposition,
  STANDARDS_DISPOSITIONS,
  validateStandardEntry,
  validateStandardsRegistry,
} from '../lib/scan/standards/policy.mjs';
import {
  getStandardsRegistry,
  standardById,
  STANDARDS_REGISTRY,
  STANDARDS_REGISTRY_VERSION,
} from '../lib/scan/standards/registry.mjs';

const SNAPSHOT = [
  ['std:aicpa-soc2-tsc:2017-rpof-2022', '2017-rpof-2022', '2017 Trust Services Criteria (with Revised Points of Focus - 2022)'],
  ['std:iso-iec-27001:2022', '2022', 'ISO/IEC 27001:2022, edition 3'],
  ['std:oasis-sarif:2.1.0-errata01', '2.1.0-errata01', 'Version 2.1.0 Plus Errata 01'],
  ['std:openvex-spec:0.2.0', '0.2.0', 'v0.2.0'],
  ['std:owasp-asvs:5.0.0', '5.0.0', '5.0.0'],
  ['std:owasp-cyclonedx:1.7', '1.7', '1.7'],
  ['std:owasp-top10:2025', '2025', '2025'],
  ['std:pci-dss:4.0.1', '4.0.1', '4.0.1'],
  ['std:spdx-spec:2.3.0', '2.3.0', '2.3.0'],
  ['std:w3c-wcag:2.2-rec-20241212', '2.2-rec-20241212', '2.2, W3C Recommendation 12 December 2024 (REC-WCAG22-20241212)'],
];

const VALID_ENTRY = {
  id: 'std:example-format:1.0',
  publisher: 'Example Publisher',
  title: 'Example Format',
  editionKey: '1.0',
  edition: '1.0',
  publicationDate: '2026-01',
  officialUri: 'https://example.test/spec/1.0',
  disposition: 'metadata_only',
};

test('registry has a version and the exact deterministic edition snapshot', () => {
  assert.equal(STANDARDS_REGISTRY_VERSION, 2);
  assert.deepEqual(
    STANDARDS_REGISTRY.map(({ id, editionKey, edition }) => [id, editionKey, edition]),
    SNAPSHOT,
  );
});

test('registry IDs and official URIs are unique', () => {
  const ids = STANDARDS_REGISTRY.map(({ id }) => id);
  const uris = STANDARDS_REGISTRY.map(({ officialUri }) => officialUri);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(uris).size, uris.length);
  assert.ok(uris.every((uri) => uri.startsWith('https://')));
});

test('every built-in entry is metadata-only and exposes metadata fields only', () => {
  assert.deepEqual(STANDARDS_DISPOSITIONS, ['authored_mapping', 'metadata_only']);
  for (const entry of STANDARDS_REGISTRY) {
    assert.equal(entry.disposition, 'metadata_only');
    assert.deepEqual(Object.keys(entry), [
      'id', 'publisher', 'title', 'editionKey', 'edition', 'publicationDate',
      'officialUri', 'disposition',
    ]);
  }
});

test('registry access is immutable and returns validated identities', () => {
  assert.equal(getStandardsRegistry(), STANDARDS_REGISTRY);
  assert.ok(Object.isFrozen(STANDARDS_REGISTRY));
  assert.ok(STANDARDS_REGISTRY.every(Object.isFrozen));
  assert.equal(standardById('std:owasp-asvs:5.0.0'), STANDARDS_REGISTRY[4]);
  assert.equal(standardById('std:missing:1'), null);
  assert.throws(() => STANDARDS_REGISTRY.push(VALID_ENTRY), TypeError);
  assert.throws(() => { STANDARDS_REGISTRY[0].edition = 'changed'; }, TypeError);
});

test('registry validation sorts deterministically without mutating input', () => {
  const second = {
    ...VALID_ENTRY,
    id: 'std:another-format:2',
    editionKey: '2',
    edition: 'Edition 2',
    officialUri: 'https://example.test/spec/2',
  };
  const input = [VALID_ENTRY, second];
  const result = validateStandardsRegistry(input);
  assert.deepEqual(result.map(({ id }) => id), ['std:another-format:2', 'std:example-format:1.0']);
  assert.equal(input[0], VALID_ENTRY);
  assert.ok(Object.isFrozen(result));
  assert.ok(result.every(Object.isFrozen));
});

test('reuse gate defaults unknown, restricted, and unproven reuse to metadata-only', () => {
  assert.equal(reuseDisposition(), 'metadata_only');
  assert.equal(reuseDisposition({ authoredMapping: true }), 'metadata_only');
  assert.equal(reuseDisposition({ reuseProven: true }), 'metadata_only');
  assert.equal(
    reuseDisposition({ authoredMapping: true, reuseProven: true }),
    'authored_mapping',
  );
  assert.throws(() => reuseDisposition({ reuseProven: 'unknown' }), TypeError);
  assert.throws(() => reuseDisposition({ undecided: true }), TypeError);
});

test('entry validator rejects malformed records and metadata-boundary bypasses', () => {
  assert.throws(() => validateStandardEntry(null), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, id: 'example' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, officialUri: 'http://example.test' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, publicationDate: '2026-13' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, publicationDate: '2026-02-30' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, disposition: 'undecided' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, disposition: 'authored_mapping' }), /metadata_only/);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, summary: 'Free-form prose.' }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, copiedText: false }), TypeError);
  assert.throws(() => validateStandardEntry({ ...VALID_ENTRY, controlText: 'source prose' }), TypeError);
  assert.throws(() => {
    const { editionKey: _editionKey, ...missingEditionKey } = VALID_ENTRY;
    validateStandardEntry(missingEditionKey);
  }, TypeError);
});

test('edition keys are ID-bound and retain every numeric component', () => {
  assert.doesNotThrow(() => validateStandardEntry(VALID_ENTRY));
  assert.throws(
    () => validateStandardEntry({ ...VALID_ENTRY, editionKey: '2.0' }),
    /match the edition suffix/,
  );
  assert.throws(
    () => validateStandardEntry({ ...VALID_ENTRY, edition: 'Version 2.0' }),
    /every editionKey version component/,
  );
});

test('recognized edition qualifiers require their semantic markers', () => {
  const cases = [
    ['1.0-rpof-2022', 'Version 1.0, 2022', /rpof qualifier marker/],
    ['1.0-errata01', 'Version 1.0, correction 01', /errata01 qualifier marker/],
    ['1.0-rec-2022', 'Version 1.0, release 2022', /rec qualifier marker/],
  ];

  for (const [editionKey, edition, error] of cases) {
    assert.throws(
      () => validateStandardEntry({
        ...VALID_ENTRY,
        id: `std:example-format:${editionKey}`,
        editionKey,
        edition,
      }),
      error,
    );
  }
});

test('unknown alphabetic edition qualifiers are rejected', () => {
  assert.throws(
    () => validateStandardEntry({
      ...VALID_ENTRY,
      id: 'std:example-format:1.0-final',
      editionKey: '1.0-final',
      edition: 'Version 1.0 Final',
    }),
    /unknown qualifier: final/,
  );
});

test('all floating edition markers are rejected in keys and editions', () => {
  const markers = [
    'current', 'latest', 'draft', 'unspecified', 'next', 'nightly', 'rolling',
    'snapshot', 'provisional', 'preview', 'dev', 'head', 'trunk',
  ];
  for (const marker of markers) {
    assert.throws(
      () => validateStandardEntry({ ...VALID_ENTRY, edition: `${marker} 1.0` }),
      /floating marker/,
    );
    assert.throws(
      () => validateStandardEntry({
        ...VALID_ENTRY,
        id: `std:example-format:${marker}-1.0`,
        editionKey: `${marker}-1.0`,
      }),
      /floating marker/,
    );
  }
});

test('every registry entry satisfies exact-edition qualifier policy', () => {
  for (const entry of STANDARDS_REGISTRY) {
    assert.doesNotThrow(() => validateStandardEntry(entry), entry.id);
  }
});

test('registry validator rejects duplicate IDs and official URIs', () => {
  assert.throws(() => validateStandardsRegistry([VALID_ENTRY, { ...VALID_ENTRY }]), /duplicate id/);
  assert.throws(
    () => validateStandardsRegistry([
      VALID_ENTRY,
      { ...VALID_ENTRY, id: 'std:other-format:1.0' },
    ]),
    /duplicate officialUri/,
  );
});

test('validated registry snapshots are detached and deeply immutable', () => {
  const mutable = { ...VALID_ENTRY };
  const result = validateStandardsRegistry([mutable]);
  mutable.title = 'Changed input';
  assert.equal(result[0].title, 'Example Format');
  assert.throws(() => { result[0].title = 'Changed output'; }, TypeError);
});
