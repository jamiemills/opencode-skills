import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot, backage, patchKill } from './helpers/env.mjs';

const root = await freshSessionsRoot('csm-browse-sweep-');
const { sweep } = await import('../../lib/sweep.mjs');
const { SESSIONS_ROOT } = await import('../../lib/constants.mjs');
const { execLayer, setExecLayerForTests } = await import('../../lib/docker.mjs');

after(async () => { setExecLayerForTests(); await removeRoot(root); });

// ---- shared exec-layer stubs (mutated per test; tests run sequentially) ----
const cfg = {
  pgrepHost: {},        // pgrep -af <pattern> -> stdout
  chromiumProcs: [],    // pgrepMatch user-data-dir pattern
  gateProcs: [],        // hostPgrep cdp-gate.mjs
  socatProcs: [],       // pgrepMatch TCP-LISTEN pattern (legacy container socats)
  chromeByPort: () => [],
  containerHasDir: false,
};
const pkillCalls = [];
const killCalls = [];
const containerCalls = [];
const execCalls = [];

function installStubs() {
  pkillCalls.length = 0;
  killCalls.length = 0;
  containerCalls.length = 0;
  execCalls.length = 0;
  setExecLayerForTests({
    execFile: async (cmd, args) => {
      execCalls.push([cmd, ...args]);
      if (cmd === 'pgrep') return { stdout: cfg.pgrepHost[args[1]] ?? '' };
      return { stdout: '' };
    },
    hostPgrep: async (pattern) => (pattern === 'cdp-gate.mjs' ? cfg.gateProcs : []),
    killPid: (pid, sig) => { killCalls.push([pid, sig]); },
    pgrepMatch: async (container, pattern) => {
      if (pattern === '--user-data-dir=/config/csm-browse/sessions/') return cfg.chromiumProcs;
      if (pattern.startsWith('--remote-debugging-port=')) return cfg.chromeByPort(pattern);
      if (pattern.startsWith('TCP-LISTEN:')) return cfg.socatProcs;
      return [];
    },
    pkillMatch: async (container, pattern) => { pkillCalls.push(pattern); },
    execInContainer: async (container, args) => {
      containerCalls.push(args);
      if (args[0] === 'test' && !cfg.containerHasDir) throw new Error('exit 1');
      return '';
    },
  });
}

function resetCfg() {
  cfg.pgrepHost = {};
  cfg.chromiumProcs = [];
  cfg.gateProcs = [];
  cfg.socatProcs = [];
  cfg.chromeByPort = () => [];
  cfg.containerHasDir = false;
}

async function makeSession(sid, { ageMs = null, state = null, marker = false, daemonPid = null, recorder = null } = {}) {
  const dir = join(root, sid);
  await mkdir(dir, { recursive: true });
  if (state) await writeFile(join(dir, 'state.json'), JSON.stringify(state));
  if (marker) await writeFile(join(dir, 'creating.marker'), JSON.stringify({ internal: 9224, public: 9225 }));
  if (daemonPid !== null) await writeFile(join(dir, 'daemon.pid'), String(daemonPid));
  if (recorder) await writeFile(join(dir, 'recorder.json'), JSON.stringify(recorder));
  if (ageMs !== null) {
    await backage(dir, ageMs);
    if (state) await backage(join(dir, 'state.json'), ageMs);
    if (daemonPid !== null) await backage(join(dir, 'daemon.pid'), ageMs);
    if (recorder) await backage(join(dir, 'recorder.json'), ageMs);
  }
  return dir;
}

const ME = new Set([process.pid]);
const opts = { containerName: 'chromium-vnc', ip: '172.17.0.1', ageMinutes: 10 };

test('host pass reaps a stale session with a dead daemon (container cleanup included)', async () => {
  installStubs(); resetCfg();
  const dir = await makeSession('sw-a1', { ageMs: 30 * 60 * 1000, state: { publicPort: 9225 } });
  cfg.gateProcs = [{ pid: 100, cmd: 'node scripts/cdp-gate.mjs --sid sw-a1 --port 9225 --internal 9224 --container chromium-vnc' }];
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.some((e) => e.startsWith('sid=sw-a1 ') && e.includes('port=9225')), `not reaped: ${result.swept}`);
  assert.ok(!existsSync(dir), 'stale host dir must be removed');
  assert.ok(pkillCalls.includes('--user-data-dir=/config/csm-browse/sessions/sw-a1/'));
  assert.ok(pkillCalls.includes('--database=/config/csm-browse/sessions/sw-a1/crash'));
  assert.ok(killCalls.some(([pid, sig]) => sig === 'SIGTERM'), `gate not killed: ${JSON.stringify(killCalls)}`);
  assert.ok(containerCalls.some((a) => a[0] === 'rm' && a.includes('-rf') && a.includes('/config/csm-browse/sessions/sw-a1')));
});

test('fresh creating.marker protects a session dir from both passes', async () => {
  installStubs(); resetCfg();
  const dir = await makeSession('sw-b1', { ageMs: 30 * 60 * 1000, state: { publicPort: 9225 }, marker: true });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(!result.swept.some((e) => e.includes('sw-b1')), `marker session swept: ${result.swept}`);
  assert.ok(existsSync(dir));
  assert.ok(!pkillCalls.some((p) => p.includes('sw-b1')));
  await rm(dir, { recursive: true, force: true }); // its fresh marker would suppress the gate pass below
});

test('a live daemon beats dir age (liveness-first)', async () => {
  installStubs(); resetCfg();
  const dir = await makeSession('sw-c1', { ageMs: 60 * 60 * 1000, state: {}, daemonPid: process.pid });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(!result.swept.some((e) => e.includes('sw-c1')), `live-daemon session swept: ${result.swept}`);
  assert.ok(existsSync(dir));
});

test('skipSid is honored by the host pass', async () => {
  installStubs(); resetCfg();
  await makeSession('sw-d1', { ageMs: 30 * 60 * 1000, state: {} });
  await makeSession('sw-d2', { ageMs: 30 * 60 * 1000, state: {} });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts, skipSid: 'sw-d1' }); } finally { restore(); }
  assert.ok(!result.swept.some((e) => e.includes('sw-d1')));
  assert.ok(result.swept.some((e) => e.includes('sw-d2')));
  assert.ok(existsSync(join(root, 'sw-d1')));
  await rm(join(root, 'sw-d1'), { recursive: true, force: true });
});

test('dryRun reports stale sessions without acting', async () => {
  installStubs(); resetCfg();
  const dir = await makeSession('sw-e1', { ageMs: 30 * 60 * 1000, state: { publicPort: 9227 } });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts, dryRun: true }); } finally { restore(); }
  assert.ok(result.swept.some((e) => e.startsWith('[dry] sid=sw-e1')), `no dry entry: ${result.swept}`);
  assert.ok(existsSync(dir));
  assert.equal(pkillCalls.length, 0);
  assert.equal(containerCalls.filter((a) => a[0] === 'rm').length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('orphaned host daemon (dir gone) is killed; existing session + skipSid are not', async () => {
  installStubs(); resetCfg();
  await makeSession('sw-f1', { state: {} }); // live-ish dir for one line
  cfg.pgrepHost['session-daemon.mjs --session '] = [
    '12345 /usr/bin/node scripts/session-daemon.mjs --session orph-x',
    '12346 /usr/bin/node scripts/session-daemon.mjs --session skip-x',
    '12347 /usr/bin/node scripts/session-daemon.mjs --session sw-f1',
  ].join('\n');
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts, skipSid: 'skip-x' }); } finally { restore(); }
  assert.ok(result.swept.some((e) => e === 'orphan daemon sid=orph-x pid=12345'), `orphan not killed: ${result.swept}`);
  assert.ok(!result.swept.some((e) => e.includes('skip-x')));
  assert.ok(!result.swept.some((e) => e.includes('sw-f1')));
});

test('orphaned host ffmpeg is pkilled with the escaped session path', async () => {
  installStubs(); resetCfg();
  cfg.pgrepHost['ffmpeg'] = `999 ffmpeg -f image2pipe -i pipe ${root}/ff-x/artifacts/f.webm`;
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.some((e) => e === 'orphan ffmpeg sid=ff-x'), `ffmpeg not reaped: ${result.swept}`);
  const pk = execCalls.find(([cmd, ...a]) => cmd === 'pkill' && a.join(' ').includes('ff-x'));
  assert.ok(pk, 'pkill -f for orphan ffmpeg missing');
  assert.ok(pk.includes('-f') && pk.some((a) => a.includes('ffmpeg.*') && a.includes('ff-x')), `bad pkill args: ${pk}`);
});

test('container chromium without host state is killed and its dir removed', async () => {
  installStubs(); resetCfg();
  cfg.chromiumProcs = [{ pid: 1, cmd: 'chromium --user-data-dir=/config/csm-browse/sessions/cc-x/ --remote-debugging-port=9224' }];
  cfg.gateProcs = [{ pid: 101, cmd: 'node scripts/cdp-gate.mjs --sid cc-x --port 9225 --internal 9224 --container chromium-vnc' }];
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.some((e) => e === 'orphan container chromium sid=cc-x'), `not reaped: ${result.swept}`);
  assert.ok(pkillCalls.includes('--user-data-dir=/config/csm-browse/sessions/cc-x/'));
  assert.ok(pkillCalls.includes('--database=/config/csm-browse/sessions/cc-x/crash'));
  assert.ok(killCalls.some(([pid, sig]) => sig === 'SIGTERM'), `gate not killed: ${JSON.stringify(killCalls)}`);
  assert.ok(containerCalls.some((a) => a.includes('rm') && a.includes('-rf') && a.includes('/config/csm-browse/sessions/cc-x')));
});

test('container chromium with host state.json AND container dir is left alone', async () => {
  installStubs(); resetCfg();
  await makeSession('cc-y', { state: { publicPort: 9225 } }); // fresh host dir
  cfg.chromiumProcs = [{ pid: 1, cmd: 'chromium --user-data-dir=/config/csm-browse/sessions/cc-y/ --remote-debugging-port=9224' }];
  cfg.containerHasDir = true;
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(!result.swept.some((e) => e.includes('cc-y')), `wrongly reaped: ${result.swept}`);
  assert.ok(!pkillCalls.some((p) => p.includes('cc-y')));
});

test('stale recorder.json running:true is flipped when the daemon is dead; live daemon keeps it', async () => {
  installStubs(); resetCfg();
  await makeSession('rl-x', { recorder: { running: true, name: 'x.webm' } });
  await makeSession('rl-y', { recorder: { running: true, name: 'y.webm' }, daemonPid: process.pid });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.includes('stale recorder lock sid=rl-x'), `lock not flipped: ${result.swept}`);
  const flipped = JSON.parse(await readFile(join(root, 'rl-x', 'recorder.json'), 'utf-8'));
  assert.equal(flipped.running, false);
  const kept = JSON.parse(await readFile(join(root, 'rl-y', 'recorder.json'), 'utf-8'));
  assert.equal(kept.running, true);
});

test('orphan gate without a related chromium is killed; pass skipped while a creating marker exists', async () => {
  installStubs(); resetCfg();
  cfg.gateProcs = [{ pid: 2, cmd: 'node scripts/cdp-gate.mjs --sid sw-g1 --port 9225 --internal 9224 --container chromium-vnc' }];
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.includes('orphan gate port=9225'), `gate not reaped: ${result.swept}`);
  assert.ok(killCalls.some(([pid, sig]) => pid === 2 && sig === 'SIGTERM'), `gate pid not killed: ${JSON.stringify(killCalls)}`);

  // now with an in-flight creation the whole gate pass must be skipped
  installStubs(); resetCfg();
  cfg.gateProcs = [{ pid: 3, cmd: 'node scripts/cdp-gate.mjs --sid sw-g2 --port 9227 --internal 9226 --container chromium-vnc' }];
  await makeSession('cm-x', { marker: true });
  const restore2 = patchKill(ME);
  let result2;
  try { result2 = await sweep({ ...opts }); } finally { restore2(); }
  assert.ok(!result2.swept.some((e) => e.includes('orphan gate')), `gate pass not skipped: ${result2.swept}`);
  assert.ok(!killCalls.some(([pid, sig]) => pid === 3), `gate killed during creation: ${JSON.stringify(killCalls)}`);
  await rm(join(root, 'cm-x'), { recursive: true, force: true }); // its fresh marker would suppress later passes
});

test('legacy container-side TCP-LISTEN socats on pool ports are reaped', async () => {
  installStubs(); resetCfg();
  cfg.socatProcs = [
    { pid: 1, cmd: 'socat TCP-LISTEN:9225,fork,reuseaddr,bind=172.17.0.2 TCP:127.0.0.1:9224' },
    { pid: 2, cmd: 'socat TCP-LISTEN:9999,fork,reuseaddr TCP:127.0.0.1:9998' }, // out of pool -> ignored
  ];
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(result.swept.includes('orphan container socat port=9225'), `socat not reaped: ${result.swept}`);
  assert.ok(!result.swept.some((e) => e.includes('9999')), `out-of-pool socat must be ignored: ${result.swept}`);
  assert.ok(pkillCalls.includes('TCP-LISTEN:9225,'), `legacy socat not pkilled: ${JSON.stringify(pkillCalls)}`);
  assert.ok(!pkillCalls.some((p) => p.includes('9999')), `out-of-pool socat must not be pkilled: ${JSON.stringify(pkillCalls)}`);
});

test('legacy socat pass is skipped while a creating marker exists', async () => {
  installStubs(); resetCfg();
  cfg.socatProcs = [
    { pid: 1, cmd: 'socat TCP-LISTEN:9225,fork,reuseaddr,bind=172.17.0.2 TCP:127.0.0.1:9224' },
  ];
  await makeSession('cm-y', { marker: true });
  const restore = patchKill(ME);
  let result;
  try { result = await sweep({ ...opts }); } finally { restore(); }
  assert.ok(!result.swept.some((e) => e.includes('socat')), `socat pass not skipped: ${result.swept}`);
  assert.ok(!pkillCalls.some((p) => p.includes('TCP-LISTEN')), `socat killed during creation: ${JSON.stringify(pkillCalls)}`);
  await rm(join(root, 'cm-y'), { recursive: true, force: true });
});
