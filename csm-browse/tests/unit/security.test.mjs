import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, chmod, symlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

const root = await freshSessionsRoot('csm-browse-security-');
const security = await import('../../lib/security.mjs');
const { prepareRuntimeRoot, assertRuntimeRoot, validateState, validateRuntimeRootSelection, redactUrl, redactTelemetry, ensurePrivateDir, ensurePrivateFile, secureWrite } = security;
const { removeContainerSession, removeHostSession } = await import('../../lib/cleanup.mjs');
const { assertValidOutput } = await import('../../lib/recorder.mjs');
const { collectorsHook } = await import('../../lib/collectors.mjs');
const { EventEmitter } = await import('node:events');

after(async () => removeRoot(root));

test('runtime root is explicitly private and owned', async () => {
  await prepareRuntimeRoot(root);
  const info = await stat(root);
  assert.equal(info.mode & 0o777, 0o700);
  assert.doesNotThrow(() => assertRuntimeRoot(root));
});

test('runtime root rejects a file and a symlink instead of using it', async () => {
  const file = join(root, 'not-a-dir');
  await writeFile(file, 'x');
  await assert.rejects(prepareRuntimeRoot(file), /directory/);
  const target = await mkdtemp(join(tmpdir(), 'csm-browse-target-'));
  const link = join(root, 'link');
  const { symlink } = await import('node:fs/promises');
  await symlink(target, link);
  await assert.rejects(prepareRuntimeRoot(link), /directory/);
  await removeRoot(target);
});

test('validateRuntimeRootSelection applies the three-bucket rule of assertSafeAncestors', async () => {
  // User-owned parents are accepted regardless of their mode (three-bucket).
  const userOwned = await mkdtemp(join(tmpdir(), 'csm-root-uo-'));
  await chmod(userOwned, 0o700);
  assert.doesNotThrow(() => validateRuntimeRootSelection(join(userOwned, 'root')));
  await chmod(userOwned, 0o777);
  assert.doesNotThrow(() => validateRuntimeRootSelection(join(userOwned, 'root')),
    'user-owned world-writable parents are accepted (same predicate as assertSafeAncestors)');
  // Sticky-shared parents (e.g. /tmp) are accepted.
  const sticky = await mkdtemp(join(tmpdir(), 'csm-root-st-'));
  await chmod(sticky, 0o1777);
  assert.doesNotThrow(() => validateRuntimeRootSelection(join(sticky, 'root')));
  // A non-directory parent is rejected.
  const fileParent = join(root, 'not-a-dir');
  await writeFile(fileParent, 'x');
  assert.throws(() => validateRuntimeRootSelection(join(fileParent, 'root')), /must be a directory|Unsafe/);
  await removeRoot(userOwned);
  await removeRoot(sticky);
});

test('persisted state rejects unsafe profile, port, websocket, and host paths', () => {
  assert.doesNotThrow(() => validateState({ sid: 'safe-1', profileDir: '/config/csm-browse/sessions/safe-1', publicPort: 9225, wsUrl: 'ws://127.0.0.1:9225/devtools/browser/x' }, 'safe-1'));
  for (const state of [
    { sid: 'safe-1', profileDir: '/tmp/other' },
    { sid: 'safe-1', profileDir: '/config/csm-browse/sessions/other' },
    { sid: 'safe-1', publicPort: 1 },
    { sid: 'safe-1', wsUrl: 'http://127.0.0.1:9225' },
    { sid: 'safe-1', sessionDir: '/tmp/other/safe-1' },
  ]) assert.throws(() => validateState(state, 'safe-1'));
});

test('persisted state enforces the CDP auth token rules (T001)', () => {
  const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2';
  // Valid: token present, wsUrl/cdpUrl carry the SAME token, generation >= 1.
  assert.doesNotThrow(() => validateState({
    sid: 'tok-ok', token,
    tokenGeneration: 2,
    wsUrl: `ws://127.0.0.1:9225/devtools/browser/x?token=${token}`,
    cdpUrl: `http://127.0.0.1:9225?token=${token}`,
  }, 'tok-ok'));

  // Malformed tokens, mismatched URL tokens, and invalid generations are all rejected.
  for (const state of [
    { sid: 'tok-1', token: 'short' },
    { sid: 'tok-2', token: 'not a token value with spaces!!' },
    { sid: 'tok-3', token: token, wsUrl: `ws://127.0.0.1:9225/x?token=${'Y'.repeat(32)}` },
    { sid: 'tok-4', token: token, cdpUrl: `http://127.0.0.1:9225?token=${'Y'.repeat(32)}` },
    { sid: 'tok-5', token: token, tokenGeneration: 0 },
    { sid: 'tok-6', token: token, tokenGeneration: 1.5 },
  ]) assert.throws(() => validateState(state), `expected reject: ${JSON.stringify(state)}`);

  // The token must not weaken the existing userinfo rejection.
  assert.throws(() => validateState({ sid: 'tok-7', token, wsUrl: `ws://user:pass@127.0.0.1:9225/x?token=${token}` }));
  assert.throws(() => validateState({ sid: 'tok-8', token, cdpUrl: `http://user:pass@127.0.0.1:9225?token=${token}` }));

  // Fail closed: a persisted token WITHOUT a matching embedded token is
  // rejected (a URL that silently dropped its token must never be accepted).
  assert.throws(() => validateState({ sid: 'tok-9', token, wsUrl: 'ws://127.0.0.1:9225/devtools/browser/x' }), /token mismatch/);
  assert.throws(() => validateState({ sid: 'tok-10', token, cdpUrl: 'http://127.0.0.1:9225' }), /token mismatch/);
});

test('redacts credential query values and sensitive console fields but preserves diagnostics', () => {
  assert.equal(redactUrl('https://example.test/report?id=42&token=super-secret'), 'https://example.test/report?id=42&token=%5BREDACTED%5D');
  assert.equal(redactUrl('https://example.test/report#token=fragment-secret'), 'https://example.test/report#token=[REDACTED]');
  const safe = redactTelemetry({ url: 'https://example.test/page?x=1', args: [{ value: 'password=secret' }], message: 'ordinary diagnostic' });
  assert.equal(safe.url, 'https://example.test/page?x=1');
  assert.equal(safe.args[0].value, 'password=[REDACTED]');
  assert.equal(safe.message, 'ordinary diagnostic');
  assert.equal(redactTelemetry('token: secret'), 'token:[REDACTED]');
  assert.equal(redactTelemetry('{"token":"secret","message":"ordinary diagnostic"}'), '{"token":"[REDACTED]","message":"ordinary diagnostic"}');
  assert.equal(redactTelemetry({ token: 'secret', message: 'ordinary diagnostic' }).token, '[REDACTED]');
});

test('redaction handles ?token= and prose-embedded tokenized URLs', () => {
  // A LONE ?token= (no preceding &) inside a URL fragment...
  assert.equal(redactTelemetry('?token=SECRET&x=1'), '?token=[REDACTED]&x=1');
  // ...and inside prose, where the whole string is not a parseable URL (so
  // redactUrl alone cannot help and redactPairs must catch the pair).
  assert.equal(
    redactTelemetry('Connecting to ws://127.0.0.1:9225/devtools/browser/x?token=LeakyToken123'),
    'Connecting to ws://127.0.0.1:9225/devtools/browser/x?token=[REDACTED]'
  );
  assert.ok(!redactTelemetry('Connecting to ws://127.0.0.1:9225/x?token=LeakyToken123').includes('LeakyToken123'));
  // Full parseable URLs still round-trip through redactUrl after the pair pass.
  assert.ok(!redactTelemetry('ws://h/x?token=SECRET&a=1').includes('SECRET'));
  // Non-sensitive keys are untouched even when followed by a ?token= pair.
  assert.equal(redactTelemetry('a=1?token=SECRET'), 'a=1?token=[REDACTED]');
});

test('all sensitive persisted classes are private and existing files are repaired', async () => {
  const dir = join(root, 'modes');
  await ensurePrivateDir(dir);
  const paths = [
    'recorder.json', 'creating.marker', 'daemon.pid', 'daemon.ready', 'daemon.log',
    'ffmpeg-stderr.log', 'events.jsonl', 'events-1.jsonl'
  ].map(name => join(dir, name));
  for (const path of paths) await secureWrite(path, 'x', { encoding: 'utf-8' });
  const cmd = join(dir, 'cmd');
  await ensurePrivateDir(join(cmd, 'running'));
  await ensurePrivateDir(join(cmd, 'out'));
  await secureWrite(join(cmd, 'command.json'), '{}', { encoding: 'utf-8' });
  const summaryPath = join(root, 'custom-summary', 'summary.json');
  await ensurePrivateDir(join(root, 'custom-summary'));
  await secureWrite(summaryPath, '{}', { encoding: 'utf-8' });
  await chmod(paths[0], 0o644);
  await ensurePrivateFile(paths[0]);
  for (const path of [...paths, join(cmd, 'command.json'), summaryPath]) assert.equal((await stat(path)).mode & 0o777, 0o600, path);
  for (const path of [cmd, join(cmd, 'running'), join(cmd, 'out')]) assert.equal((await stat(path)).mode & 0o777, 0o700, path);
});

test('secure persistence rejects symlinked ancestors and final symlinks', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'csm-browse-outside-'));
  const parent = join(root, 'symlink-parent');
  await symlink(outside, parent);
  await assert.rejects(ensurePrivateDir(join(parent, 'child')), /symlink|ancestor/);
  const dir = join(root, 'no-final-link');
  await ensurePrivateDir(dir);
  const target = join(outside, 'target');
  await writeFile(target, 'outside');
  const link = join(dir, 'link');
  await symlink(target, link);
  await assert.rejects(secureWrite(link, 'must not follow'), /ELOOP|symlink/);
  assert.equal(await readFile(target, 'utf-8'), 'outside');
  await removeRoot(outside);
});

test('ensurePrivateDir refuses a leaf that is a symlink (no-follow leaf hardening)', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'csm-browse-leaf-outside-'));
  const leaf = join(root, 'leaf-link');
  await symlink(outside, leaf);
  // The lstat walk rejects the symlinked leaf outright.
  await assert.rejects(ensurePrivateDir(leaf), /symlink|ELOOP/);
  // The O_NOFOLLOW re-open path also refuses (the leaf's parent stays a dir).
  const parentDir = join(root, 'leaf-parent');
  await ensurePrivateDir(parentDir);
  const leaf2 = join(parentDir, 'leaf-link');
  await symlink(outside, leaf2);
  await assert.rejects(ensurePrivateDir(leaf2), /symlink|ELOOP/);
  assert.equal((await stat(parentDir)).mode & 0o777, 0o700);
  await removeRoot(outside);
});

test('generated artifact outputs are repaired to 0600 and reject symlinks', async () => {
  const artifacts = join(root, 'capture-artifacts');
  await ensurePrivateDir(artifacts);
  const output = join(artifacts, 'capture.mp4');
  await writeFile(output, 'video');
  await chmod(output, 0o644);
  await assertValidOutput(output, 1);
  assert.equal((await stat(output)).mode & 0o777, 0o600);

  const outside = await mkdtemp(join(tmpdir(), 'csm-browse-artifact-outside-'));
  const link = join(artifacts, 'redirected.mp4');
  await writeFile(join(outside, 'target.mp4'), 'outside');
  await symlink(join(outside, 'target.mp4'), link);
  await assert.rejects(assertValidOutput(link, 1), /symlink|state file/);
  await removeRoot(outside);
});

test('collector rotates event logs without widening modes', async () => {
  const dir = join(root, 'rotation');
  const client = new EventEmitter();
  client.send = async () => {};
  await collectorsHook(client, 'tab', dir);
  for (let i = 0; i < 2001; i++) client.emit('Log.entryAdded', { entry: { source: 'test', level: 'info', text: `diagnostic-${i}` } });
  const deadline = Date.now() + 5000;
  let entries = [];
  while (Date.now() < deadline) {
    entries = await readdir(dir);
    if (entries.some(name => /^events-\d+\.jsonl$/.test(name))) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const eventFiles = entries.filter(name => /^events(?:-\d+)?\.jsonl$/.test(name));
  assert.ok(eventFiles.some(name => name.startsWith('events-')));
  for (const name of eventFiles) assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600, name);
});

test('collector persistence redacts events and uses mode 0600', async () => {
  const dir = join(root, 'events-1');
  const client = new EventEmitter();
  client.send = async () => {};
  await collectorsHook(client, 'tab', dir);
  client.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ name: 'password', value: 'secret-value' }, { value: 'ordinary diagnostic' }] });
  client.emit('Network.requestWillBeSent', { requestId: '1', request: { url: 'https://example.test/?token=secret' }, type: 'Document' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const events = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim();
  assert.ok(!events.includes('secret-value') && !events.includes('token=secret'));
  assert.ok(events.includes('ordinary diagnostic'));
  assert.equal((await stat(join(dir, 'events.jsonl'))).mode & 0o777, 0o600);
});

test('destructive cleanup rejects unsafe persisted paths before calling Docker or rm', async () => {
  await assert.rejects(removeContainerSession('chromium-vnc', '/config/csm-browse/sessions/../../home'), /Unsafe container session path/);
  const outside = await mkdtemp(join(tmpdir(), 'csm-browse-outside-'));
  await assert.rejects(removeHostSession(outside), /escapes|runtime root/);
  assert.ok(existsSync(outside));
  await removeRoot(outside);
});
