import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEvidence } from '../lib/scan/contracts/evidence.mjs';
import {
  ArtifactError,
  boundedBytes,
  readArtifacts,
  resolveArtifactReference,
} from '../lib/scan/shared/artifacts.mjs';
import {
  assertPrivacySafe,
  createOpaqueOwnerSummary,
  prepareEvidenceForPersistence,
  PrivacyError,
  projectSarif,
  projectSbom,
  redactText,
  sanitizeUrl,
  serializeEvidenceForOutput,
} from '../lib/scan/shared/privacy.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'csm-scan-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested', 'text.txt'), 'alpha\nbeta\n');
  await writeFile(join(root, 'nested', 'data.json'), '{"items":[1,2]}');
  await writeFile(join(root, 'nested', 'records.json'), '[1,2,3,4]');
  await writeFile(join(root, 'nested', 'deep.json'), '{"a":{"b":{"c":1}}}');
  await writeFile(join(root, 'nested', 'bad.json'), '{bad');
  await writeFile(join(root, 'nested', 'bad.txt'), Buffer.from([0xc3, 0x28]));
  await writeFile(join(root, 'nested', 'unsupported.txt'), 'unsupported');
  return root;
}

const LIMITS = Object.freeze({ maxFiles: 20, maxBytes: 10_000, maxRecords: 100, maxDepth: 8 });

function request(path, format = 'text', sensitivity = 'internal') {
  return { path, format, sensitivity };
}

function evidence(overrides = {}) {
  return createEvidence({
    claimId: 'CLM-assurance-artifact-v1',
    detectorId: 'DET-artifact-privacy-v1',
    sourceKind: 'artifact_metadata',
    category: 'artifact',
    path: 'nested/text.txt',
    locator: 'line:1',
    matchedKey: 'artifact',
    details: null,
    ...overrides,
  });
}

test('T206 artifact references enforce lexical, realpath, symlink, and regular-file safety', async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'csm-scan-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'outside');
  await symlink(join(outside, 'secret.txt'), join(root, 'nested', 'escape.txt'));
  await symlink(join(root, 'nested', 'text.txt'), join(root, 'linked.txt'));

  const resolved = await resolveArtifactReference(root, { path: 'nested/text.txt', sensitivity: 'public' });
  assert.deepEqual(resolved, { path: 'nested/text.txt', sensitivity: 'public', size: 11 });
  assert.equal(JSON.stringify(resolved).includes(root), false);
  assert.equal(Object.isFrozen(resolved), true);
  for (const path of ['../secret', '/etc/passwd', 'C:/secret', 'C:\\secret', '//server/share', '\\\\server\\share', 'a\0b']) {
    await assert.rejects(resolveArtifactReference(root, { path, sensitivity: 'internal' }), ArtifactError, path);
  }
  await assert.rejects(resolveArtifactReference(root, { path: 'linked.txt', sensitivity: 'internal' }), { code: 'SYMLINK' });
  await assert.rejects(resolveArtifactReference(root, { path: 'nested/escape.txt', sensitivity: 'internal' }), { code: 'SYMLINK' });
  await assert.rejects(resolveArtifactReference(root, { path: 'nested', sensitivity: 'internal' }), { code: 'NOT_REGULAR_FILE' });
});

test('T206 bounded reads return deterministic T202-compatible typed outcomes and counts', async (t) => {
  const root = await fixture(t);
  const result = await readArtifacts(root, [
    request('nested/text.txt'),
    request('nested/missing.txt'),
    request('nested/unsupported.txt', 'yaml'),
    request('nested/bad.json', 'json'),
    request('nested/bad.txt'),
    request('nested/data.json', 'json'),
  ], LIMITS);
  assert.deepEqual(result.results.map(({ path, status }) => [path, status]), [
    ['nested/bad.json', 'malformed'],
    ['nested/bad.txt', 'malformed'],
    ['nested/data.json', 'read'],
    ['nested/missing.txt', 'unreadable'],
    ['nested/text.txt', 'read'],
    ['nested/unsupported.txt', 'unsupported'],
  ]);
  assert.deepEqual(Object.keys(result.searchSpace).sort(), [
    'ambiguous', 'byteLimit', 'bytesInspected', 'capped', 'complete', 'error',
    'fileLimit', 'filesInspected', 'malformed', 'omittedCount', 'readable',
    'recordLimit', 'recordsInspected', 'supported',
  ]);
  assert.equal(result.searchSpace.complete, false);
  assert.equal(result.searchSpace.error, true);
  assert.equal(result.searchSpace.malformed, true);
  assert.equal(result.searchSpace.supported, false);
  assert.equal(result.results.every(Object.isFrozen), true);
  assert.throws(() => result.results.push({}), TypeError);
});

test('T206 file, byte, record, and structural depth caps never return partial values', async (t) => {
  const root = await fixture(t);
  const fileCap = await readArtifacts(root, [request('nested/data.json', 'json'), request('nested/text.txt')], {
    ...LIMITS, maxFiles: 1,
  });
  assert.deepEqual(fileCap.results.map(({ status }) => status), ['read', 'capped']);
  assert.equal(fileCap.searchSpace.filesInspected, 1);
  assert.equal(fileCap.searchSpace.omittedCount, 1);

  const byteCap = await readArtifacts(root, [request('nested/text.txt')], { ...LIMITS, maxBytes: 5 });
  assert.equal(byteCap.results[0].status, 'capped');
  assert.equal(byteCap.results[0].value, null);
  assert.equal(byteCap.searchSpace.bytesInspected, 5);

  const recordCap = await readArtifacts(root, [request('nested/records.json', 'json')], { ...LIMITS, maxRecords: 2 });
  assert.equal(recordCap.results[0].status, 'capped');
  assert.equal(recordCap.results[0].value, null);
  assert.equal(recordCap.searchSpace.recordsInspected, 2);
  assert.equal(recordCap.searchSpace.omittedCount, 2);

  const depthCap = await readArtifacts(root, [request('nested/deep.json', 'json')], { ...LIMITS, maxDepth: 2 });
  assert.equal(depthCap.results[0].status, 'malformed');
});

test('T206 URL sanitizer strips credentials, query, fragment, and normalizes safe authority', () => {
  assert.equal(
    sanitizeUrl('HTTPS://user:password@Example.COM:443/a/b?token=secret#private'),
    'https://example.com/a/b',
  );
  assert.equal(sanitizeUrl('http://EXAMPLE.com:80'), 'http://example.com/');
  assert.equal(sanitizeUrl('https://example.com:8443/a%20b'), 'https://example.com:8443/a%20b');
  assert.equal(sanitizeUrl('https://example.com/../private'), 'https://example.com/private');
  for (const unsafe of ['file:///etc/passwd', 'not a url']) {
    assert.throws(() => sanitizeUrl(unsafe), PrivacyError);
  }
  for (const unsafe of [
    'https://example.com/a%2Fb/c',
    'https://example.com/%2e%2e%2fetc/passwd',
    'https://example.com/..%2f..%2fetc%2fpasswd',
    'https://example.com/a%3Fb',
    'https://example.com/a%23b',
  ]) {
    assert.throws(() => sanitizeUrl(unsafe), PrivacyError, unsafe);
  }
  assert.equal(sanitizeUrl('https://example.com/a%2eb/c'), 'https://example.com/a%2eb/c');
});

const CANARIES = Object.freeze({
  personalName: 'Alice Example',
  email: 'alice@example.test',
  posixPath: '/home/alice/private.txt',
  genericPosixPath: '/workspace/project/private.txt',
  windowsPath: 'C:\\Users\\Alice\\private.txt',
  uncPath: '\\\\server\\share\\private.txt',
  doubleSlashPath: '//etc/passwd',
  forwardSlashUnc: '//server/share/private.txt',
  credential: 'password=hunter2',
  token: 'token=ghp_abcdefghijklmnopqrstuvwxyz',
  accessToken: 'access_token=wxyz0123456789',
  refreshToken: 'refresh_token=aabbccdd001122334455',
  authToken: 'auth_token=feedfacecafebabe1234',
  session: 'session=abc123xyz',
  secret: '-----BEGIN PRIVATE KEY-----',
  commitSubject: 'subject: Fix Alice private account',
  codeownersIdentity: '@alice-team',
  urlCredential: 'https://alice:hunter2@example.test/repo',
});

test('T206 every privacy canary is rejected from structured and serialized surfaces with safe errors', () => {
  for (const [kind, canary] of Object.entries(CANARIES)) {
    for (const surface of [{ kind, value: canary }, JSON.stringify({ kind, value: canary })]) {
      assert.throws(() => assertPrivacySafe(surface), (error) => {
        assert.ok(error instanceof PrivacyError);
        assert.equal(error.message.includes(canary), false);
        assert.equal(JSON.stringify(error).includes(canary), false);
        return true;
      });
    }
    assert.equal(redactText(canary), '[redacted]');
  }
  assert.throws(() => assertPrivacySafe({ subject: 'ordinary lowercase words' }), { code: 'SENSITIVE_FIELD' });
});

test('T206 evidence is privacy-validated before persistence and output serialization', () => {
  const safe = evidence();
  const persisted = prepareEvidenceForPersistence([safe]);
  const output = serializeEvidenceForOutput([safe]);
  assert.deepEqual(JSON.parse(output), persisted);
  assert.equal(output.endsWith('\n'), true);
  assert.equal(Object.isFrozen(persisted), true);
  assert.notEqual(persisted[0], safe);
  assert.throws(() => persisted[0].path = 'changed', TypeError);

  const unsafe = evidence({ matchedKey: 'token:ghp_abcdefghijklmnopqrstuvwxyz' });
  assert.throws(() => prepareEvidenceForPersistence([unsafe]), { code: 'UNSAFE_EVIDENCE' });
  assert.throws(() => serializeEvidenceForOutput([unsafe]), { code: 'UNSAFE_EVIDENCE' });
});

test('T206 opaque owner labels and aggregate counts are deterministic and reveal no identities', () => {
  const first = createOpaqueOwnerSummary(['alice@example.test', '@team-z', 'alice@example.test', 'Bob Person']);
  const second = createOpaqueOwnerSummary(['Bob Person', 'alice@example.test', '@team-z', 'alice@example.test']);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    owners: [
      { label: 'Owner-001', count: 1 },
      { label: 'Owner-002', count: 1 },
      { label: 'Owner-003', count: 2 },
    ],
    totalIdentities: 3,
    totalAssignments: 4,
  });
  const serialized = JSON.stringify(first);
  for (const identity of ['alice@example.test', '@team-z', 'Bob Person']) assert.equal(serialized.includes(identity), false);
  assert.equal(assertPrivacySafe(first), first);
  assert.throws(() => first.owners[0].count = 99, TypeError);
});

test('T206 SARIF projection keeps bounded identifiers and counts while dropping all nested hazards', () => {
  const sarif = {
    version: '2.1.0',
    $schema: 'https://example.test/schema?secret=value',
    runs: [{
      tool: { driver: { name: 'safe-tool', rules: [{ id: 'RULE-2', helpUri: 'https://user:pass@example.test' }] } },
      results: [{
        ruleId: 'RULE-1',
        message: { text: CANARIES.personalName },
        locations: [{ physicalLocation: { artifactLocation: { uri: CANARIES.posixPath }, region: { snippet: { text: CANARIES.token } } } }],
        codeFlows: [{ threadFlows: [{ locations: [{ location: { message: { text: CANARIES.email } } }] }] }],
      }],
    }],
  };
  const projection = projectSarif(sarif);
  assert.deepEqual(projection, {
    format: 'sarif', schemaVersion: '2.1.0', runCount: 1, resultCount: 1,
    tools: ['safe-tool'], rules: ['RULE-1', 'RULE-2'],
  });
  const serialized = JSON.stringify(projection);
  for (const canary of Object.values(CANARIES)) assert.equal(serialized.includes(canary), false);
  assert.equal(/message|snippet|codeFlow|uri/i.test(serialized), false);
  assert.throws(() => projection.rules.push('RULE-3'), TypeError);
});

test('T206 SBOM projection keeps safe coordinates/licenses/counts and drops nested hazards', () => {
  const sbom = {
    bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: CANARIES.secret,
    metadata: { authors: [{ name: CANARIES.personalName, email: CANARIES.email }] },
    components: [{
      name: 'ignored-name', version: '9.9.9', purl: 'pkg:npm/%40scope/package@1.2.3',
      licenses: [{ license: { id: 'MIT', url: 'https://example.test?token=secret' } }],
      hashes: [{ alg: 'SHA-256', content: CANARIES.token }],
      externalReferences: [{ type: 'vcs', url: 'https://user:pass@example.test/repo?secret=yes' }],
      supplier: { name: CANARIES.personalName },
      components: [{ name: 'nested-package', version: '2.0.0', licenses: [{ license: { id: 'Apache-2.0' } }] }],
    }],
  };
  const projection = projectSbom(sbom);
  assert.deepEqual(projection, {
    format: 'CycloneDX', specVersion: '1.6', componentCount: 2,
    licenses: ['Apache-2.0', 'MIT'], packageCoordinates: ['nested-package@2.0.0', 'pkg:npm/%40scope/package@1.2.3'],
  });
  const serialized = JSON.stringify(projection);
  for (const canary of Object.values(CANARIES)) assert.equal(serialized.includes(canary), false);
  assert.equal(/contact|serial|download|vcs|hash|author|supplier/i.test(serialized), false);
});

test('T206 Proxy, accessor, depth, and count bombs fail closed without reflecting values', async (t) => {
  const root = await fixture(t);
  const proxy = new Proxy({}, { ownKeys() { throw new Error(CANARIES.secret); } });
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { throw new Error(CANARIES.token); } });
  for (const bomb of [proxy, accessor]) {
    assert.throws(() => assertPrivacySafe(bomb), (error) => error instanceof PrivacyError
      && !error.message.includes(CANARIES.secret) && !error.message.includes(CANARIES.token));
  }
  let deep = 'safe';
  for (let index = 0; index < 20; index++) deep = { child: deep };
  assert.throws(() => assertPrivacySafe(deep), { code: 'DEPTH_LIMIT' });
  assert.throws(() => projectSarif({ version: '2.1.0', runs: Array(4097).fill({}) }), PrivacyError);
  assert.throws(() => projectSbom({ components: Array(4097).fill({ name: 'safe' }) }), PrivacyError);
  await assert.rejects(readArtifacts(root, [new Proxy(request('nested/text.txt'), {})], LIMITS), ArtifactError);
  await assert.rejects(readArtifacts(root, Array(4097).fill(null), LIMITS), { code: 'BOUND_EXCEEDED' });
});

test('T206 evidence serialization round-trips realistic lists and still rejects canaries', () => {
  const records = Array.from({ length: 20 }, (_, index) => evidence({
    locator: `line:${index + 1}:${'a'.repeat(48)}`,
  }));
  const persisted = prepareEvidenceForPersistence(records);
  const output = serializeEvidenceForOutput(records);
  assert.ok(output.length > 2048);
  assert.deepEqual(JSON.parse(output), persisted);
  assert.equal(output.endsWith('\n'), true);
  assert.equal(Object.isFrozen(persisted), true);
  for (const canary of Object.values(CANARIES)) assert.equal(output.includes(canary), false);

  const flagged = [...records, evidence({ locator: 'line:99', matchedKey: 'access_token:feedfacecafebabe1234' })];
  assert.throws(() => prepareEvidenceForPersistence(flagged), { code: 'UNSAFE_EVIDENCE' });
  assert.throws(() => serializeEvidenceForOutput(flagged), { code: 'UNSAFE_EVIDENCE' });
});

test('T206 labeled secrets are caught while token-like safe labels stay clear', () => {
  for (const secret of [
    'access_token=wxyz0123456789',
    'access_token:feedfacecafebabe1234',
    'refresh_token=aabbccdd001122334455',
    'auth_token=feedfacecafebabe1234',
    'session=abc123xyz',
    'session: abc123xyz',
    'client_token=opaquehighEntropyValue987654',
    'api_key = sk-abcdefghijklmnopqrstuvwxyz123456',
  ]) {
    assert.equal(redactText(secret), '[redacted]');
    assert.throws(() => assertPrivacySafe({ value: secret }), PrivacyError);
  }
  for (const safe of [
    'session_id=abc123',
    'token_store=value',
    'tokens=abc123',
    'tokenize(input)',
    'api_token_url=https://example.test/a',
    'x_tokenizer',
    'token',
  ]) {
    assert.equal(redactText(safe), safe);
    assert.doesNotThrow(() => assertPrivacySafe({ value: safe }));
  }
});

test('T206 bounded reads reopen with O_NOFOLLOW and re-verify inode/realpath containment', async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'csm-scan-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'outside');

  const resolved = await resolveArtifactReference(root, { path: 'nested/data.json', sensitivity: 'public' });
  assert.equal(resolved.size, 15);
  assert.deepEqual(Object.keys(resolved).sort(), ['path', 'sensitivity', 'size']);
  assert.equal(JSON.stringify(resolved).includes(root), false);

  await rm(join(root, 'nested', 'data.json'));
  await symlink(join(outside, 'secret.txt'), join(root, 'nested', 'data.json'));
  await assert.rejects(boundedBytes(join(root, resolved.path), 10_000, resolved), { code: 'UNREADABLE' });
  await assert.rejects(readArtifacts(root, [request('nested/data.json')], LIMITS), { code: 'SYMLINK' });

  const swapped = await resolveArtifactReference(root, { path: 'nested/text.txt', sensitivity: 'public' });
  await writeFile(join(root, 'nested', 'replacement.txt'), 'other');
  await rename(join(root, 'nested', 'replacement.txt'), join(root, 'nested', 'text.txt'));
  await assert.rejects(boundedBytes(join(root, swapped.path), 10_000, swapped), { code: 'UNREADABLE' });

  const fresh = await resolveArtifactReference(root, { path: 'nested/text.txt', sensitivity: 'public' });
  const capped = await boundedBytes(join(root, fresh.path), 3, fresh);
  assert.equal(capped.capped, true);
  assert.equal(capped.bytes.toString(), 'oth');
  const read = await boundedBytes(join(root, fresh.path), 10_000, fresh);
  assert.equal(read.capped, false);
  assert.equal(read.bytes.toString(), 'other');
});
