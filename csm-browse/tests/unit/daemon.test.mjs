import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';
import { startFakeCdp } from './helpers/fake-cdp-server.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // csm-browse/
const root = await freshSessionsRoot('csm-browse-daemon-');

after(async () => { await removeRoot(root); });

function spawnDaemon(sid) {
  return spawn(process.execPath, ['scripts/session-daemon.mjs', '--session', sid], {
    cwd: SKILL_DIR,
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function waitExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), ms);
    if (timer.unref) timer.unref();
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

test('daemon writes pid+ready markers, then removes them on CDP disconnect', { timeout: 30000 }, async () => {
  const sid = 'dm-a';
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });

  const server = await startFakeCdp({
    responses: {
      'Target.getTargets': () => ({ targetInfos: [{ type: 'page', targetId: 't1', url: 'about:blank' }] }),
      'Target.attachToTarget': () => ({ sessionId: 'TAB1' }),
    },
  });
  await writeFile(join(sDir, 'state.json'), JSON.stringify({ wsUrl: server.url, internalPort: 9224, publicPort: 9225 }));

  const child = spawnDaemon(sid);
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const deadline = Date.now() + 15000;
  while (!existsSync(join(sDir, 'daemon.ready')) && Date.now() < deadline) await sleep(50);
  assert.ok(existsSync(join(sDir, 'daemon.ready')), `daemon.ready never appeared (${stderr})`);
  assert.equal((await readFile(join(sDir, 'daemon.pid'), 'utf-8')).trim(), String(child.pid), 'wx pid claim wrong');
  assert.ok(existsSync(join(sDir, 'daemon.log')), 'daemon.log missing');

  server.closeAll(); // chromium "gone": CDP connection lost
  const code = await waitExit(child, 15000);
  assert.equal(code, 0, `daemon exit code ${code} (${stderr})`);
  assert.ok(!existsSync(join(sDir, 'daemon.pid')), 'daemon.pid not removed on disconnect');
  assert.ok(!existsSync(join(sDir, 'daemon.ready')), 'daemon.ready not removed on disconnect');
  assert.ok(existsSync(join(sDir, 'cmd')) && existsSync(join(sDir, 'cmd', 'out')), 'queue dirs must survive');
  await server.stop();
});

test('a second daemon refuses to start while the pid-file holder is alive', { timeout: 20000 }, async () => {
  const sid = 'dm-b';
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });
  await writeFile(join(sDir, 'daemon.pid'), String(process.pid)); // alive: this test process

  const child = spawnDaemon(sid);
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await waitExit(child, 15000);
  assert.equal(code, 2, `expected refusal exit 2, got ${code} (${stderr})`);
  assert.ok(!existsSync(join(sDir, 'daemon.ready')), 'ready marker must not exist');
  assert.equal((await readFile(join(sDir, 'daemon.pid'), 'utf-8')).trim(), String(process.pid), 'foreign pid claim must be untouched');
});

test('queue: ts-ordered claims, malformed cmd -> error out-file, stale running/ unblocked', { timeout: 30000 }, async () => {
  const sid = 'dm-q';
  const sDir = join(root, sid);
  await mkdir(sDir, { recursive: true });
  const resultFile = join(sDir, 'queue-result.json');

  const child = spawn(process.execPath, [join(SKILL_DIR, 'tests', 'unit', 'helpers', 'queue-runner.mjs'), sDir, resultFile], {
    env: { ...process.env, CSM_BROWSE_SESSIONS_ROOT: root },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const code = await waitExit(child, 25000);
  assert.equal(code, 0, `queue-runner failed: ${code} (${stderr})`);
  const r = JSON.parse(await readFile(resultFile, 'utf-8'));

  // filename order is SECOND,FIRST; ts order must win
  assert.deepEqual(r.navigateOrder, ['first://a', 'second://b']);
  assert.equal(r.firstOut.ok, true);
  assert.equal(r.firstOut.result.url, 'first://a');
  assert.equal(r.secondOut.ok, true);
  assert.equal(r.brokenOut.ok, false);
  assert.equal(r.brokenOut.error, 'malformed command file');
  assert.equal(r.staleOut.ok, false);
  assert.equal(r.staleOut.error, 'daemon restarted while command was running');
  assert.equal(r.cmdJsonLeft, 0, 'unconsumed cmd .json files must not remain');
  assert.equal(r.runningLeft, 0, 'running/ claims must be drained');
  assert.ok(r.dirsSurvive, 'cmd/running + cmd/out must never be wiped');
});
