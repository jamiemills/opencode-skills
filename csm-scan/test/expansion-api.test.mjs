// T211 API Surface dimension — focused test suite.
//
// Covers the declaration-backed API extractor, deterministic privacy-safe
// model, T210-compatible provider, inert renderer, and the end-to-end scanner.
// Includes positive cases per ecosystem, dynamic partial/unverified
// diagnostics, unsupported constructs, privacy canaries, caps, and
// no-false-edge fixtures (name-only input must never create operations).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  API_DIMENSION_ID,
  API_LIMITS,
  API_OPERATION_CATEGORIES,
  API_STATUSES,
  ApiModelError,
  buildApiModel,
  createMatchedKey,
  encodeMatchedKey,
  matchedKeyFor,
  operationId,
} from '../lib/scan/deep/api/model.mjs';
import {
  classifyPath,
  detectContractKind,
  extractApiSurface,
} from '../lib/scan/deep/api/extractor.mjs';
import {
  API_SOURCE_FILE_LIMIT,
  diagnosticForOutcome,
  scan,
} from '../lib/scan/deep/api/scanner.mjs';
import {
  API_PROVIDER_ID,
  apiObservations,
  apiProviderResult,
} from '../lib/scan/providers/api.mjs';
import { ProviderResultError } from '../lib/scan/providers/base.mjs';
import {
  createApiRenderer,
  renderApi,
} from '../lib/scan/render/api.mjs';
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
  filesInspected: 3,
  fileLimit: 100,
  bytesInspected: 300,
  byteLimit: 10_000,
  recordsInspected: 5,
  recordLimit: 1_000,
  omittedCount: 0,
});

function extractSource(path, text, ecosystem) {
  return extractApiSurface({ path, text, value: null, format: 'text', ecosystem });
}

function extractJson(path, value) {
  return extractApiSurface({ path, text: '', value, format: 'json', ecosystem: null });
}

function extractTextContract(path, text) {
  return extractApiSurface({ path, text, value: null, format: 'text', ecosystem: null });
}

function signatures(result) {
  return result.operations.map(({ signature }) => signature).sort();
}

function modelOf(result) {
  return buildApiModel({
    operations: result.operations,
    diagnostics: result.diagnostics,
    measurement: { filesInspected: 1, bytesInspected: 1, recordsInspected: 1 },
  });
}

const BANNED_VOICE = Object.freeze([
  'should', 'must', 'ought', 'shall', 'poor', 'good', 'bad', 'weak', 'strong',
  'better', 'worse', 'best', 'worst', 'recommended', 'recommendation', 'ideally',
  'unfortunately', 'concern', 'concerning', 'problem', 'anti-pattern', 'smell',
  'suboptimal', 'inadequate', 'insufficient', 'contradiction', 'inconsistent',
  'inconsistency', 'conflict', 'lacking',
]);

function findVoiceHits(markdown) {
  const pattern = new RegExp(`\\b(?:${BANNED_VOICE.join('|')})\\b`, 'gi');
  const prose = markdown.replace(/`[^`\n]*`/g, (match) => ' '.repeat(match.length));
  return [...prose.matchAll(pattern)].map((match) => match[0].toLowerCase());
}

// ---------------------------------------------------------------------------
// model.mjs — schema, determinism, immutability, caps, privacy
// ---------------------------------------------------------------------------

test('T211 model: limits and category snapshot are exact and frozen', () => {
  assert.deepEqual(API_OPERATION_CATEGORIES, [
    'cli_command', 'contract', 'event', 'public_export', 'route', 'rpc',
  ]);
  assert.deepEqual(API_STATUSES, ['observed', 'unverified']);
  assert.equal(API_DIMENSION_ID, 'DIM-api-v1');
  assert.equal(Object.isFrozen(API_LIMITS), true);
  assert.equal(Object.isFrozen(API_OPERATION_CATEGORIES), true);
  for (const category of API_OPERATION_CATEGORIES) {
    assert.ok(PROVIDER_CATEGORIES['DIM-api-v1'].includes(category), category);
  }
});

function sampleCandidates() {
  return [
    {
      category: 'route', dialect: 'express', signature: 'GET:/api/users',
      details: { method: 'GET', operationId: null }, path: 'src/app.js', line: 2, status: 'observed',
    },
    {
      category: 'contract', dialect: 'openapi', signature: 'openapi:openapi.yaml',
      details: { format: 'openapi', version: '3.0.0' }, path: 'openapi.yaml', line: 1, status: 'observed',
    },
  ];
}

test('T211 model: deep-frozen deterministic model with exact summary and search space', () => {
  const first = buildApiModel({ operations: sampleCandidates(), diagnostics: [], searchSpace: SEARCH_OK });
  const second = buildApiModel({
    operations: [...sampleCandidates()].reverse(),
    diagnostics: [],
    searchSpace: { ...SEARCH_OK, filesInspected: 7 },
  });
  assert.notEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(buildApiModel({ operations: sampleCandidates(), searchSpace: SEARCH_OK })));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.operations), true);
  assert.equal(Object.isFrozen(first.operations[0]), true);
  assert.equal(Object.isFrozen(first.operations[0].details), true);
  assert.equal(Object.isFrozen(first.searchSpace), true);
  assert.throws(() => first.operations.push({}), TypeError);
  assert.throws(() => first.operations[0].source.path = 'mutated', TypeError);

  const firstSummary = first.summary;
  assert.equal(firstSummary.operations, 2);
  assert.equal(firstSummary.routes, 1);
  assert.equal(firstSummary.contracts, 1);
  assert.equal(firstSummary.rpcs, 0);
  assert.equal(firstSummary.events, 0);
  assert.equal(firstSummary.cliCommands, 0);
  assert.equal(firstSummary.publicExports, 0);
  assert.equal(firstSummary.diagnostics, 0);
  assert.equal(firstSummary.filesInspected, 3);
  assert.equal(firstSummary.capped.files, false);
  assert.deepEqual(Object.keys(firstSummary).sort(), [
    'bytesInspected', 'capped', 'cliCommands', 'contracts', 'diagnostics',
    'events', 'filesInspected', 'operations', 'publicExports', 'recordsInspected',
    'routes', 'rpcs',
  ]);
  assert.deepEqual(Object.keys(first.searchSpace).sort(), [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ]);
});

test('T211 model: identities are prefixed stable tokens and matchedKeys encode path params', () => {
  const withParam = extractSource('src/api.js', "app.get('/pets/{petId}', h);", 'javascript');
  const model = modelOf(withParam);
  assert.deepEqual(model.operations.map(({ signature }) => signature), ['GET:/pets/{petId}']);
  assert.equal(model.operations[0].matchedKey, 'route:GET:/pets/{petId}');
  assert.equal(encodeMatchedKey(model.operations[0].matchedKey), 'route:GET:/pets/%7BpetId%7D');
  assert.equal(matchedKeyFor('route', 'GET:/pets/{petId}'), 'route:GET:/pets/{petId}');
  assert.match(operationId(model.operations[0]), /^op-[a-f0-9]{24}$/);
  assert.equal(createMatchedKey(sampleCandidates()[0]), 'route:GET:/api/users');
});

test('T211 model: exact duplicates collapse while same-signature different-file declarations persist', () => {
  const candidates = [
    {
      category: 'route', dialect: 'express', signature: 'GET:/health',
      details: { method: 'GET', operationId: null }, path: 'a/app.js', line: 1, status: 'observed',
    },
    {
      category: 'route', dialect: 'express', signature: 'GET:/health',
      details: { method: 'GET', operationId: null }, path: 'a/app.js', line: 1, status: 'observed',
    },
    {
      category: 'route', dialect: 'express', signature: 'GET:/health',
      details: { method: 'GET', operationId: null }, path: 'b/app.js', line: 5, status: 'observed',
    },
  ];
  const model = buildApiModel({ operations: candidates, searchSpace: SEARCH_OK });
  assert.equal(model.operations.length, 2);
  assert.deepEqual(model.operations.map(({ source }) => source.path), ['a/app.js', 'b/app.js']);
});

test('T211 model: invalid categories, statuses, identities, and paths fail with typed errors', () => {
  const bad = (overrides) => buildApiModel({
    operations: [{ ...sampleCandidates()[0], ...overrides }],
    searchSpace: SEARCH_OK,
  });
  assert.throws(() => bad({ category: 'language' }), (e) => e instanceof ApiModelError && e.code === 'UNKNOWN_CATEGORY');
  assert.throws(() => bad({ status: 'observed-evil' }), (e) => e instanceof ApiModelError && e.code === 'INVALID_STATUS');
  assert.throws(() => bad({ signature: '/api/users' }), ApiModelError);
  assert.throws(() => bad({ path: '/etc/passwd' }), ApiModelError);
  assert.throws(() => bad({ path: '../escape' }), ApiModelError);
  assert.throws(() => bad({ signature: 'GET:/with space' }), ApiModelError);
});

test('T211 model: privacy violations are downgraded to unverified PRIVACY diagnostics and never leak', () => {
  const candidates = [
    {
      category: 'cli_command', dialect: 'argparse', signature: 'cli:argparse:alice@example.test',
      details: { command: 'alice@example.test' }, path: 'cli.py', line: 4, status: 'observed',
    },
    {
      category: 'route', dialect: 'express', signature: 'GET:/safe',
      details: { method: 'GET', operationId: null }, path: 'app.js', line: 1, status: 'observed',
    },
  ];
  const model = buildApiModel({ operations: candidates, searchSpace: SEARCH_OK });
  assert.deepEqual(model.operations.map(({ signature }) => signature), ['GET:/safe']);
  assert.deepEqual(model.diagnostics, [{
    path: 'cli.py', status: 'unverified', reason: 'PRIVACY', line: null,
  }]);
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes('alice@example.test'), false);
});

test('T211 model: global caps are disclosed and never drop silently', () => {
  const flood = Array.from({ length: API_LIMITS.routes + 20 }, (_, index) => ({
    category: 'route', dialect: 'express', signature: `GET:/r/${index}`,
    details: { method: 'GET', operationId: null }, path: 'a/app.js', line: index + 1, status: 'observed',
  }));
  const model = buildApiModel({ operations: flood, searchSpace: SEARCH_OK });
  assert.equal(model.summary.capped.routes, true);
  assert.equal(model.summary.capped.operations, false);
  assert.equal(model.operations.length, API_LIMITS.routes + 20);
  assert.equal(model.summary.routes, API_LIMITS.routes + 20);
});

// ---------------------------------------------------------------------------
// extractor.mjs — classification and contract dialects
// ---------------------------------------------------------------------------

test('T211 extractor: classifyPath recognizes contracts, sources, package, and other', () => {
  assert.deepEqual(classifyPath('openapi.yaml'), { kind: 'contract', format: 'text', ecosystem: null });
  assert.deepEqual(classifyPath('api/openapi.json'), { kind: 'contract', format: 'json', ecosystem: null });
  assert.deepEqual(classifyPath('schema.graphql'), { kind: 'contract', format: 'text', ecosystem: null });
  assert.deepEqual(classifyPath('proto/user.proto'), { kind: 'contract', format: 'text', ecosystem: null });
  assert.deepEqual(classifyPath('service.wsdl'), { kind: 'contract', format: 'text', ecosystem: null });
  assert.deepEqual(classifyPath('contracts/orders.yaml'), { kind: 'contract', format: 'text', ecosystem: null });
  assert.deepEqual(classifyPath('src/app.js'), { kind: 'source', format: 'text', ecosystem: 'javascript' });
  assert.deepEqual(classifyPath('src/app.ts'), { kind: 'source', format: 'text', ecosystem: 'typescript' });
  assert.deepEqual(classifyPath('app.py'), { kind: 'source', format: 'text', ecosystem: 'python' });
  assert.deepEqual(classifyPath('src/main.rs'), { kind: 'source', format: 'text', ecosystem: 'rust' });
  assert.deepEqual(classifyPath('package.json'), { kind: 'package_json', format: 'json' });
  assert.deepEqual(classifyPath('README.md'), { kind: 'other', format: 'text', ecosystem: null });
});

test('T211 extractor: detectContractKind recognizes openapi and asyncapi markers', () => {
  assert.equal(detectContractKind({ text: 'openapi: 3.0.0\n', value: null, format: 'text' }), 'openapi');
  assert.equal(detectContractKind({ text: 'swagger: "2.0"\n', value: null, format: 'text' }), 'openapi');
  assert.equal(detectContractKind({ text: 'asyncapi: 2.6.0\n', value: null, format: 'text' }), 'asyncapi');
  assert.equal(detectContractKind({ text: 'title: demo\n', value: null, format: 'text' }), null);
  assert.equal(detectContractKind({ text: '', value: { openapi: '3.0.0' }, format: 'json' }), 'openapi');
  assert.equal(detectContractKind({ text: '', value: { asyncapi: '2.6.0' }, format: 'json' }), 'asyncapi');
  assert.equal(detectContractKind({ text: '', value: { title: 'x' }, format: 'json' }), null);
});

test('T211 extractor: OpenAPI JSON and YAML contracts produce a contract plus route operations', () => {
  const yaml = extractTextContract('openapi.yaml', [
    'openapi: 3.0.0',
    'info: { title: Demo }',
    'paths:',
    '  /pets:',
    '    get:',
    '      operationId: listPets',
    '    post:',
    '      operationId: createPet',
    '  /pets/{petId}:',
    '    get:',
    '      operationId: getPet',
    '',
  ].join('\n'));
  const yamlSignatures = signatures(yaml);
  assert.ok(yamlSignatures.includes('openapi:openapi.yaml'));
  assert.ok(yamlSignatures.includes('GET:/pets'));
  assert.ok(yamlSignatures.includes('POST:/pets'));
  assert.ok(yamlSignatures.includes('GET:/pets/{petId}'));
  assert.deepEqual(yaml.diagnostics, []);

  const json = extractJson('openapi.json', {
    openapi: '3.0.0',
    paths: { '/users': { get: { operationId: 'listUsers' } }, '/users/{id}': { get: {} } },
  });
  const model = modelOf(json);
  assert.deepEqual(model.operations.find(({ category }) => category === 'route')?.details.method, 'GET');
  const getPet = model.operations.find(({ signature }) => signature === 'GET:/users/{id}');
  assert.equal(getPet.status, 'observed');
  assert.equal(getPet.details.operationId, null);
});

test('T211 extractor: AsyncAPI 2.x channels become event operations', () => {
  const result = extractTextContract('asyncapi.yaml', [
    'asyncapi: 2.6.0',
    'channels:',
    '  user/signup:',
    '    publish:',
    '      message: { payload: {} }',
    '    subscribe:',
    '      message: { payload: {} }',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('asyncapi:asyncapi.yaml'));
  assert.ok(ops.includes('event:user/signup:publish'));
  assert.ok(ops.includes('event:user/signup:subscribe'));
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: AsyncAPI 3.x operations are reported partial/unverified', () => {
  const result = extractTextContract('asyncapi.yaml', 'asyncapi: 3.0.0\noperations:\n  send:\n    action: send\n');
  assert.deepEqual(signatures(result), ['asyncapi:asyncapi.yaml']);
  assert.deepEqual(result.diagnostics, [{ path: 'asyncapi.yaml', status: 'unverified', reason: 'DYNAMIC', line: null }]);
});

test('T211 extractor: GraphQL Query/Mutation/Subscription fields become RPC operations', () => {
  const result = extractTextContract('schema.graphql', [
    'type Query {',
    '  users: [User]',
    '  user(id: ID!): User',
    '}',
    'type Mutation {',
    '  createUser(input: UserInput!): User',
    '}',
    'type User {',
    '  id: ID!',
    '}',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('graphql:schema.graphql'));
  assert.ok(ops.includes('graphql:query:users'));
  assert.ok(ops.includes('graphql:query:user'));
  assert.ok(ops.includes('graphql:mutation:createUser'));
  assert.equal(ops.includes('graphql:query:id'), false, 'plain type fields are not operations');
});

test('T211 extractor: GraphQL multi-line argument continuation lines are never captured as fields', () => {
  const result = extractTextContract('schema.graphql', [
    'type Query {',
    '  users(',
    '    first: Int',
    '    after: String',
    '  ): [User]',
    '  user(id: ID!): User',
    '}',
    'type Mutation {',
    '  createUser(',
    '    input: UserInput!',
    '    notify: Boolean = false',
    '  ): User',
    '}',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('graphql:query:users'));
  assert.ok(ops.includes('graphql:query:user'));
  assert.ok(ops.includes('graphql:mutation:createUser'));
  assert.equal(ops.includes('graphql:query:first'), false, 'argument continuation must not become a field');
  assert.equal(ops.includes('graphql:query:after'), false, 'argument continuation must not become a field');
  assert.equal(ops.includes('graphql:mutation:input'), false, 'argument continuation must not become a field');
  assert.equal(ops.includes('graphql:mutation:notify'), false, 'argument continuation must not become a field');
});

test('T211 extractor: protobuf messages, services, and rpcs are extracted with lines', () => {
  const result = extractTextContract('api/user.proto', [
    'syntax = "proto3";',
    'package user;',
    'message User { string id = 1; }',
    'service UserService {',
    '  rpc GetUser (UserRequest) returns (User);',
    '  rpc ListUsers (ListUsersRequest) returns (UserList);',
    '}',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('protobuf:user.proto'));
  assert.ok(ops.includes('protobuf:message:User'));
  assert.ok(ops.includes('protobuf:service:UserService'));
  assert.ok(ops.includes('protobuf:rpc:UserService:GetUser'));
  assert.ok(ops.includes('protobuf:rpc:UserService:ListUsers'));
  const rpc = result.operations.find(({ signature }) => signature === 'protobuf:rpc:UserService:GetUser');
  assert.equal(rpc.details.service, 'UserService');
  assert.equal(rpc.details.method, 'GetUser');
  assert.equal(rpc.line, 5);
});

test('T211 extractor: WSDL operations, portTypes, bindings, services, and messages', () => {
  const result = extractTextContract('service.wsdl', [
    '<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="urn:demo">',
    '  <wsdl:message name="GetUserRequest"/>',
    '  <wsdl:portType name="UserPort">',
    '    <wsdl:operation name="GetUser">',
    '      <wsdl:input message="GetUserRequest"/>',
    '    </wsdl:operation>',
    '  </wsdl:portType>',
    '  <wsdl:binding name="UserBinding" type="UserPort"/>',
    '  <wsdl:service name="UserService"/>',
    '</wsdl:definitions>',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('wsdl:service.wsdl'));
  assert.ok(ops.includes('wsdl:message:GetUserRequest'));
  assert.ok(ops.includes('wsdl:portType:UserPort'));
  assert.ok(ops.includes('wsdl:binding:UserBinding'));
  assert.ok(ops.includes('wsdl:service:UserService'));
  assert.ok(ops.includes('wsdl:operation:GetUser'));
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: YAML anchors and malformed contracts fail with unsupported diagnostics', () => {
  const anchored = extractTextContract('openapi.yaml', 'openapi: 3.0.0\ndefaults: &base\n  x: 1\npaths:\n  /a:\n    get: *base\n');
  assert.deepEqual(anchored.operations, []);
  assert.deepEqual(anchored.diagnostics, [{ path: 'openapi.yaml', status: 'unsupported', reason: 'PARSE_UNSUPPORTED', line: null }]);
  const unknown = extractApiSurface({ path: 'api/random.yaml', text: 'title: demo\n', value: null, format: 'text', ecosystem: null });
  assert.deepEqual(unknown.operations, []);
  assert.deepEqual(unknown.diagnostics, [{ path: 'api/random.yaml', status: 'unsupported', reason: 'UNSUPPORTED', line: null }]);
});

// ---------------------------------------------------------------------------
// extractor.mjs — framework routes
// ---------------------------------------------------------------------------

test('T211 extractor: Express routes resolve literals and local constant aliases only', () => {
  const result = extractSource('src/app.js', [
    "const USERS_PATH = '/api/users';",
    "const BASE = '/api';",
    'app.get(USERS_PATH, handler);',
    "app.post('/api/users', create);",
    "router.get('/api/users/:id', read);",
    "app.use('/assets', express.static(dir));",
    "@Get('/api/health')",
    'health() {}',
    'app.get(BASE + "/users", handler);',
    "app.get(process.env.ROUTE, handler);",
    '',
  ].join('\n'), 'javascript');
  const ops = signatures(result);
  assert.ok(ops.includes('GET:/api/users'), 'constant alias resolves');
  assert.ok(ops.includes('POST:/api/users'));
  assert.ok(ops.includes('GET:/api/users/:id'));
  assert.ok(ops.includes('ANY:/assets'));
  assert.ok(ops.includes('GET:/api/health'), 'NestJS decorator');
  assert.equal(ops.includes('GET:/api'), false, 'concatenated constants never resolve');
  assert.deepEqual(result.diagnostics, [
    { path: 'src/app.js', status: 'unverified', reason: 'DYNAMIC', line: 9 },
    { path: 'src/app.js', status: 'unverified', reason: 'DYNAMIC', line: 10 },
  ]);
});

test('T211 extractor: FastAPI and Flask decorators produce routes with methods', () => {
  const fastapi = extractSource('app/main.py', [
    "BASE = '/api/v1'",
    '@app.get(BASE)',
    'def root(): ...',
    "@app.post('/api/users')",
    'def create(): ...',
    "@app.api_route('/api/anything', methods=['GET', 'POST'])",
    'def anything(): ...',
    '',
  ].join('\n'), 'python');
  const fastSignatures = signatures(fastapi);
  assert.ok(fastSignatures.includes('GET:/api/v1'));
  assert.ok(fastSignatures.includes('POST:/api/users'));
  assert.ok(fastSignatures.includes('GET:/api/anything'));
  assert.ok(fastSignatures.includes('POST:/api/anything'));

  const flask = extractSource('app.py', [
    "@app.route('/users', methods=['GET', 'POST'])",
    'def users(): ...',
    "@app.route('/health')",
    'def health(): ...',
    '',
  ].join('\n'), 'python');
  const flaskSignatures = signatures(flask);
  assert.ok(flaskSignatures.includes('GET:/users'));
  assert.ok(flaskSignatures.includes('POST:/users'));
  assert.ok(flaskSignatures.includes('GET:/health'));
});

test('T211 extractor: Django urlpatterns resolve path literals and literal-only re_path', () => {
  const result = extractSource('project/urls.py', [
    'urlpatterns = [',
    "    path('users/', views.users),",
    "    path('users/<int:pk>/', views.user),",
    "    re_path(r'^about/$', views.about),",
    "    re_path(r'^archive/(\\d+)/$', views.archive),",
    ']',
    '',
  ].join('\n'), 'python');
  const ops = signatures(result);
  assert.ok(ops.includes('ANY:/users/'), 'path literal');
  assert.ok(ops.includes('ANY:/users/{int:pk}/'), 'converter normalized to braces');
  assert.ok(ops.includes('ANY:/about/'), 'literal re_path anchors stripped');
  assert.equal(ops.includes('ANY:/archive/'), false, 'dynamic regex never becomes an endpoint');
  assert.deepEqual(result.diagnostics, [
    { path: 'project/urls.py', status: 'unverified', reason: 'DYNAMIC', line: 5 },
  ]);
});

test('T211 extractor: Actix attributes and builder, and Axum route/nest literals', () => {
  const actix = extractSource('src/main.rs', [
    '#[get("/api/health")]',
    'async fn health() -> impl Responder {}',
    '#[route("/api/ping", method="GET")]',
    'async fn ping() -> impl Responder {}',
    'web::resource("/api/items").route(web::get().to(list));',
    'web::scope("/admin").route("/x", web::get());',
    '',
  ].join('\n'), 'rust');
  const actixOps = signatures(actix);
  assert.ok(actixOps.includes('GET:/api/health'));
  assert.ok(actixOps.includes('GET:/api/ping'), 'route attribute method');
  assert.ok(actixOps.includes('ANY:/api/items'));
  assert.ok(actixOps.includes('ANY:/admin'));

  const axum = extractSource('src/main.rs', [
    'Router::new()',
    '  .route("/", get(root))',
    '  .route("/api/users", get(list).post(create))',
    '  .nest("/admin", admin_router)',
    '  .route_service("/static", serve_dir);',
    '',
  ].join('\n'), 'rust');
  const axumOps = signatures(axum);
  assert.ok(axumOps.includes('GET:/'));
  assert.ok(axumOps.includes('GET:/api/users'));
  assert.ok(axumOps.includes('POST:/api/users'));
  assert.ok(axumOps.includes('ANY:/admin'));
  assert.ok(axumOps.includes('ANY:/static'));
});

test('T211 extractor: events from emit and CustomEvent literals', () => {
  const result = extractSource('src/events.js', [
    "emitter.emit('user.created');",
    "dispatchEvent(new CustomEvent('user.updated'));",
    "emitter.emit(eventName);",
    '',
  ].join('\n'), 'javascript');
  const ops = signatures(result);
  assert.ok(ops.includes('event:emit:user.created'));
  assert.ok(ops.includes('event:custom:user.updated'));
  assert.deepEqual(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// extractor.mjs — CLI trees and public exports
// ---------------------------------------------------------------------------

test('T211 extractor: click, typer, argparse, commander, yargs, and clap CLI trees', () => {
  const python = extractSource('cli.py', [
    'import click',
    '@click.group()',
    'def cli(): ...',
    '@click.command()',
    'def build(): ...',
    'cli.add_command(build)',
    'app = typer.Typer()',
    '@app.command()',
    'def serve(): ...',
    'parser = argparse.ArgumentParser(prog="tool")',
    "sub = parser.add_subparsers()",
    "sub.add_parser('run')",
    "sub.add_parser('reset')",
    '',
  ].join('\n'), 'python');
  const pyOps = signatures(python);
  assert.ok(pyOps.includes('cli:click:cli'));
  assert.ok(pyOps.includes('cli:click:build'));
  assert.ok(pyOps.includes('cli:click:add:build'));
  assert.ok(pyOps.includes('cli:typer:serve'));
  assert.ok(pyOps.includes('cli:argparse:run'));
  assert.ok(pyOps.includes('cli:argparse:reset'));

  const js = extractSource('bin/cli.js', "program.command('build').option('-v');\nyargs.command('serve').parse();\n", 'javascript');
  const jsOps = signatures(js);
  assert.ok(jsOps.includes('cli:commander:build'));
  assert.ok(jsOps.includes('cli:commander:serve'));

  const rust = extractSource('src/main.rs', [
    '#[derive(Parser)]',
    '#[command(name = "tool")]',
    'struct Cli {',
    '  #[command(subcommand)]',
    '  command: Commands,',
    '}',
    '#[derive(Subcommand)]',
    'enum Commands {',
    '  Build,',
    '  Serve { port: u16 },',
    '}',
    '',
  ].join('\n'), 'rust');
  const rustOps = signatures(rust);
  assert.ok(rustOps.includes('cli:clap:tool'));
  assert.ok(rustOps.includes('cli:clap:subcommand:Build'));
  assert.ok(rustOps.includes('cli:clap:subcommand:Serve'));
});

test('T211 extractor: package exports, Python __all__, entry JS exports, and Rust pub items', () => {
  const pkg = extractJson('package.json', {
    exports: { '.': './src/index.js', './feature': './src/feature.js' },
    main: './src/index.js',
    bin: { demo: 'bin/cli.js' },
  });
  const pkgOps = signatures(pkg);
  assert.ok(pkgOps.includes('export:package:.'));
  assert.ok(pkgOps.includes('export:package:./feature'));
  assert.ok(pkgOps.includes('export:package:main'));
  assert.ok(pkgOps.includes('cli:bin:demo'));

  const py = extractSource('pkg/__init__.py', "__all__ = ['create_client', 'VERSION']\n", 'python');
  assert.ok(signatures(py).includes('export:python-all:create_client'));

  const js = extractSource('index.js', "export function createClient() {}\nexport const VERSION = '1.0';\nexport { helper };\n", 'javascript');
  const jsOps = signatures(js);
  assert.ok(jsOps.includes('export:js:createClient'));
  assert.ok(jsOps.includes('export:js:VERSION'));
  assert.ok(jsOps.includes('export:js:helper'));

  const nonEntry = extractSource('src/util.js', 'export function internal() {}\n', 'javascript');
  assert.deepEqual(nonEntry.operations.filter(({ category }) => category === 'public_export'), [],
    'non-entry exports are not treated as public API');

  const rust = extractSource('src/lib.rs', 'pub fn run() {}\npub struct Config;\npub use crate::util;\n', 'rust');
  const rustOps = signatures(rust);
  assert.ok(rustOps.includes('export:rust:fn:run'));
  assert.ok(rustOps.includes('export:rust:struct:Config'));
  assert.ok(rustOps.includes('export:rust:use:crate::util'));
});

// ---------------------------------------------------------------------------
// extractor.mjs — no-false-edge and unsupported
// ---------------------------------------------------------------------------

test('T211 extractor: name-only fixtures produce no operations and no edges', () => {
  const result = extractSource('src/comments.js', [
    '// GET /api/mentioned-only',
    '/*',
    '   POST /api/also-mentioned',
    '*/',
    'function getUsers() {}',
    'const USERS = "/api/unused";',
    '',
  ].join('\n'), 'javascript');
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: comment and docstring-embedded route calls produce NO operations', () => {
  const js = extractSource('src/app.js', [
    "// app.get('/fake')",
    "/* app.post('/fake') */",
    "// emitter.emit('user.created')",
    "// program.command('fake')",
    "const REAL = '/real';",
    'app.get(REAL, h);',
    '',
  ].join('\n'), 'javascript');
  assert.deepEqual(signatures(js), ['GET:/real'], 'only real code resolves');
  assert.deepEqual(js.diagnostics, []);

  const py = extractSource('app.py', [
    '"""',
    '@app.get("/fake")',
    '# path("users/")',
    '"""',
    'urlpatterns = [',
    "    # path('users/', views.users),",
    "    path('about/', views.about),",
    ']',
    '@app.get("/real")',
    'def real(): ...',
    '',
  ].join('\n'), 'python');
  const pyOps = signatures(py);
  assert.deepEqual(pyOps, ['ANY:/about/', 'GET:/real']);
  assert.deepEqual(py.diagnostics, []);

  const rust = extractSource('src/main.rs', [
    '/// #[get("/fake")]',
    '// #[post("/fake2")]',
    '#[get("/real")]',
    'async fn real_handler() -> impl Responder {}',
    '',
  ].join('\n'), 'rust');
  assert.deepEqual(signatures(rust), ['GET:/real']);
  assert.deepEqual(rust.diagnostics, []);
});

test('T211 extractor: calls embedded in string literals produce NO operations (M1)', () => {
  const js = extractSource('src/app.js', [
    'const DOC = "app.get(\'/fake\', h)";',
    'const MSG = "emitter.emit(\'user.ghost\')";',
    'const CMD = "program.command(\'fakecmd\')";',
    "const REAL = '/real';",
    'app.get(REAL, h);',
    '',
  ].join('\n'), 'javascript');
  assert.deepEqual(signatures(js), ['GET:/real'], 'string-embedded calls are rejected, real routes still resolve');
  assert.deepEqual(js.diagnostics, []);

  const py = extractSource('app.py', [
    "MSG = '@app.post(\"/fake\")'",
    'urlpatterns = [',
    "    \"path('fake/', views.fake)\",",
    "    path('real/', views.real),",
    ']',
    "@app.get('/real')",
    'def real(): ...',
    '',
  ].join('\n'), 'python');
  assert.deepEqual(signatures(py), ['ANY:/real/', 'GET:/real'], 'string-embedded decorators and path() calls never resolve');
  assert.deepEqual(py.diagnostics, []);

  const rust = extractSource('src/main.rs', [
    'let doc = "app.route(\'/fake\', get(fake_handler))";',
    'let meta = "Router::new().route(\'/fake2\', post(fake2_handler))";',
    '#[get("/real")]',
    'async fn real_handler() -> impl Responder {}',
    '',
  ].join('\n'), 'rust');
  assert.deepEqual(signatures(rust), ['GET:/real'], 'string-embedded axum route calls never resolve');
  assert.deepEqual(rust.diagnostics, []);
});

test('T211 extractor: Axum chainOf never invents methods from string content, real chains still resolve (M1)', () => {
  const result = extractSource('src/main.rs', [
    'Router::new()',
    '  .route("/api", get(handler).comment("see .post(\'/fake\')"))',
    '  .route("/users", get(list).post(create))',
    '  .route("/real", get(real))',
    '',
  ].join('\n'), 'rust');
  const ops = signatures(result);
  assert.ok(ops.includes('GET:/api'), 'decorated route still resolves');
  assert.ok(ops.includes('GET:/users'));
  assert.ok(ops.includes('POST:/users'), 'real same-line chain still resolves');
  assert.ok(ops.includes('GET:/real'));
  assert.equal(ops.includes('POST:/api'), false, 'chain method inside a string span is never invented');
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: methods= inside string arguments is never accepted, real methods= still resolve (M1)', () => {
  const result = extractSource('app/main.py', [
    '@app.api_route("/api/x", doc="methods=[\'POST\']")',
    'def anything(): ...',
    "@app.api_route('/api/real', methods=['GET', 'POST'])",
    'def real(): ...',
    "@app.route('/users', methods=['GET'])",
    'def users(): ...',
    '',
  ].join('\n'), 'python');
  const ops = signatures(result);
  assert.ok(ops.includes('ANY:/api/x'), 'decorated path resolves without invented methods');
  assert.ok(ops.includes('GET:/api/real'));
  assert.ok(ops.includes('POST:/api/real'), 'real methods= list still resolves');
  assert.ok(ops.includes('GET:/users'));
  assert.equal(ops.includes('POST:/api/x'), false, 'methods= inside a string argument never adds a method');
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: quotes inside a same-line regex literal never swallow a real route (M1)', () => {
  const result = extractSource('src/app.js', [
    "const TOKEN_RE = /['\"]+/g; app.get('/real', h);",
    'const FLAG_RE = /[^\'"\\s]+/g; app.post(\'/also-real\', c);',
    '',
  ].join('\n'), 'javascript');
  const ops = signatures(result);
  assert.ok(ops.includes('GET:/real'), 'the same-line route after a regex literal still resolves');
  assert.ok(ops.includes('POST:/also-real'));
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: calls embedded in template literals produce NO operations (M1)', () => {
  const js = extractSource('src/app.js', [
    'const TMPL = `app.post(\'/fake\', h)`;',
    'const CODE = `',
    '  const FAKE_PATH = \'/fake\';',
    '  app.get(FAKE_PATH, h);',
    '`;',
    "const REAL = '/real';",
    'app.get(REAL, h);',
    '',
  ].join('\n'), 'javascript');
  assert.deepEqual(signatures(js), ['GET:/real'], 'template-literal-embedded calls and constants are rejected');
  assert.deepEqual(js.diagnostics, []);
});

test('T211 extractor: GraphQL block strings and # comments produce NO operations (M1)', () => {
  const result = extractTextContract('schema.graphql', [
    '# type Query {',
    'type Query {',
    '  """',
    '  getFake: String',
    '  """',
    '  real: String',
    '  # ghost: String',
    '  "# quoted: String"',
    '}',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('graphql:schema.graphql'));
  assert.ok(ops.includes('graphql:query:real'), 'real fields still resolve');
  assert.equal(ops.includes('graphql:query:getFake'), false, 'block-string descriptions never become fields');
  assert.equal(ops.includes('graphql:query:ghost'), false, '# comments never become fields');
  assert.equal(ops.includes('graphql:query:quoted'), false, 'quoted text never becomes a field');
  assert.deepEqual(result.diagnostics, []);
});

test('T211 extractor: WSDL XML-comment-embedded declarations produce NO operations (M1)', () => {
  const result = extractTextContract('service.wsdl', [
    '<wsdl:definitions targetNamespace="urn:demo">',
    '  <!-- <wsdl:operation name="FakeOp"/> -->',
    '  <!--',
    '    <wsdl:portType name="FakePort">',
    '  -->',
    '  <wsdl:portType name="UserPort">',
    '    <wsdl:operation name="GetUser">',
    '      <wsdl:input message="GetUserRequest"/>',
    '    </wsdl:operation>',
    '  </wsdl:portType>',
    '  <wsdl:service name="UserService"/>',
    '</wsdl:definitions>',
    '',
  ].join('\n'));
  const ops = signatures(result);
  assert.ok(ops.includes('wsdl:service.wsdl'));
  assert.ok(ops.includes('wsdl:portType:UserPort'), 'real portType still resolves');
  assert.ok(ops.includes('wsdl:operation:GetUser'), 'real operation still resolves');
  assert.ok(ops.includes('wsdl:service:UserService'));
  assert.equal(ops.includes('wsdl:operation:FakeOp'), false, 'XML-comment-embedded operations are never extracted');
  assert.equal(ops.includes('wsdl:portType:FakePort'), false, 'XML-comment-embedded portTypes are never extracted');
  assert.deepEqual(result.diagnostics, []);
});


test('T211 extractor: unsupported ecosystems and files produce typed diagnostics', () => {
  const shell = extractSource('run.sh', '#!/bin/bash\ncurl -X GET /api/x\n', 'shell');
  assert.deepEqual(shell.operations, []);
  assert.deepEqual(shell.diagnostics, [{ path: 'run.sh', status: 'unsupported', reason: 'UNSUPPORTED', line: null }]);
  const other = extractApiSurface({ path: 'docs/guide.md', text: 'text', value: null, format: 'text', ecosystem: null });
  assert.deepEqual(other.operations, []);
  assert.deepEqual(other.diagnostics, [{ path: 'docs/guide.md', status: 'unsupported', reason: 'UNSUPPORTED', line: null }]);
});

test('T211 extractor: credential URLs are never extracted as routes', () => {
  const result = extractSource('src/app.js', "app.get('https://user:pass@example.com/api', h);\napp.post('/api/safe', h);\n", 'javascript');
  assert.deepEqual(signatures(result), ['POST:/api/safe']);
  assert.equal(JSON.stringify(result).includes('user:pass'), false);
});

test('T211 extractor: per-file caps truncate deterministically with a CAP diagnostic', () => {
  const routes = Array.from({ length: API_LIMITS.perFileOperations + 10 }, (_, index) => (
    `app.get('/r/${index}', h);`
  ));
  const result = extractSource('big/app.js', `${routes.join('\n')}\n`, 'javascript');
  assert.ok(result.operations.length <= API_LIMITS.perFileOperations);
  assert.equal(result.capped.operations, true);
  assert.ok(result.diagnostics.some(({ reason }) => reason === 'CAP'));
});

test('T211 extractor: wildcard, glob, and oversized route literals degrade to DYNAMIC and never crash the model', () => {
  const oversized = `/${'x'.repeat(300)}`;
  const result = extractSource('src/app.js', [
    "app.get('/files/*', h);",
    "app.get('/files/*.js', h);",
    `app.get('${oversized}', h);`,
    "app.get('/ok', h);",
    '',
  ].join('\n'), 'javascript');
  assert.deepEqual(signatures(result), ['GET:/ok'], 'only the representable literal survives');
  const dynamic = result.diagnostics.filter(({ reason }) => reason === 'DYNAMIC');
  assert.ok(dynamic.length >= 3, 'every unrepresentable literal is disclosed');
  assert.ok(result.diagnostics.every(({ reason }) => reason === 'DYNAMIC'));
  const model = modelOf(result);
  assert.equal(model.operations.length, 1);
});

test('T211 extractor: oversized operationId details degrade to DYNAMIC instead of crashing the model', () => {
  const json = extractJson('openapi.json', {
    openapi: '3.0.0',
    paths: {
      '/big': { get: { operationId: `op${'x'.repeat(200)}` } },
      '/ok': { get: { operationId: 'listOk' } },
    },
  });
  const ops = signatures(json);
  assert.ok(ops.includes('openapi:openapi.json'));
  assert.ok(ops.includes('GET:/ok'));
  assert.equal(ops.includes('GET:/big'), false, 'oversized operationId route is dropped');
  assert.ok(json.diagnostics.some(({ reason }) => reason === 'DYNAMIC'));
  assert.doesNotThrow(() => modelOf(json));
});

// ---------------------------------------------------------------------------
// providers/api.mjs — T210-compatible provider
// ---------------------------------------------------------------------------

test('T211 provider: emits only DIM-api-v1 categories via the provider foundation', () => {
  const model = buildApiModel({ operations: sampleCandidates(), searchSpace: SEARCH_OK });
  const results = apiProviderResult(model);
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, API_PROVIDER_ID);
  assert.equal(results[0].dimensionId, 'DIM-api-v1');
  const categories = [...new Set(results[0].observations.map(({ category }) => category))].sort();
  assert.deepEqual(categories, ['contract', 'route']);
  for (const observation of results[0].observations) {
    assert.ok(PROVIDER_CATEGORIES['DIM-api-v1'].includes(observation.category));
    assert.ok(Object.isFrozen(observation));
  }
  assert.equal(Object.isFrozen(results[0]), true);
});

test('T211 provider: matchedKeys encode path params and carry admissible evidence references', () => {
  const result = extractSource('src/api.js', "app.get('/pets/{petId}', h);", 'javascript');
  const model = modelOf(result);
  const [{ observations }] = apiObservations(model);
  assert.equal(observations[0].matchedKey, 'route:GET:/pets/%7BpetId%7D');
  assert.equal(observations[0].path, 'src/api.js');
  assert.equal(observations[0].details.signature, 'GET:/pets/%7BpetId%7D');
  assert.equal(observations[0].details.status, 'observed');
});

test('T211 provider: deterministic, immutable, and empty for empty/foreign input', () => {
  const model = buildApiModel({ operations: sampleCandidates(), searchSpace: SEARCH_OK });
  const first = apiProviderResult(model);
  const second = apiProviderResult(model);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(apiProviderResult(null), []);
  assert.deepEqual(apiProviderResult({ operations: [] }), [{ providerId: API_PROVIDER_ID, dimensionId: 'DIM-api-v1', observations: [] }]);
  assert.deepEqual(apiObservations({}), []);
});

test('T211 provider: validation bounds align with the model legal caps and never throw a bare TypeError at 5000 operations', () => {
  const flood = Array.from({ length: 5000 }, (_, index) => ({
    category: 'route', dialect: 'express', signature: `GET:/r/${index}`,
    details: { method: 'GET', operationId: null }, path: 'a/app.js', line: index + 1, status: 'observed',
  }));
  const model = buildApiModel({ operations: flood, searchSpace: SEARCH_OK });
  assert.equal(model.summary.operations, 5000);
  const observations = apiObservations(model);
  assert.equal(observations[0].observations.length, 5000, 'a legal model derives observations without a bare TypeError');
  assert.throws(
    () => apiProviderResult(model),
    (error) => error instanceof ProviderResultError && error.name === 'ProviderResultError'
      && error instanceof TypeError,
    'oversized provider results surface a typed ProviderResultError, never a bare TypeError',
  );
});

// ---------------------------------------------------------------------------
// render/api.mjs — inert renderer
// ---------------------------------------------------------------------------

test('T211 renderer: neutral markdown renders every operation with admissible evidence', () => {
  const model = buildApiModel({
    operations: [
      ...sampleCandidates(),
      {
        category: 'cli_command', dialect: 'click', signature: 'cli:click:build',
        details: { command: 'build' }, path: 'cli.py', line: 8, status: 'observed',
      },
    ],
    diagnostics: [{ path: 'src/dynamic.js', status: 'unverified', reason: 'DYNAMIC', line: 3 }],
    searchSpace: SEARCH_OK,
  });
  const markdown = createApiRenderer().render(model);
  assert.match(markdown, /^## API Surface/);
  assert.match(markdown, /3 operation\(s\)/);
  assert.match(markdown, /`src\/app\.js:2`/);
  assert.match(markdown, /`openapi\.yaml:1`/);
  assert.match(markdown, /`cli\.py:8`/);
  assert.match(markdown, /DYNAMIC \(unverified\)/);
  assert.equal(markdown.includes('\r'), false);
  assert.deepEqual(findVoiceHits(markdown), []);
});

test('T211 renderer: empty model renders a factual no-detected line and disclosed caps', () => {
  const empty = buildApiModel({ operations: [], diagnostics: [], searchSpace: SEARCH_OK });
  const markdown = createApiRenderer().render(empty);
  assert.match(markdown, /No declaration-backed API surface detected in 3 inspected file\(s\)\./);
  assert.deepEqual(findVoiceHits(markdown), []);

  const cappedModel = buildApiModel({ operations: sampleCandidates(), searchSpace: { ...SEARCH_OK, capped: true, complete: false, omittedCount: 1 } });
  const cappedMarkdown = createApiRenderer().render(cappedModel);
  assert.match(cappedMarkdown, /file read cap reached/);
});

test('T211 renderer: deterministic byte-identical output and invalid context rejection', () => {
  const model = buildApiModel({ operations: sampleCandidates(), searchSpace: SEARCH_OK });
  const first = renderApi('x', model);
  const second = renderApi('x', model);
  assert.equal(first, second);
  assert.equal(renderApi('x', null), '');
  assert.throws(() => createApiRenderer({ context: {} }), /escapeField/);
  assert.equal(Object.isFrozen(createApiRenderer()), true);
});

test('T211 inertness: API renderer is never registered in the existing-ten map', async () => {
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP).sort(), [
    'architecture', 'config', 'conventions', 'documentation', 'git',
    'operations', 'security', 'stack', 'structure', 'testing',
  ]);
  assert.equal(EXISTING_TEN_RENDERER_MAP.api, undefined);
  const existingTen = await readFile(join(LIB_ROOT, 'scan', 'render', 'existing-ten.mjs'), 'utf8');
  assert.equal(existingTen.includes("render/api.mjs"), false, 'existing-ten must not import the API renderer');
  const write = await readFile(join(LIB_ROOT, 'scan', 'write.mjs'), 'utf8');
  assert.equal(write.includes("render/api.mjs"), false, 'write must not import the API renderer');
});

// ---------------------------------------------------------------------------
// scanner.mjs — end-to-end fixtures
// ---------------------------------------------------------------------------

test('T211 scanner: JavaScript fixture extracts routes, events, CLI, and exports', async () => {
  const files = {
    'package.json': JSON.stringify({ name: 'demo', bin: { demo: 'bin/cli.js' }, exports: { '.': './src/index.js' } }),
    'src/app.js': [
      "const USERS = '/api/users';",
      'app.get(USERS, h);',
      "app.post('/api/users', c);",
      "emitter.emit('user.created');",
      "export function helper() {}",
      '',
    ].join('\n'),
    'bin/cli.js': "program.command('build');\n",
    'README.md': 'notes',
  };
  await withFixture('api-js', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'api');
    assert.equal(signal, 'high');
    assert.equal(findings.searchSpace.complete, true);
    const ops = findings.operations.map(({ signature }) => signature);
    assert.ok(ops.includes('GET:/api/users'));
    assert.ok(ops.includes('POST:/api/users'));
    assert.ok(ops.includes('event:emit:user.created'));
    assert.ok(ops.includes('cli:commander:build'));
    assert.ok(ops.includes('cli:bin:demo'));
    assert.ok(ops.includes('export:package:.'));
    assert.ok(ops.includes('export:js:helper'));
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes(dir), false, 'absolute paths never appear');
  });
});

test('T211 scanner: Python fixture extracts FastAPI/Flask/Django routes, CLI, and exports', async () => {
  const files = {
    'app.py': [
      "@app.route('/users', methods=['GET', 'POST'])",
      'def users(): ...',
      '',
    ].join('\n'),
    'api/main.py': [
      "@app.get('/api/items')",
      'def items(): ...',
      '',
    ].join('\n'),
    'project/urls.py': [
      'urlpatterns = [',
      "    path('about/', views.about),",
      ']',
      '',
    ].join('\n'),
    'pkg/__init__.py': "__all__ = ['create_client']\n",
    'cli.py': [
      '@click.command()',
      'def deploy(): ...',
      '',
    ].join('\n'),
  };
  await withFixture('api-py', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const ops = findings.operations.map(({ signature }) => signature);
    assert.ok(ops.includes('GET:/users'));
    assert.ok(ops.includes('POST:/users'));
    assert.ok(ops.includes('GET:/api/items'));
    assert.ok(ops.includes('ANY:/about/'));
    assert.ok(ops.includes('export:python-all:create_client'));
    assert.ok(ops.includes('cli:click:deploy'));
  });
});

test('T211 scanner: TypeScript fixture extracts NestJS-style routes', async () => {
  const files = {
    'src/app.controller.ts': [
      "@Get('/api/health')",
      'health() {}',
      '',
    ].join('\n'),
    'src/app.ts': [
      "app.get('/api/root', h);",
      '',
    ].join('\n'),
  };
  await withFixture('api-ts', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const ops = findings.operations.map(({ signature }) => signature);
    assert.ok(ops.includes('GET:/api/health'));
    assert.ok(ops.includes('GET:/api/root'));
  });
});

test('T211 scanner: Rust fixture extracts Axum routes, clap, and pub exports', async () => {
  const files = {
    'src/main.rs': [
      '#[derive(Parser)]',
      '#[command(name = "tool")]',
      'struct Cli {',
      '  #[command(subcommand)]',
      '  command: Commands,',
      '}',
      '#[derive(Subcommand)]',
      'enum Commands {',
      '  Build,',
      '}',
      'Router::new()',
      '  .route("/api/users", get(list))',
      '  .nest("/admin", admin);',
      '',
    ].join('\n'),
    'src/lib.rs': 'pub fn run() {}\n',
  };
  await withFixture('api-rs', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const ops = findings.operations.map(({ signature }) => signature);
    assert.ok(ops.includes('GET:/api/users'));
    assert.ok(ops.includes('ANY:/admin'));
    assert.ok(ops.includes('cli:clap:tool'));
    assert.ok(ops.includes('cli:clap:subcommand:Build'));
    assert.ok(ops.includes('export:rust:fn:run'));
  });
});

test('T211 scanner: Shell fixture yields zero operations with a complete search space', async () => {
  const files = { 'run.sh': '#!/bin/bash\necho hello\n' };
  await withFixture('api-sh', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'api');
    assert.equal(signal, 'low');
    assert.equal(findings.operations.length, 0);
    assert.equal(findings.searchSpace.complete, true);
    assert.deepEqual(findings.diagnostics, []);
  });
});

test('T211 scanner: dynamic fixtures produce diagnostics and never invent endpoints', async () => {
  const files = {
    'src/dynamic.js': [
      'app.get(process.env.ROUTE, handler);',
      'app.post(someVariable, handler);',
      '',
    ].join('\n'),
  };
  await withFixture('api-dynamic', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.deepEqual(findings.operations, []);
    assert.deepEqual(findings.diagnostics.map(({ reason }) => reason), ['DYNAMIC', 'DYNAMIC']);
  });
});

test('T211 scanner: contract and privacy canaries never reach the model', async () => {
  const files = {
    'openapi.yaml': [
      'openapi: 3.0.0',
      'info:',
      '  contact:',
      '    email: alice@example.test',
      'servers:',
      '  - url: https://user:pass@example.test/api',
      'paths:',
      '  /safe:',
      '    get: {}',
      '',
    ].join('\n'),
    'src/app.js': "app.get('https://user:pass@example.test/leak', h);\napp.get('/api/safe', h);\n",
  };
  await withFixture('api-privacy', files, async (dir) => {
    const { findings } = await scan(dir, {});
    const serialized = JSON.stringify(findings);
    for (const canary of ['alice@example.test', 'user:pass', '/leak', dir]) {
      assert.equal(serialized.includes(canary), false, `canary leaked: ${canary}`);
    }
    const ops = findings.operations.map(({ signature }) => signature);
    assert.ok(ops.includes('GET:/safe'));
    assert.ok(ops.includes('GET:/api/safe'));
  });
});

test('T211 scanner: deterministic repeated runs are byte-identical and search space is T202-compatible', async () => {
  const files = {
    'src/app.js': "app.get('/api/x', h);\napp.post('/api/y', c);\n",
  };
  await withFixture('api-determinism', files, async (dir) => {
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

test('T211 scanner: distinct read outcomes map to distinct reason codes', () => {
  assert.deepEqual(diagnosticForOutcome({ path: 'a.txt', status: 'unreadable' }),
    { path: 'a.txt', status: 'unverified', reason: 'UNREADABLE', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'b.txt', status: 'capped' }),
    { path: 'b.txt', status: 'unverified', reason: 'CAP', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'c.txt', status: 'malformed' }),
    { path: 'c.txt', status: 'unverified', reason: 'MALFORMED', line: null });
  assert.deepEqual(diagnosticForOutcome({ path: 'd.txt', status: 'unsupported' }),
    { path: 'd.txt', status: 'unverified', reason: 'UNSUPPORTED', line: null });
});

test('T211 scanner: a malformed contract artifact yields MALFORMED and never erases valid peers', async () => {
  const files = {
    'api/bad.json': '{broken',
    'src/ok.js': "app.get('/api/ok', h);\n",
  };
  await withFixture('api-outcomes', files, async (dir) => {
    const { findings } = await scan(dir, {});
    assert.deepEqual(findings.diagnostics.map(({ reason }) => reason), ['MALFORMED']);
    assert.equal(findings.searchSpace.malformed, true);
    assert.equal(findings.searchSpace.complete, false);
    assert.ok(findings.operations.some(({ signature }) => signature === 'GET:/api/ok'));
  });
});

test('T211 scanner: source sampling cap is disclosed and never overclaims completeness', async () => {
  const files = {};
  for (let index = 0; index < 109; index++) {
    files[`file-${String(index).padStart(3, '0')}.js`] = 'export const n = 1;\n';
  }
  files['zz-route.js'] = "app.get('/only-lowest-priority', h);\n";
  await withFixture('api-cap110', files, async (dir) => {
    const { dimension, signal, findings } = await scan(dir, {});
    assert.equal(dimension, 'api');
    assert.equal(signal, 'low');
    assert.equal(findings.searchSpace.complete, false, 'skipped eligible sources must never claim completeness');
    assert.equal(findings.searchSpace.capped, true);
    assert.equal(findings.searchSpace.omittedCount, 110 - API_SOURCE_FILE_LIMIT);
    assert.equal(findings.operations.length, 0, 'the skipped lowest-priority route is not claimed as found');
    const serialized = JSON.stringify(findings);
    assert.equal(serialized.includes('/only-lowest-priority'), false, 'omitted content must not be invented');
  });
});
