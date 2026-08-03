// T212 Data Architecture dimension — focused test suite.
//
// Covers the declaration-backed data extractor (SQL DDL, SQLAlchemy, Django,
// Prisma, Sequelize, SQLx/Diesel migrations, caches/queues), the deterministic
// privacy-safe model, ER edge/evidence resolution (including name-only no-edge,
// ambiguity, and migration predecessor edges), the T210-compatible provider,
// the inert renderer, and the end-to-end scanner. Includes positive cases per
// dialect, unsupported constructs, privacy canaries, caps, and determinism.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  DATA_DIMENSION_ID,
  DATA_EDGE_KINDS,
  DATA_LIMITS,
  DATA_RECORD_CATEGORIES,
  DataModelError,
  buildDataModel,
  createMatchedKey,
  encodeMatchedKey,
  matchedKeyFor,
  recordId,
} from '../lib/scan/deep/data/model.mjs';
import {
  classifyDataPath,
  extractDataArtifact,
  migrationKindOf,
} from '../lib/scan/deep/data/extractor.mjs';
import {
  DATA_SOURCE_FILE_LIMIT,
  diagnosticForOutcome,
  scan,
} from '../lib/scan/deep/data/scanner.mjs';
import {
  DATA_PROVIDER_ID,
  dataObservations,
  dataProviderResult,
} from '../lib/scan/providers/data.mjs';
import {
  createDataRenderer,
  renderData,
} from '../lib/scan/render/data.mjs';
import { EXISTING_TEN_RENDERER_MAP } from '../lib/scan/render/existing-ten.mjs';
import { PROVIDER_CATEGORIES } from '../lib/scan/contracts/provider.mjs';
import { withFixture } from './harness.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(TEST_ROOT, '..', 'lib');

const SEARCH_OK = Object.freeze({
  supported: true,
  readable: true,
  complete: true,
  capped: false,
  error: false,
  malformed: false,
  ambiguous: false,
  filesInspected: 2,
  fileLimit: 100,
  bytesInspected: 300,
  byteLimit: 10_000,
  recordsInspected: 5,
  recordLimit: 1_000,
  omittedCount: 0,
});

function extractSource(path, text, ecosystem) {
  return extractDataArtifact({ path, text, value: null, format: 'text', ecosystem });
}

function modelOf(result, searchSpace = SEARCH_OK) {
  return buildDataModel({
    records: result.records,
    edges: result.edges,
    diagnostics: result.diagnostics,
    searchSpace,
  });
}

function matchedKeys(result) {
  return result.records.map(({ category, signature }) => matchedKeyFor(category, signature)).sort();
}

const BANNED_VOICE = Object.freeze([
  'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'recommendation', 'ideally',
  'unfortunately', 'concern', 'concerning', 'problem', 'anti-pattern', 'smell',
  'suboptimal', 'inadequate', 'insufficient', 'contradiction', 'inconsistent',
  'inconsistency', 'conflict', 'lacking', 'vulnerable', 'risky',
]);

function findVoiceHits(markdown) {
  const pattern = new RegExp(`\\b(?:${BANNED_VOICE.join('|')})\\b`, 'gi');
  const prose = markdown.replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
  return [...prose.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

const SQL_FIXTURE = [
  'CREATE DATABASE appdb;',
  'CREATE SCHEMA public;',
  'CREATE TABLE users (',
  '  id INTEGER PRIMARY KEY,',
  '  email VARCHAR(255) NOT NULL UNIQUE,',
  '  org_id INTEGER REFERENCES organizations(id)',
  ');',
  'CREATE TABLE organizations (',
  '  id INTEGER PRIMARY KEY',
  ');',
  'CREATE INDEX idx_users_email ON users(email);',
  'CREATE UNIQUE INDEX ux_users_email ON users(email);',
  'CREATE TABLE orders (',
  '  id INTEGER PRIMARY KEY,',
  '  user_id INTEGER,',
  '  FOREIGN KEY (user_id) REFERENCES users(id)',
  ');',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// model.mjs — schema, determinism, immutability, caps, privacy
// ---------------------------------------------------------------------------

test('T212 model: limits and category snapshot are exact and frozen', () => {
  assert.deepEqual(DATA_RECORD_CATEGORIES, [
    'cache', 'entity', 'field', 'key', 'migration', 'queue', 'relation', 'schema', 'store',
  ]);
  assert.equal(DATA_DIMENSION_ID, 'DIM-data-v1');
  assert.deepEqual(DATA_EDGE_KINDS, [
    'belongs_to', 'belongs_to_many', 'foreign_key', 'has_many', 'has_one',
    'many_to_many', 'migration_predecessor',
  ]);
  assert.equal(Object.isFrozen(DATA_LIMITS), true);
  assert.equal(Object.isFrozen(DATA_RECORD_CATEGORIES), true);
  assert.equal(Object.isFrozen(DATA_EDGE_KINDS), true);
  for (const category of DATA_RECORD_CATEGORIES) {
    assert.ok(PROVIDER_CATEGORIES['DIM-data-v1'].includes(category), category);
  }
});

function sampleResult() {
  return {
    records: [
      { category: 'entity', dialect: 'sql', signature: 'orders', details: { table: 'orders' }, path: 'migrations/001.sql', line: 1, status: 'observed' },
      { category: 'entity', dialect: 'sql', signature: 'users', details: { table: 'users' }, path: 'migrations/001.sql', line: 5, status: 'observed' },
      { category: 'field', dialect: 'sql', signature: 'orders:id', details: { type: 'INTEGER', nullable: false }, path: 'migrations/001.sql', line: 1, status: 'observed' },
      { category: 'relation', dialect: 'sql', signature: 'orders:users:foreign_key', details: { kind: 'foreign_key', target: 'users' }, path: 'migrations/001.sql', line: 3, status: 'observed' },
    ],
    edges: [{ from: 'orders', to: 'users', kind: 'foreign_key', path: 'migrations/001.sql', line: 3, matchedKey: 'relation:orders:users:foreign_key' }],
    diagnostics: [],
  };
}

test('T212 model: deep-frozen deterministic model with exact summary and search space', () => {
  const first = buildDataModel({ ...sampleResult(), searchSpace: SEARCH_OK });
  const second = buildDataModel({
    ...sampleResult(),
    edges: [...sampleResult().edges].reverse(),
    searchSpace: { ...SEARCH_OK, filesInspected: 7 },
  });
  assert.notEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(buildDataModel({ ...sampleResult(), searchSpace: SEARCH_OK })));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.entities), true);
  assert.equal(Object.isFrozen(first.entities[0]), true);
  assert.equal(Object.isFrozen(first.edges), true);
  assert.equal(Object.isFrozen(first.edges[0]), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.entities.push({}), TypeError);
  assert.throws(() => first.entities[0].source.path = 'mutated', TypeError);
  assert.throws(() => first.edges[0].kind = 'mutated', TypeError);

  const summary = first.summary;
  assert.equal(summary.entities, 2);
  assert.equal(summary.fields, 1);
  assert.equal(summary.relations, 1);
  assert.equal(summary.edges, 1);
  assert.equal(summary.diagnostics, 0);
  assert.equal(summary.filesInspected, 2);
  assert.equal(summary.capped.edges, false);
  assert.deepEqual(Object.keys(summary).sort(), [
    'bytesInspected', 'caches', 'capped', 'diagnostics', 'edges', 'entities',
    'fields', 'filesInspected', 'keys', 'migrations', 'queues',
    'recordsInspected', 'relations', 'schemas', 'stores',
  ]);
  assert.deepEqual(Object.keys(first.searchSpace).sort(), [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ]);
});

test('T212 model: identities are stable prefixed tokens and matchedKeys carry categories', () => {
  const result = extractSource('src/models.py', 'class User(Base):\n    __tablename__ = "users"\n    id = Column(Integer, primary_key=True)\n', 'python');
  const model = modelOf(result);
  assert.ok(model.entities.some(({ matchedKey }) => matchedKey === 'entity:users'));
  assert.ok(model.fields.some(({ matchedKey }) => matchedKey === 'field:users:id'));
  assert.ok(model.keys.some(({ matchedKey }) => matchedKey === 'key:users:id:primary'));
  assert.match(model.entities[0].id, /^rec-[a-f0-9]{24}$/);
  assert.equal(matchedKeyFor('entity', 'users'), 'entity:users');
  assert.equal(encodeMatchedKey('relation:orders:users:foreign_key'), 'relation:orders:users:foreign_key');
  assert.equal(createMatchedKey(sampleResult().records[3]), 'relation:orders:users:foreign_key');
  const modelOfSample = buildDataModel({ ...sampleResult(), searchSpace: SEARCH_OK });
  assert.match(recordId(modelOfSample.entities[0]), /^rec-[a-f0-9]{24}$/);
});

test('T212 model: exact duplicates collapse while same-key different-file declarations persist', () => {
  const duplicate = sampleResult();
  duplicate.records.push({ ...sampleResult().records[0] });
  const model = buildDataModel({ ...duplicate, searchSpace: SEARCH_OK });
  assert.equal(model.entities.length, 2);
  const second = buildDataModel({
    records: [
      ...sampleResult().records,
      { category: 'entity', dialect: 'sql', signature: 'users', details: { table: 'users' }, path: 'other/002.sql', line: 1, status: 'observed' },
    ],
    edges: sampleResult().edges,
    searchSpace: SEARCH_OK,
  });
  assert.equal(second.entities.length, 3);
  assert.deepEqual(second.entities.map(({ source }) => source.path).sort(), [
    'migrations/001.sql', 'migrations/001.sql', 'other/002.sql',
  ]);
});

test('T212 model: invalid categories, statuses, identities, and paths fail with typed errors', () => {
  const bad = (overrides) => buildDataModel({
    records: [{ ...sampleResult().records[0], ...overrides }],
    searchSpace: SEARCH_OK,
  });
  assert.throws(() => bad({ category: 'table' }), (e) => e instanceof DataModelError && e.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => bad({ status: 'observed-evil' }), (e) => e instanceof DataModelError && e.code === 'INVALID_STATUS');
  assert.throws(() => bad({ signature: '/abs/path' }), DataModelError);
  assert.throws(() => bad({ path: '/etc/passwd' }), DataModelError);
  assert.throws(() => bad({ path: '../escape' }), DataModelError);
  assert.throws(() => bad({ signature: 'users with space' }), DataModelError);
  assert.throws(() => buildDataModel({
    records: sampleResult().records,
    edges: [{ ...sampleResult().edges[0], kind: 'invented' }],
    searchSpace: SEARCH_OK,
  }), (e) => e instanceof DataModelError && e.code === 'INVALID_EDGE');
});

test('T212 model: privacy violations are downgraded to unverified PRIVACY diagnostics and never leak', () => {
  const candidate = sampleResult();
  candidate.records.push({
    category: 'cache', dialect: 'django', signature: 'alice@example.test',
    details: { scope: 'config' }, path: 'settings.py', line: 4, status: 'observed',
  });
  const model = buildDataModel({ ...candidate, searchSpace: SEARCH_OK });
  const signatures = model.caches.map(({ signature }) => signature);
  assert.deepEqual(signatures, []);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'PRIVACY'));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes('alice@example.test'), false);
});

test('T212 model: global caps are disclosed and never drop silently', () => {
  const records = [];
  for (let index = 0; index < DATA_LIMITS.entities + 5; index++) {
    records.push({
      category: 'entity', dialect: 'sql', signature: `table_${index}`,
      details: { table: `table_${index}` }, path: 'a/001.sql', line: index + 1, status: 'observed',
    });
  }
  const model = buildDataModel({ records, searchSpace: SEARCH_OK });
  assert.equal(model.summary.capped.entities, true);
  assert.equal(model.entities.length, DATA_LIMITS.entities + 5);
  assert.equal(model.summary.entities, DATA_LIMITS.entities + 5);
});

// ---------------------------------------------------------------------------
// extractor.mjs — classification and migration detection
// ---------------------------------------------------------------------------

test('T212 extractor: classifyDataPath and migrationKindOf recognize dialects', () => {
  assert.deepEqual(classifyDataPath('migrations/001.sql'), { kind: 'sql', format: 'text', ecosystem: null });
  assert.deepEqual(classifyDataPath('schema.prisma'), { kind: 'prisma', format: 'text', ecosystem: null });
  assert.deepEqual(classifyDataPath('app/models.py'), { kind: 'python', format: 'text', ecosystem: 'python' });
  assert.deepEqual(classifyDataPath('models.js'), { kind: 'javascript', format: 'text', ecosystem: 'javascript' });
  assert.deepEqual(classifyDataPath('models.ts'), { kind: 'typescript', format: 'text', ecosystem: 'typescript' });
  assert.deepEqual(classifyDataPath('src/schema.rs'), { kind: 'rust', format: 'text', ecosystem: 'rust' });
  assert.deepEqual(classifyDataPath('README.md'), { kind: 'other', format: 'text', ecosystem: null });
  assert.equal(migrationKindOf('shop/migrations/0001_initial.py'), 'django');
  assert.equal(migrationKindOf('alembic/versions/abc.py'), 'alembic');
  assert.equal(migrationKindOf('prisma/migrations/20230101_x/migration.sql'), 'prisma');
  assert.equal(migrationKindOf('db/migrations/001.sql'), 'sqlx');
  assert.equal(migrationKindOf('migrations/0001_users/up.sql'), 'diesel');
  assert.equal(migrationKindOf('src/models.py'), null);
});

// ---------------------------------------------------------------------------
// extractor.mjs — SQL DDL
// ---------------------------------------------------------------------------

test('T212 extractor: SQL DDL extracts stores, schemas, entities, fields, keys, and FKs', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const keys = matchedKeys(result);
  assert.ok(keys.includes('store:appdb'));
  assert.ok(keys.includes('schema:public'));
  assert.ok(keys.includes('entity:users'));
  assert.ok(keys.includes('entity:organizations'));
  assert.ok(keys.includes('entity:orders'));
  assert.ok(keys.includes('field:users:id'));
  assert.ok(keys.includes('field:users:email'));
  assert.ok(keys.includes('field:users:org_id'));
  assert.ok(keys.includes('key:users:id:primary'));
  assert.ok(keys.includes('key:users:email:unique'));
  assert.ok(keys.includes('key:users:idx_users_email:index'));
  assert.ok(keys.includes('key:users:ux_users_email:unique'), 'unique index kind derives from the UNIQUE keyword, not the name');
  assert.ok(keys.includes('key:orders:foreign_key:foreign'));
  assert.ok(keys.includes('relation:users:organizations:foreign_key'));
  assert.ok(keys.includes('relation:orders:users:foreign_key'));
  assert.deepEqual(result.diagnostics, []);
});

test('T212 extractor: SQL edge candidates cite explicit FK evidence', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  assert.deepEqual(result.edges.map(({ from, to, kind }) => `${from}:${to}:${kind}`).sort(), [
    'orders:users:foreign_key', 'users:organizations:foreign_key',
  ]);
  for (const edge of result.edges) {
    assert.equal(edge.matchedKey.startsWith('relation:'), true);
  }
});

test('T212 extractor: name-only SQL references in comments or plain DML produce nothing', () => {
  const result = extractSource('queries.sql', [
    '-- references the users table',
    '/* SELECT * FROM orders; */',
    'SELECT * FROM legacy_table;',
    'UPDATE orders SET x = 1;',
    '',
  ].join('\n'), null);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.diagnostics, []);
});

test('T212 extractor: malformed and unsupported SQL statements yield typed diagnostics', () => {
  const broken = extractSource('broken.sql', 'CREATE TABLE users (id INTEGER;', null);
  assert.equal(broken.records.length, 0);
  assert.ok(broken.diagnostics.some(({ reason }) => reason === 'UNSUPPORTED'));
  const weird = extractSource('weird.sql', 'CREATE TABLE "t a b" (id INTEGER);', null);
  assert.equal(weird.records.length, 0);
  assert.ok(weird.diagnostics.some(({ reason }) => reason === 'UNSUPPORTED'));
});

// ---------------------------------------------------------------------------
// extractor.mjs — ORM models
// ---------------------------------------------------------------------------

test('T212 extractor: SQLAlchemy models, fields, keys, FKs, and name-only relationship', () => {
  const result = extractSource('app/models.py', [
    'from sqlalchemy import Column, Integer, String, ForeignKey',
    'from sqlalchemy.orm import relationship',
    'Base = declarative_base()',
    'class User(Base):',
    '    __tablename__ = "users"',
    '    id = Column(Integer, primary_key=True)',
    '    email = Column(String(255), unique=True)',
    '    orders = relationship("Order")',
    'class Order(Base):',
    '    __tablename__ = "orders"',
    '    id = Column(Integer, primary_key=True)',
    '    user_id = Column(Integer, ForeignKey("users.id"))',
    '    customer = relationship("Customer")',
    '    audit = relationship("Customer Team")',
    '',
  ].join('\n'), 'python');
  const keys = matchedKeys(result);
  assert.ok(keys.includes('entity:users'));
  assert.ok(keys.includes('entity:orders'));
  assert.ok(keys.includes('field:users:email'));
  assert.ok(keys.includes('key:users:id:primary'));
  assert.ok(keys.includes('key:users:email:unique'));
  assert.ok(keys.includes('relation:orders:users:foreign_key'));
  assert.deepEqual(keys.filter((key) => key.startsWith('relation:')), ['relation:orders:users:foreign_key']);
  assert.deepEqual(result.edges.map(({ from, to }) => `${from}:${to}`), ['orders:users']);
  assert.deepEqual(result.diagnostics, [
    { path: 'app/models.py', status: 'unverified', reason: 'NAME_ONLY', line: 8 },
    { path: 'app/models.py', status: 'unverified', reason: 'NAME_ONLY', line: 13 },
    { path: 'app/models.py', status: 'unverified', reason: 'NAME_ONLY', line: 14 },
  ]);
});

test('T212 extractor: Django models, relation fields, caches, and queues', () => {
  const result = extractSource('shop/models.py', [
    'from django.db import models',
    'class Customer(models.Model):',
    '    id = models.AutoField(primary_key=True)',
    '    email = models.EmailField(unique=True)',
    'class Order(models.Model):',
    '    id = models.AutoField(primary_key=True)',
    '    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)',
    '    tags = models.ManyToManyField("Tag")',
    'class Tag(models.Model):',
    '    id = models.AutoField(primary_key=True)',
    '',
  ].join('\n'), 'python');
  const keys = matchedKeys(result);
  assert.ok(keys.includes('entity:Customer'));
  assert.ok(keys.includes('entity:Order'));
  assert.ok(keys.includes('key:Customer:id:primary'));
  assert.ok(keys.includes('key:Customer:email:unique'));
  assert.ok(keys.includes('relation:Order:Customer:foreign_key'));
  assert.ok(keys.includes('relation:Order:Tag:many_to_many'));
  assert.deepEqual(result.edges.map(({ from, to, kind }) => `${from}:${to}:${kind}`).sort(), [
    'Order:Customer:foreign_key', 'Order:Tag:many_to_many',
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test('T212 extractor: Django caches and queues plus RQ queues are literal declarations', () => {
  const result = extractSource('shop/settings.py', [
    'CACHES = {',
    '    "default": { "BACKEND": "django.core.cache.backends.redis.RedisCache" },',
    '    "sessions": { "BACKEND": "..." },',
    '}',
    'CELERY_TASK_QUEUES = {',
    '    "email": {},',
    '    "reports": {},',
    '}',
    'from rq import Queue',
    'urgent = Queue("urgent")',
    '',
  ].join('\n'), 'python');
  const keys = matchedKeys(result);
  assert.ok(keys.includes('cache:default'));
  assert.ok(keys.includes('cache:sessions'));
  assert.ok(keys.includes('queue:email'));
  assert.ok(keys.includes('queue:reports'));
  assert.ok(keys.includes('queue:urgent'));
  assert.equal(result.records.filter(({ category }) => category === 'cache').length, 2);
  assert.equal(result.records.filter(({ category }) => category === 'queue').length, 3);
});

test('T212 extractor: Prisma datasource, models, keys, explicit relation, and name-only list field', () => {
  const result = extractSource('prisma/schema.prisma', [
    'datasource db {',
    '  provider = "postgresql"',
    '  url = env("DATABASE_URL")',
    '}',
    'model User {',
    '  id Int @id @default(autoincrement())',
    '  email String @unique',
    '  posts Post[]',
    '  profile Profile?',
    '}',
    'model Post {',
    '  id Int @id',
    '  authorId Int',
    '  author User @relation(fields: [authorId], references: [id])',
    '}',
    '',
  ].join('\n'), null);
  const keys = matchedKeys(result);
  assert.ok(keys.includes('store:db'));
  assert.ok(keys.includes('entity:User'));
  assert.ok(keys.includes('entity:Post'));
  assert.ok(keys.includes('key:User:id:primary'));
  assert.ok(keys.includes('key:User:email:unique'));
  assert.ok(keys.includes('relation:Post:User:foreign_key'));
  assert.deepEqual(result.edges.map(({ from, to }) => `${from}:${to}`), ['Post:User']);
  assert.deepEqual(result.diagnostics, [{ path: 'prisma/schema.prisma', status: 'unverified', reason: 'NAME_ONLY', line: 8 }]);
  const model = modelOf(result);
  assert.equal(model.relations.length, 1);
});

test('T212 extractor: Sequelize define, associations, queues, and caches', () => {
  const result = extractSource('models.js', [
    'const User = sequelize.define("User", {',
    '  id: { type: DataTypes.INTEGER, primaryKey: true },',
    '  email: { type: DataTypes.STRING, unique: true },',
    '}, {});',
    'const Order = sequelize.define("Order", { id: DataTypes.INTEGER }, {});',
    'Order.belongsTo(User, { foreignKey: "userId" });',
    'User.hasMany(Order);',
    'const jobQueue = new Queue("jobs");',
    'createQueue("deliveries");',
    'new Cache("sessions");',
    'createCache("profiles");',
    '',
  ].join('\n'), 'javascript');
  const keys = matchedKeys(result);
  assert.ok(keys.includes('entity:User'));
  assert.ok(keys.includes('entity:Order'));
  assert.ok(keys.includes('key:User:id:primary'));
  assert.ok(keys.includes('key:User:email:unique'));
  assert.ok(keys.includes('relation:Order:User:belongs_to'));
  assert.ok(keys.includes('queue:jobs'));
  assert.ok(keys.includes('queue:deliveries'));
  assert.ok(keys.includes('cache:sessions'));
  assert.ok(keys.includes('cache:profiles'));
  assert.deepEqual(result.edges.map(({ from, to, kind }) => `${from}:${to}:${kind}`), ['Order:User:belongs_to']);
  assert.deepEqual(result.diagnostics, [{ path: 'models.js', status: 'unverified', reason: 'NAME_ONLY', line: 7 }]);
});

test('T212 extractor: Diesel table! schemas, primary keys, and belongs_to relations', () => {
  const result = extractSource('src/schema.rs', [
    'table! {',
    '  users (id) {',
    '    id -> Integer,',
    '    email -> Varchar,',
    '  }',
    '}',
    'table! {',
    '  orders (id) {',
    '    id -> Integer,',
    '    user_id -> Integer,',
    '  }',
    '}',
    '#[derive(Queryable)]',
    '#[table_name = "users"]',
    'pub struct User {',
    '    pub id: i32,',
    '}',
    '#[derive(Queryable, Associations)]',
    '#[belongs_to(User)]',
    '#[table_name = "orders"]',
    'pub struct Order {',
    '    pub id: i32,',
    '    pub user_id: i32,',
    '}',
    '',
  ].join('\n'), 'rust');
  const keys = matchedKeys(result);
  assert.ok(keys.includes('entity:users'));
  assert.ok(keys.includes('entity:orders'));
  assert.ok(keys.includes('field:users:email'));
  assert.ok(keys.includes('key:users:primary_key:primary'));
  assert.ok(keys.includes('relation:orders:users:belongs_to'));
  assert.deepEqual(result.edges.map(({ from, to }) => `${from}:${to}`), ['orders:users']);
  assert.deepEqual(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// extractor.mjs — migrations, caches/queues, unsupported
// ---------------------------------------------------------------------------

test('T212 extractor: Django and Alembic migrations record explicit predecessor aliases', () => {
  const django = extractSource('shop/migrations/0002_orders.py', [
    'class Migration(migrations.Migration):',
    '    dependencies = [',
    '        ("shop", "0001_initial"),',
    '    ]',
    '',
  ].join('\n'), 'python');
  assert.equal(django.records.length, 1);
  assert.equal(django.records[0].details.alias, 'django:shop:0002_orders');
  assert.deepEqual(django.records[0].details.dependencies, ['django:shop:0001_initial']);
  assert.equal(django.edges.length, 1);
  assert.equal(django.edges[0].fromAlias, 'django:shop:0001_initial');
  assert.equal(django.edges[0].kind, 'migration_predecessor');

  const alembic = extractSource('alembic/versions/abc123_create.py', [
    'revision = "abc123"',
    'down_revision = "def456"',
    '',
  ].join('\n'), 'python');
  assert.equal(alembic.records[0].details.revision, 'abc123');
  assert.equal(alembic.records[0].details.downRevision, 'def456');
  assert.equal(alembic.edges.length, 1);
  assert.equal(alembic.edges[0].fromAlias, 'alembic:def456');
});

test('T212 extractor: SQL migration files record the migration and extract tables', () => {
  const result = extractSource('migrations/0001_users.sql', [
    'CREATE TABLE users (',
    '  id INTEGER PRIMARY KEY',
    ');',
    '',
  ].join('\n'), null);
  const keys = matchedKeys(result);
  assert.ok(keys.includes('entity:users'));
  assert.ok(result.records.some(({ category, dialect }) => category === 'migration' && dialect === 'sqlx'));
  assert.equal(result.edges.length, 0, 'no explicit predecessor => no migration edge');
});

test('T212 extractor: unsupported ecosystems and files produce typed diagnostics', () => {
  const shell = extractSource('run.sh', '#!/bin/bash\necho hello\n', 'shell');
  assert.deepEqual(shell.records, []);
  assert.deepEqual(shell.diagnostics, [{ path: 'run.sh', status: 'unsupported', reason: 'UNSUPPORTED', line: null }]);
  const other = extractDataArtifact({ path: 'docs/guide.md', text: 'CREATE TABLE x', value: null, format: 'text', ecosystem: null });
  assert.deepEqual(other.diagnostics, [{ path: 'docs/guide.md', status: 'unsupported', reason: 'UNSUPPORTED', line: null }]);
});

test('T212 extractor: credential-bearing SQL is never extracted as a value', () => {
  const result = extractSource('config.sql', [
    'CREATE TABLE users (id INTEGER);',
    "INSERT INTO users VALUES ('alice@example.test', 'secret');",
    '',
  ].join('\n'), null);
  assert.deepEqual(result.records.map(({ category }) => category), ['entity', 'field']);
  assert.equal(JSON.stringify(result).includes('alice@example.test'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('T212 extractor: per-file caps truncate deterministically with a CAP diagnostic', () => {
  const lines = ['CREATE TABLE users ('];
  const fields = [];
  for (let index = 0; index < DATA_LIMITS.perFileRecords + 40; index++) {
    fields.push(`  col_${index} INTEGER,`);
  }
  const result = extractSource('big/schema.sql', `${lines.join('\n')}${fields.join('\n')}\n);\n`, null);
  assert.ok(result.records.length <= DATA_LIMITS.perFileRecords);
  assert.equal(result.capped.records, true);
  assert.ok(result.diagnostics.some(({ reason }) => reason === 'CAP'));
});

// ---------------------------------------------------------------------------
// model.mjs — ER edge/evidence matrix and migration order
// ---------------------------------------------------------------------------

test('T212 model: ER edges resolve only with explicit evidence and unique endpoints', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  assert.equal(model.edges.length, 2);
  const kinds = model.edges.map(({ from, to, kind }) => `${from}:${to}:${kind}`).sort();
  assert.deepEqual(kinds, [
    'entity@orders:entity@users:foreign_key',
    'entity@users:entity@organizations:foreign_key',
  ]);
  for (const edge of model.edges) {
    assert.equal(edge.status, 'observed');
    assert.match(edge.evidence.matchedKey, /^relation:/);
    assert.match(edge.id, /^edg-[a-f0-9]{24}$/);
  }
  assert.deepEqual(model.diagnostics, []);
});

test('T212 model: name-only relations produce no relation records and no edges', () => {
  const result = extractSource('app/models.py', [
    'class Order(Base):',
    '    __tablename__ = "orders"',
    '    id = Column(Integer, primary_key=True)',
    '    customer = relationship("Customer")',
    '',
  ].join('\n'), 'python');
  const model = modelOf(result);
  assert.deepEqual(model.relations, []);
  assert.deepEqual(model.edges, []);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'NAME_ONLY'));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes('entity@orders:entity@Customer'), false);
});

test('T212 model: ambiguous targets stay unresolved and never become edges', () => {
  const result = extractSource('db/all.sql', [
    'CREATE TABLE users (id INTEGER PRIMARY KEY);',
    'CREATE TABLE teams (id INTEGER PRIMARY KEY);',
    'CREATE TABLE orders (',
    '  id INTEGER PRIMARY KEY,',
    '  user_id INTEGER,',
    '  FOREIGN KEY (user_id) REFERENCES users(id)',
    ');',
    '',
  ].join('\n'), null);
  const duplicate = extractSource('db/other.sql', 'CREATE TABLE users (id INTEGER PRIMARY KEY);', null);
  const combined = {
    records: [...result.records, ...duplicate.records],
    edges: [...result.edges, ...duplicate.edges],
    diagnostics: [...result.diagnostics, ...duplicate.diagnostics],
  };
  const model = buildDataModel({ ...combined, searchSpace: SEARCH_OK });
  assert.equal(model.edges.length, 0);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'AMBIGUOUS'));
});

test('T212 model: migration order uses explicit predecessor edges only', () => {
  const first = extractSource('shop/migrations/0001_initial.py', 'class Migration(migrations.Migration):\n    initial = True\n', 'python');
  const second = extractSource('shop/migrations/0002_orders.py', 'class Migration(migrations.Migration):\n    dependencies = [("shop", "0001_initial")]\n', 'python');
  const model = buildDataModel({
    records: [...first.records, ...second.records],
    edges: [...first.edges, ...second.edges],
    searchSpace: SEARCH_OK,
  });
  assert.equal(model.edges.length, 1);
  assert.equal(model.edges[0].kind, 'migration_predecessor');
  assert.equal(model.edges[0].from, 'migration@django:shop:0001_initial');
  assert.equal(model.edges[0].to, 'migration@shop/migrations/0002_orders.py');
  assert.deepEqual(model.diagnostics, []);
});

test('T212 model: filename ordering alone creates no migration edges', () => {
  const a = extractSource('migrations/0001.sql', 'CREATE TABLE a (id INTEGER);\n', null);
  const b = extractSource('migrations/0002.sql', 'CREATE TABLE b (id INTEGER);\n', null);
  const model = buildDataModel({
    records: [...a.records, ...b.records],
    edges: [...a.edges, ...b.edges],
    searchSpace: SEARCH_OK,
  });
  assert.equal(model.edges.length, 0);
  assert.equal(model.migrations.length, 2);
});

test('T212 model: unresolved predecessor references produce diagnostics, not edges', () => {
  const second = extractSource('shop/migrations/0002_orders.py', 'class Migration(migrations.Migration):\n    dependencies = [("shop", "0001_initial")]\n', 'python');
  const model = buildDataModel({
    records: second.records,
    edges: second.edges,
    searchSpace: SEARCH_OK,
  });
  assert.equal(model.edges.length, 0);
  assert.ok(model.diagnostics.some(({ reason }) => reason === 'UNRESOLVED'));
});

// ---------------------------------------------------------------------------
// providers/data.mjs — T210-compatible provider
// ---------------------------------------------------------------------------

test('T212 provider: emits only DIM-data-v1 categories via the provider foundation', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  const { results, capped } = dataProviderResult(model);
  assert.equal(capped, false);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, DATA_PROVIDER_ID);
  assert.equal(results[0].dimensionId, 'DIM-data-v1');
  const categories = [...new Set(results[0].observations.map(({ category }) => category))].sort();
  assert.deepEqual(categories, ['entity', 'field', 'key', 'migration', 'relation', 'schema', 'store']);
  for (const observation of results[0].observations) {
    assert.ok(PROVIDER_CATEGORIES['DIM-data-v1'].includes(observation.category));
    assert.ok(Object.isFrozen(observation));
  }
  assert.equal(Object.isFrozen(results[0]), true);
});

test('T212 provider: matchedKeys carry admissible evidence references and edge observations', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  const [{ observations }] = dataObservations(model);
  assert.ok(observations.some(({ matchedKey }) => matchedKey === 'relation:orders:users:foreign_key'));
  assert.ok(observations.some(({ matchedKey }) => matchedKey.startsWith('edge:entity@orders:entity@users:foreign_key')));
  const edgeObservation = observations.find(({ matchedKey }) => matchedKey.startsWith('edge:'));
  assert.equal(edgeObservation.category, 'relation');
  assert.equal(edgeObservation.path, 'migrations/001_init.sql');
  assert.deepEqual(edgeObservation.details, {
    from: 'entity@orders', to: 'entity@users', kind: 'foreign_key',
  });
});

test('T212 provider: deterministic, immutable, bounded, and empty for empty/foreign input', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  const first = dataProviderResult(model);
  const second = dataProviderResult(model);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(dataProviderResult(null), { results: [], capped: false });
  assert.deepEqual(dataObservations({}), []);

  const records = [];
  for (let index = 0; index < 2100; index++) {
    records.push({
      category: 'entity', dialect: 'sql', signature: `bulk_${index}`,
      details: { table: `bulk_${index}` }, path: 'big.sql', line: index + 1, status: 'observed',
    });
  }
  const big = buildDataModel({ records, searchSpace: SEARCH_OK });
  const envelope = dataProviderResult(big);
  assert.equal(envelope.capped, true);
  assert.equal(envelope.results[0].observations.length, 2048);
});

// ---------------------------------------------------------------------------
// render/data.mjs — inert renderer
// ---------------------------------------------------------------------------

test('T212 renderer: neutral markdown renders records and edges with admissible evidence', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  const markdown = createDataRenderer().render(model);
  assert.match(markdown, /^## Data Architecture/);
  assert.match(markdown, /3 entit(?:y|ies)/);
  assert.match(markdown, /No database connection, migration execution/);
  assert.match(markdown, /migrations\/001_init\.sql:1/);
  assert.match(markdown, /entity@orders/);
  assert.match(markdown, /foreign_key/);
  assert.equal(markdown.includes('\r'), false);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T212 renderer: empty model renders a factual no-detected line and disclosed caps', () => {
  const empty = buildDataModel({ records: [], edges: [], diagnostics: [], searchSpace: SEARCH_OK });
  const markdown = createDataRenderer().render(empty);
  assert.match(markdown, /No declaration-backed data architecture detected in 2 inspected file\(s\)\./);
  assert.deepEqual(findVoiceHits(markdown), []);

  const cappedModel = buildDataModel({
    records: [],
    searchSpace: { ...SEARCH_OK, capped: true, complete: false, omittedCount: 1 },
  });
  const cappedMarkdown = createDataRenderer().render(cappedModel);
  assert.match(cappedMarkdown, /file read cap reached/);
});

test('T212 renderer: deterministic byte-identical output and invalid context rejection', () => {
  const result = extractSource('migrations/001_init.sql', SQL_FIXTURE, null);
  const model = modelOf(result);
  const first = renderData('x', model);
  const second = renderData('x', model);
  assert.equal(first, second);
  assert.equal(renderData('x', null), '');
  assert.throws(() => createDataRenderer({ context: {} }), /escapeField/);
  assert.equal(Object.isFrozen(createDataRenderer()), true);
});

test('T212 inertness: data renderer is never registered in the existing-ten map', async () => {
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP).sort(), [
    'architecture', 'config', 'conventions', 'documentation', 'git',
    'operations', 'security', 'stack', 'structure', 'testing',
  ]);
  assert.equal(EXISTING_TEN_RENDERER_MAP.data, undefined);
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  assert.equal(existingTen.includes('render/data.mjs'), false, 'existing-ten must not import the data renderer');
  const write = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  assert.equal(write.includes('render/data.mjs'), false, 'write must not import the data renderer');
});

// ---------------------------------------------------------------------------
// scanner.mjs — end-to-end fixtures
// ---------------------------------------------------------------------------

test('T212 scanner: SQL migration fixture extracts tables, keys, FKs, and migration edges', async () => {
  const files = {
    'migrations/0001_init.sql': SQL_FIXTURE,
    'README.md': 'notes',
  };
  await withFixture('data-sql', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'data');
    assert.equal(signal, 'high');
    assert.equal(findings.searchSpace.complete, true);
    assert.equal(findings.entities.length, 3);
    assert.equal(findings.edges.length, 2);
    assert.equal(findings.migrations.length, 1);
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes(dir), false, 'absolute paths never appear');
  });
});

test('T212 scanner: Django fixture resolves relations and migration predecessor edges', async () => {
  const files = {
    'shop/models.py': [
      'from django.db import models',
      'class Customer(models.Model):',
      '    id = models.AutoField(primary_key=True)',
      'class Order(models.Model):',
      '    id = models.AutoField(primary_key=True)',
      '    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)',
      '',
    ].join('\n'),
    'shop/migrations/0001_initial.py': 'class Migration(migrations.Migration):\n    initial = True\n',
    'shop/migrations/0002_orders.py': 'class Migration(migrations.Migration):\n    dependencies = [("shop", "0001_initial")]\n',
  };
  await withFixture('data-django', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.entities.length, 2);
    assert.equal(findings.edges.length, 2);
    const kinds = findings.edges.map(({ kind }) => kind).sort();
    assert.deepEqual(kinds, ['foreign_key', 'migration_predecessor']);
    assert.equal(findings.migrations.length, 2);
  });
});

test('T212 scanner: Python fixture extracts SQLAlchemy models, caches, and queues', async () => {
  const files = {
    'app/models.py': [
      'from sqlalchemy import Column, Integer, String, ForeignKey',
      'Base = declarative_base()',
      'class User(Base):',
      '    __tablename__ = "users"',
      '    id = Column(Integer, primary_key=True)',
      'class Post(Base):',
      '    __tablename__ = "posts"',
      '    id = Column(Integer, primary_key=True)',
      '    user_id = Column(Integer, ForeignKey("users.id"))',
      '',
    ].join('\n'),
    'app/settings.py': [
      'CACHES = { "default": {} }',
      'CELERY_TASK_QUEUES = { "email": {} }',
      '',
    ].join('\n'),
  };
  await withFixture('data-py', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.entities.length, 2);
    assert.equal(findings.edges.length, 1);
    assert.equal(findings.edges[0].kind, 'foreign_key');
    assert.equal(findings.caches.length, 1);
    assert.equal(findings.queues.length, 1);
  });
});

test('T212 scanner: TypeScript fixture extracts Sequelize models', async () => {
  const files = {
    'models/user.ts': [
      'const User = sequelize.define("User", {',
      '  id: { type: DataTypes.INTEGER, primaryKey: true },',
      '}, {});',
      '',
    ].join('\n'),
  };
  await withFixture('data-ts', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.entities.length, 1);
    assert.ok(findings.keys.some(({ matchedKey }) => matchedKey === 'key:User:id:primary'));
  });
});

test('T212 scanner: Rust fixture extracts Diesel tables and belongs_to edges', async () => {
  const files = {
    'src/schema.rs': [
      'table! {',
      '  users (id) {',
      '    id -> Integer,',
      '  }',
      '}',
      'table! {',
      '  orders (id) {',
      '    id -> Integer,',
      '    user_id -> Integer,',
      '  }',
      '}',
      '#[derive(Queryable)]',
      '#[table_name = "users"]',
      'pub struct User {',
      '    pub id: i32,',
      '}',
      '#[derive(Queryable, Associations)]',
      '#[belongs_to(User)]',
      '#[table_name = "orders"]',
      'pub struct Order {',
      '    pub id: i32,',
      '    pub user_id: i32,',
      '}',
      '',
    ].join('\n'),
  };
  await withFixture('data-rs', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.entities.length, 2);
    assert.equal(findings.edges.length, 1);
    assert.equal(findings.edges[0].kind, 'belongs_to');
  });
});

test('T212 scanner: name-only fixture produces no edges and no relation records', async () => {
  const files = {
    'app/models.py': [
      'class Order(Base):',
      '    __tablename__ = "orders"',
      '    id = Column(Integer, primary_key=True)',
      '    customer = relationship("Customer")',
      '',
    ].join('\n'),
  };
  await withFixture('data-nameonly', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.deepEqual(findings.relations, []);
    assert.deepEqual(findings.edges, []);
    assert.ok(findings.diagnostics.some(({ reason }) => reason === 'NAME_ONLY'));
  });
});

test('T212 scanner: Shell fixture yields zero records with a complete search space', async () => {
  const files = { 'run.sh': '#!/bin/bash\necho hello\n' };
  await withFixture('data-sh', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'data');
    assert.equal(signal, 'low');
    assert.equal(findings.searchSpace.complete, true);
    assert.deepEqual(findings.entities, []);
    assert.deepEqual(findings.edges, []);
    assert.deepEqual(findings.diagnostics, []);
  });
});

test('T212 scanner: privacy canaries never reach the model', async () => {
  const files = {
    'migrations/001.sql': [
      'CREATE TABLE users (id INTEGER PRIMARY KEY);',
      "INSERT INTO audit VALUES ('alice@example.test');",
      '',
    ].join('\n'),
    'app/models.py': [
      'class Leak(Base):',
      '    __tablename__ = "leak"',
      '    id = Column(Integer, primary_key=True)',
      '    owner = Column(String)',
      '',
    ].join('\n'),
  };
  await withFixture('data-privacy', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const serialized = JSON.stringify(findings);
    for (const canary of ['alice@example.test', dir]) {
      assert.equal(serialized.includes(canary), false, `canary leaked: ${canary}`);
    }
  });
});

test('T212 scanner: deterministic repeated runs are byte-identical and search space is T202-compatible', async () => {
  const files = {
    'migrations/001.sql': SQL_FIXTURE,
  };
  await withFixture('data-determinism', files, async (dir) => {
    const first = await scan(dir, {});
    const second = await scan(dir, {});
    assert.equal(JSON.stringify(first.findings), JSON.stringify(second.findings));
    assert.equal(Object.isFrozen(first.findings), true);
    assert.deepEqual(Object.keys(first.findings.searchSpace).sort(), [
      'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
      'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
      'recordLimit', 'recordsInspected', 'supported',
    ]);
  });
});

test('T212 scanner: reader outcomes map to typed diagnostics with line null (crash regression)', async () => {
  const files = {
    'db/bad.sql': Buffer.from([0xff, 0xfe, 0xfd, 0x00]),
    'app/models.py': [
      'from sqlalchemy import Column, Integer',
      'Base = declarative_base()',
      'class User(Base):',
      '    __tablename__ = "users"',
      '    id = Column(Integer, primary_key=True)',
      '',
    ].join('\n'),
  };
  await withFixture('data-outcomes', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.deepEqual(findings.diagnostics.map(({ reason }) => reason), ['MALFORMED']);
    assert.ok(findings.diagnostics.every(({ line }) => line === null));
    assert.equal(findings.searchSpace.malformed, true);
    assert.equal(findings.searchSpace.complete, false);
    assert.ok(findings.entities.some(({ signature }) => signature === 'users'), 'valid peer records survive');
  });
});

test('T212 scanner: data source sampling cap is disclosed and never overclaims completeness', async () => {
  const files = {};
  for (let index = 0; index < DATA_SOURCE_FILE_LIMIT; index++) {
    files[`models/model${String(index).padStart(3, '0')}.py`] = 'x = 1\n';
  }
  for (let index = DATA_SOURCE_FILE_LIMIT; index < DATA_SOURCE_FILE_LIMIT + 48; index++) {
    files[`models/model${String(index).padStart(3, '0')}.py`] = 'SKIPPED_CANARY = 1\n';
  }
  await withFixture('data-cap560', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.equal(findings.searchSpace.complete, false, 'skipped eligible sources must never claim completeness');
    assert.equal(findings.searchSpace.capped, true);
    assert.equal(findings.searchSpace.omittedCount, 48);
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('SKIPPED_CANARY'), false, 'skipped file content must never be invented');
  });
});

test('T212 scanner: diagnosticForOutcome maps every reader status to a typed reason', () => {
  assert.deepEqual(diagnosticForOutcome({ path: 'a.sql', status: 'unreadable' }),
    { path: 'a.sql', status: 'unverified', reason: 'UNREADABLE', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'b.sql', status: 'capped' }),
    { path: 'b.sql', status: 'unverified', reason: 'CAP', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'c.sql', status: 'malformed' }),
    { path: 'c.sql', status: 'unverified', reason: 'MALFORMED', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'd.sql', status: 'unsupported' }),
    { path: 'd.sql', status: 'unverified', reason: 'UNSUPPORTED', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'e.sql', status: 'unknown-status' }),
    { path: 'e.sql', status: 'unverified', reason: 'UNREADABLE', line: null });
});
