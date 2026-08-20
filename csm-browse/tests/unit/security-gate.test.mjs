import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshSessionsRoot, removeRoot } from './helpers/env.mjs';

// F-001 / F-016 / F-059 / F-067-5 / F-021-eb regression gate.
//
// The F-001 spike proved at the live container that a bare
// http://localhost:9222/json/version probe returns HTTP 200 BEFORE the funnel
// change and HTTP 403 AFTER (via the token-gated shared funnel on
// 127.0.0.1:9222). These unit tests pin the gate-level and wiring-level
// contract so the regression cannot silently return without Docker.

const root = await freshSessionsRoot('csm-browse-security-gate-');

// Import AFTER setting CSM_BROWSE_SESSIONS_ROOT (constants.mjs reads it once
// at module load).
const { checkRequestLine } = await import('../../scripts/cdp-gate.mjs');
const {
  DOCKER_RUN_CMD, IMAGE, VNC_PASS_PATH, CONTAINER_ENV_FILE, CONTAINER_NETWORK,
  CONTAINER_CAP_DROP, CHROMIUM_CUSTOM_ARGS, SHARED_CDP_PORT,
  imageStaleMs, assertImageFresh, IMAGE_PINNED_AT, IMAGE_MAX_AGE_MS
} = await import('../../lib/constants.mjs');
const { buildRunArgs, pidMatchesDaemon } = await import('../../scripts/ensure-browser.mjs');

after(async () => { await removeRoot(root); });

const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2';

test('F-001 funnel: a bare (token-less) /json/version request is rejected', () => {
  const verdict = checkRequestLine('GET /json/version HTTP/1.1', TOKEN);
  assert.equal(verdict.ok, false, 'no token must never reach chromium');
});

test('F-001 funnel: a wrong token is rejected', () => {
  const verdict = checkRequestLine(`GET /json/version?token=${'Z'.repeat(32)} HTTP/1.1`, TOKEN);
  assert.equal(verdict.ok, false);
});

test('F-001 funnel: the correct token opens the request', () => {
  const verdict = checkRequestLine(`GET /json/version?token=${TOKEN} HTTP/1.1`, TOKEN);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.static, undefined);
});

test('F-001 funnel: /json/protocol is served statically without a tunnel (no token needed)', () => {
  const verdict = checkRequestLine('GET /json/protocol HTTP/1.1', TOKEN);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.static, true);
  const bad = checkRequestLine(`GET /json/protocol?token=${'Z'.repeat(32)} HTTP/1.1`, TOKEN);
  assert.equal(bad.ok, false, 'a wrong token is still rejected even on the static route');
});

test('F-001 wiring: the container no longer publishes 9222 to the host', () => {
  for (const argv of [buildRunArgs(), DOCKER_RUN_CMD.split(/\s+/)]) {
    assert.ok(!argv.some(a => /9222:9222/.test(a)), 'no -p 127.0.0.1:9222:9222 publish');
  }
  assert.ok(!DOCKER_RUN_CMD.includes('9222:9222'));
});

test('F-001 wiring: the shared port is only reachable via the token gate constant', () => {
  assert.equal(SHARED_CDP_PORT, 9222);
  assert.ok(DOCKER_RUN_CMD.includes(`--env-file ${CONTAINER_ENV_FILE}`));
});

test('F-016 hardening: run args carry cap-drop, no-new-privileges, read-only rootfs, tmpfs, and cgroup limits', () => {
  const argv = buildRunArgs();
  for (const cap of CONTAINER_CAP_DROP) {
    const i = argv.indexOf('--cap-drop');
    assert.ok(i !== -1, '--cap-drop present');
    assert.ok(argv.includes(cap), `cap ${cap} dropped`);
  }
  assert.ok(argv.includes('--security-opt') && argv.includes('no-new-privileges'));
  assert.ok(argv.includes('--read-only'));
  assert.ok(argv.includes('--tmpfs'));
  assert.ok(argv.includes('--memory') && argv.includes('--cpus') && argv.includes('--pids-limit') && argv.includes('--shm-size'));
  assert.ok(DOCKER_RUN_CMD.includes('--security-opt no-new-privileges --read-only'));
  assert.ok(DOCKER_RUN_CMD.includes('--memory'));
  assert.equal(CHROMIUM_CUSTOM_ARGS, '--remote-debugging-address=127.0.0.1');
  assert.ok(argv.includes(`-e CHROMIUM_CUSTOM_ARGS=${CHROMIUM_CUSTOM_ARGS}`) || argv.some(a => a === `CHROMIUM_CUSTOM_ARGS=${CHROMIUM_CUSTOM_ARGS}`));
});

test('F-016 hardening: container is on the dedicated bridge, off the default bridge', () => {
  assert.equal(CONTAINER_NETWORK, 'csm-browse-net');
  assert.ok(DOCKER_RUN_CMD.includes('--network csm-browse-net'));
});

test('F-001 wiring: VNC live view is still published on 5900', () => {
  assert.ok(DOCKER_RUN_CMD.includes('-p 127.0.0.1:5900:5900'));
});

test('F-067-5: the VNC password path is single-sourced (no hardcoded ~/.config literal in the run command)', () => {
  assert.ok(VNC_PASS_PATH.includes('csm-browse') && VNC_PASS_PATH.endsWith('vnc-pass'));
  assert.ok(DOCKER_RUN_CMD.includes('--env-file'), 'password travels via --env-file, never inline argv');
  assert.ok(!/VNC_PASSWORD=[^ ]+/.test(DOCKER_RUN_CMD), 'no inline VNC_PASSWORD=<value> in the printed run command');
  assert.ok(!DOCKER_RUN_CMD.includes('$(cat ~/.config/csm-browse/vnc-pass)'), 'no hardcoded $(cat ...) form');
});

test('F-001 wiring: the printed run command pins the digest IMAGE', () => {
  assert.ok(DOCKER_RUN_CMD.includes(IMAGE));
  assert.match(IMAGE, /@sha256:[0-9a-f]{64}/);
});

test('F-059: the pinned image digest age is tracked and enforced', () => {
  const fresh = new Date(IMAGE_PINNED_AT.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(imageStaleMs(fresh), 0, 'a 30-day-old pin is not stale');
  assert.doesNotThrow(() => assertImageFresh(fresh));

  const stale = new Date(IMAGE_PINNED_AT.getTime() + IMAGE_MAX_AGE_MS + 10 * 24 * 60 * 60 * 1000);
  assert.ok(imageStaleMs(stale) > 0, 'a pin past the 90-day window is stale');
  assert.throws(() => assertImageFresh(stale), /stale/);
});

test('F-021-eb: daemon pid liveness requires an argv identity match', { timeout: 15000 }, async () => {
  // A child whose argv names session-daemon.mjs --session <sid> matches.
  const dir = await mkdtemp(join(tmpdir(), 'csm-browse-gate-'));
  const fakeDaemon = join(dir, 'session-daemon.mjs');
  await writeFile(fakeDaemon, 'setInterval(() => {}, 1000);\n');
  const child = spawn(process.execPath, [fakeDaemon, '--session', 'csm-gate-xyz'], { stdio: 'ignore' });

  // A child whose argv has no daemon identity must NOT match.
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });

  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { process.kill(child.pid, 0); break; } catch { await new Promise(r => setTimeout(r, 25)); }
    }
    assert.equal(pidMatchesDaemon(child.pid, 'csm-gate-xyz'), true, 'daemon argv for the right sid matches');
    assert.equal(pidMatchesDaemon(child.pid, 'other-sid'), false, 'the same pid must not match a different sid');
    assert.equal(pidMatchesDaemon(unrelated.pid, 'csm-gate-xyz'), false, 'an unrelated process is never the daemon');
    assert.equal(pidMatchesDaemon(999999999, 'csm-gate-xyz'), false, 'a missing /proc pid is never "alive"');
  } finally {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
    try { process.kill(unrelated.pid, 'SIGKILL'); } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});
