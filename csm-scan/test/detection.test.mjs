import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATABASE_INDICATORS,
  EXTERNAL_API_INDICATORS,
  AUTH_LIBS,
  INPUT_VALIDATION_LIBS,
  RATE_LIMIT_LIBS,
  MONITORING_LIBS,
  AUDIT_TOOLS,
  matchDep,
} from '../lib/scan/shared/detection.mjs';

const ECOSYSTEMS = ['python', 'javascript', 'typescript', 'rust', 'shell'];

// The 6 library indicator maps where shell is genuinely not applicable.
const LIBRARY_MAPS = {
  DATABASE_INDICATORS,
  EXTERNAL_API_INDICATORS,
  AUTH_LIBS,
  INPUT_VALIDATION_LIBS,
  RATE_LIMIT_LIBS,
  MONITORING_LIBS,
};

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

test('every library map is keyed by exactly the 5 ecosystems', () => {
  for (const [name, map] of Object.entries(LIBRARY_MAPS)) {
    assert.deepEqual(Object.keys(map).toSorted(), [...ECOSYSTEMS].toSorted(), `${name} keys`);
  }
});

test('AUDIT_TOOLS is keyed by the 5 ecosystems', () => {
  assert.deepEqual(Object.keys(AUDIT_TOOLS).toSorted(), [...ECOSYSTEMS].toSorted());
});

test('library map shell sub-objects are empty {} (n/a)', () => {
  for (const [name, map] of Object.entries(LIBRARY_MAPS)) {
    assert.deepEqual(map.shell, {}, `${name}.shell must be empty`);
  }
});

test('typescript mirrors javascript for every library map', () => {
  for (const [name, map] of Object.entries(LIBRARY_MAPS)) {
    assert.deepEqual(map.typescript, map.javascript, `${name}.typescript should mirror javascript`);
  }
});

test('every entry across all maps has a string label and optional string type', () => {
  const allMaps = { ...LIBRARY_MAPS, AUDIT_TOOLS };
  for (const [name, map] of Object.entries(allMaps)) {
    for (const [eco, sub] of Object.entries(map)) {
      for (const [key, val] of Object.entries(sub)) {
        assert.ok(typeof val === 'object' && val !== null, `${name}.${eco}.${key} must be an object`);
        assert.ok(
          typeof val.label === 'string' && val.label.length > 0,
          `${name}.${eco}.${key} must have a non-empty label`,
        );
        assert.ok(
          val.type === undefined || typeof val.type === 'string',
          `${name}.${eco}.${key} type must be a string when present`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Specific required entries from the T102 spec
// ---------------------------------------------------------------------------

test('required database entries exist with expected labels', () => {
  assert.equal(DATABASE_INDICATORS.rust.sqlx.label, 'SQLx');
  assert.equal(DATABASE_INDICATORS.python.sqlalchemy.label, 'SQLAlchemy');
});

test('required monitoring entries exist', () => {
  assert.equal(MONITORING_LIBS.rust.tracing.label, 'tracing');
  assert.equal(MONITORING_LIBS.python['sentry-sdk'].label, 'Sentry (sentry-sdk)');
});

test('required auth / validation / rate-limit entries exist', () => {
  assert.ok(AUTH_LIBS.rust.argon2, 'AUTH_LIBS.rust.argon2');
  assert.ok(INPUT_VALIDATION_LIBS.rust.validator, 'INPUT_VALIDATION_LIBS.rust.validator');
  assert.ok(RATE_LIMIT_LIBS.javascript['express-rate-limit'], 'RATE_LIMIT_LIBS.javascript[express-rate-limit]');
});

test('psycopg2 and psycopg both map to the psycopg label', () => {
  assert.equal(DATABASE_INDICATORS.python.psycopg2.label, 'psycopg');
  assert.equal(DATABASE_INDICATORS.python.psycopg.label, 'psycopg');
});

test('redis-py is keyed as "redis" in the python database table', () => {
  assert.ok(DATABASE_INDICATORS.python.redis, 'python.redis key missing');
  assert.equal(DATABASE_INDICATORS.python.redis.label, 'redis-py');
});

test('rust has the full required database set', () => {
  for (const k of ['sqlx', 'diesel', 'rusqlite', 'sea-orm', 'tokio-postgres', 'redis', 'surrealdb', 'refinery']) {
    assert.ok(DATABASE_INDICATORS.rust[k], `rust DB missing ${k}`);
  }
});

test('python has the full required database set', () => {
  for (const k of [
    'sqlalchemy',
    'psycopg2',
    'psycopg',
    'asyncpg',
    'aiomysql',
    'pymongo',
    'motor',
    'redis',
    'tortoise-orm',
    'databases',
    'sqlmodel',
  ]) {
    assert.ok(DATABASE_INDICATORS.python[k], `python DB missing ${k}`);
  }
});

test('audit tools cover the required set across ecosystems', () => {
  // language-specific
  for (const k of ['cargo-audit', 'cargo-deny', 'rustsec']) {
    assert.ok(AUDIT_TOOLS.rust[k], `rust audit missing ${k}`);
  }
  for (const k of ['pip-audit', 'safety', 'bandit']) {
    assert.ok(AUDIT_TOOLS.python[k], `python audit missing ${k}`);
  }
  assert.ok(AUDIT_TOOLS.javascript['npm-audit'], 'js npm-audit marker');
  assert.ok(AUDIT_TOOLS.typescript['npm-audit'], 'ts npm-audit marker');
  // cross-cutting present in every ecosystem
  for (const eco of ECOSYSTEMS) {
    for (const k of ['semgrep', 'trufflehog', 'snyk', 'osv-scanner', 'gosec']) {
      assert.ok(AUDIT_TOOLS[eco][k], `${eco} audit missing cross-cutting ${k}`);
    }
  }
});

// ---------------------------------------------------------------------------
// matchDep helper
// ---------------------------------------------------------------------------

test('matchDep returns matched entries from an array of deps (spec example)', () => {
  const out = matchDep(['sqlx', 'tokio'], DATABASE_INDICATORS.rust);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 1, 'only sqlx matches; tokio is not a DB indicator');
  assert.equal(out[0].name, 'sqlx');
  assert.equal(out[0].label, 'SQLx');
  assert.ok(typeof out[0].type === 'string', 'sqlx entry carries a type');
});

test('matchDep accepts a manifest-shaped deps object', () => {
  const out = matchDep({ sqlx: '0.7', tokio: '1', diesel: '2' }, DATABASE_INDICATORS.rust);
  assert.equal(out.length, 2);
  const names = out.map((e) => e.name).toSorted();
  assert.deepEqual(names, ['diesel', 'sqlx']);
});

test('matchDep supports ecosystem-aware usage via sub-object resolution', () => {
  const eco = 'rust';
  const out = matchDep(['diesel', 'serde'], DATABASE_INDICATORS[eco] || {});
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'diesel');
  assert.equal(out[0].label, 'Diesel');
});

test('matchDep honors trailing-* prefix keys (google-cloud-*)', () => {
  // google-cloud-firestore is NOT an exact key, only matches the prefix.
  const out = matchDep(['google-cloud-firestore', 'requests'], EXTERNAL_API_INDICATORS.python);
  const names = out.map((e) => e.name);
  assert.ok(names.includes('google-cloud-firestore'));
  assert.ok(names.includes('requests'));
});

test('matchDep applies case and PEP 503 separator normalization to Python tables', () => {
  assert.deepEqual(matchDep(['SQLAlchemy'], DATABASE_INDICATORS.python), [
    { name: 'SQLAlchemy', label: 'SQLAlchemy', type: 'ORM' },
  ]);
  assert.deepEqual(
    matchDep(['Tortoise_ORM', 'tortoise.orm', 'tortoise-orm'], DATABASE_INDICATORS.python),
    [{ name: 'Tortoise_ORM', label: 'Tortoise ORM', type: 'ORM' }],
  );

  const synthetic = { 'sql-alchemy': { label: 'synthetic' } };
  assert.deepEqual(matchDep(['sql_alchemy', 'SQL.ALCHEMY', 'sql-alchemy'], synthetic, 'python'), [
    { name: 'sql_alchemy', label: 'synthetic' },
  ]);
});

test('matchDep applies PEP 503 normalization to Python prefix keys', () => {
  assert.deepEqual(matchDep(['Google_Cloud_Firestore'], EXTERNAL_API_INDICATORS.python), [
    { name: 'Google_Cloud_Firestore', label: 'GCP', type: 'Cloud SDK' },
  ]);
});

test('matchDep keeps npm separators distinct for JavaScript and TypeScript tables', () => {
  assert.deepEqual(matchDep(['node_fetch'], EXTERNAL_API_INDICATORS.javascript), []);
  assert.deepEqual(
    matchDep(['express_rate_limit', 'express.rate.limit'], RATE_LIMIT_LIBS.javascript),
    [],
  );
  assert.deepEqual(matchDep(['NODE-FETCH'], EXTERNAL_API_INDICATORS.javascript), [
    { name: 'NODE-FETCH', label: 'node-fetch', type: 'HTTP client' },
  ]);
  assert.deepEqual(matchDep(['express-rate-limit'], RATE_LIMIT_LIBS.javascript), [
    { name: 'express-rate-limit', label: 'express-rate-limit', type: 'Rate limit' },
  ]);

  assert.deepEqual(matchDep(['node_fetch'], EXTERNAL_API_INDICATORS.typescript), []);
  assert.deepEqual(matchDep(['node-fetch'], EXTERNAL_API_INDICATORS.typescript), [
    { name: 'node-fetch', label: 'node-fetch', type: 'HTTP client' },
  ]);
});

test('matchDep keeps Rust separators distinct', () => {
  assert.deepEqual(matchDep(['tokio_postgres'], DATABASE_INDICATORS.rust), []);
  assert.deepEqual(matchDep(['Tokio-Postgres'], DATABASE_INDICATORS.rust), [
    { name: 'Tokio-Postgres', label: 'tokio-postgres', type: 'Driver' },
  ]);
});

test('unsupported factual classifications are absent and do not match', () => {
  assert.equal(DATABASE_INDICATORS.python.alembic, undefined);
  assert.equal(EXTERNAL_API_INDICATORS.rust.wiremock, undefined);
  assert.equal(INPUT_VALIDATION_LIBS.rust.serde, undefined);
  assert.equal(RATE_LIMIT_LIBS.javascript['p-limit'], undefined);
  assert.equal(RATE_LIMIT_LIBS.typescript['p-limit'], undefined);

  assert.deepEqual(matchDep(['alembic'], DATABASE_INDICATORS.python), []);
  assert.deepEqual(matchDep(['wiremock'], EXTERNAL_API_INDICATORS.rust), []);
  assert.deepEqual(matchDep(['serde'], INPUT_VALIDATION_LIBS.rust), []);
  assert.deepEqual(matchDep(['p-limit'], RATE_LIMIT_LIBS.javascript), []);
});

test('matchDep prefers an exact key over a prefix key when both apply', () => {
  const out = matchDep(['Google-Cloud-Storage'], {
    'google-cloud-*': { label: 'prefix' },
    'google-cloud-storage': { label: 'exact' },
  });
  assert.deepEqual(out, [{ name: 'Google-Cloud-Storage', label: 'exact' }]);
});

test('matchDep returns [] for empty/null/unknown input without throwing', () => {
  assert.deepEqual(matchDep([], DATABASE_INDICATORS.rust), []);
  assert.deepEqual(matchDep(null, DATABASE_INDICATORS.rust), []);
  assert.deepEqual(matchDep(undefined, DATABASE_INDICATORS.rust), []);
  assert.deepEqual(matchDep(['sqlx'], {}), []);
  assert.deepEqual(matchDep(['sqlx'], null), []);
  assert.deepEqual(matchDep(['sqlx'], undefined), []);
  assert.doesNotThrow(() => matchDep(null, null));
});

test('matchDep de-duplicates repeated dependency names', () => {
  const out = matchDep(['sqlx', 'sqlx', 'diesel'], DATABASE_INDICATORS.rust);
  assert.equal(out.length, 2);
});

test('matchDep preserves input order of matched deps', () => {
  const out = matchDep(['diesel', 'sqlx', 'rusqlite'], DATABASE_INDICATORS.rust);
  assert.deepEqual(
    out.map((e) => e.name),
    ['diesel', 'sqlx', 'rusqlite'],
  );
});
