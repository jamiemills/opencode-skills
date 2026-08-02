#!/usr/bin/env node
import { execFile, exec } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_DIR = '/home/jamiemills/.config/opencode/skills/csm-browse';
const FIXTURE_BASE = 'http://172.17.0.1:8090';
const QUICK = process.argv.includes('--quick');
const SESSION_ID = `e2e-${Date.now()}`;
const DOCS_DIR = '/home/jamiemills/.agents/docs';

let passCount = 0;
let failCount = 0;
let serverPid = null;

function pass(step, msg) {
  passCount++;
  console.log(`PASS: ${step}${msg ? ' - ' + msg : ''}`);
}

function fail(step, msg) {
  failCount++;
  console.log(`FAIL: ${step} - ${msg}`);
}

function assert(step, condition, msg) {
  if (condition) pass(step, msg);
  else fail(step, msg || 'assertion failed');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

function shell(command, opts = {}) {
  return new Promise((resolve) => {
    exec(command, { timeout: opts.timeout || 60000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

function dockerArgs(args) {
  return ['exec', 'chromium-vnc', ...args];
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = exec(
      `node '${join(SKILL_DIR, 'tests', 'serve.mjs')}'`,
      { cwd: SKILL_DIR, timeout: 60000 },
      () => {}
    );
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) { try { child.kill('SIGTERM'); } catch {} reject(new Error('timeout waiting for server READY')); }
    }, 10000);
    child.stdout.on('data', (data) => {
      if (!started && data.toString().includes('READY')) {
        started = true; clearTimeout(timeout); serverPid = child.pid; resolve(true);
      }
    });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => {
      if (!started) { clearTimeout(timeout); reject(new Error(`server exited with code ${code}`)); }
    });
    child.on('error', reject);
  });
}

function killServer() {
  if (serverPid) {
    try { process.kill(serverPid, 'SIGTERM'); } catch {}; serverPid = null;
  }
}

async function ensureSession() {
  const { error, stdout } = await run('node', [
    join(SKILL_DIR, 'scripts', 'ensure-browser.mjs'),
    '--session', SESSION_ID
  ], { timeout: 120000 });
  if (error && !stdout) throw error;
  const lines = stdout.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  let state;
  try { state = JSON.parse(lastLine); } catch {
    throw new Error(`ensure-browser did not output valid JSON state. Last line: ${lastLine}`);
  }
  return state;
}

async function browse(verb, ...args) {
  const allArgs = [join(SKILL_DIR, 'scripts', 'browse.mjs'), verb, '--session', SESSION_ID, ...args];
  const { error, stdout, stderr } = await run('node', allArgs, { timeout: 35000 });
  return { ok: !error, stdout, stderr };
}

function parseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

async function checkContainerDir(path) {
  const { stdout } = await run('docker', dockerArgs(['sh', '-c', `test -d "${path}" && echo exists`]));
  return stdout.trim() === 'exists';
}

async function checkContainerProcesses(pattern) {
  try {
    const { stdout } = await run('docker', dockerArgs(['pgrep', '-af', pattern]));
    return stdout.trim().length > 0;
  } catch { return false; }
}

// ── Main test flow ────────────────────────────────────────────────

async function runTests() {
  let state = null;

  try {
    console.log(`\n=== csm-browse E2E Suite ===`);
    console.log(`Session: ${SESSION_ID}`);
    console.log(`Quick mode: ${QUICK ? 'ON (skipping video & daemon restart)' : 'OFF'}\n`);

    // ── Pre-cleanup ───────────────────────────────────────────────
    try {
      const { stdout } = await shell('fuser 8090/tcp 2>/dev/null');
      if (stdout.trim()) {
        await shell('fuser -k 8090/tcp 2>/dev/null');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch {}

    // ── Step 1: Baseline ──────────────────────────────────────────
    {
      const step = '1. Baseline';
      try {
        const { stdout: pidOut } = await run('docker', dockerArgs(['pgrep', '-af', '--', '--remote-debugging-port=9223']));
        const defaultAlive = pidOut.trim().split('\n').filter(Boolean).length > 0;
        assert(step + ' - default chromium running (port 9223)', defaultAlive,
          `got PIDs: ${pidOut.trim().split('\n').slice(0, 3).join(',')}`);

        const { stdout: cdpOut } = await run('curl', ['-s', 'http://localhost:9222/json/version']);
        const cdpJson = parseJson(cdpOut);
        assert(step + ' - CDP responsive', !!(cdpJson && cdpJson.webSocketDebuggerUrl),
          cdpJson ? cdpJson.Browser || 'connected' : `no response: "${cdpOut.substring(0, 80)}"`);

        const udMatch = pidOut.match(/--user-data-dir=(\S+)/);
        const udPath = udMatch ? udMatch[1] : null;
        const userdataExists = !!(udPath && await checkContainerDir(udPath));
        assert(step + ` - primary user-data-dir exists (${udPath})`, userdataExists);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 2: Ensure session ─────────────────────────────────────
    {
      const step = '2. Ensure session';
      try {
        state = await ensureSession();
        assert(step + ' - has sid', state.sid === SESSION_ID);
        assert(step + ' - has wsUrl', !!state.wsUrl);
        assert(step + ' - has cdpUrl', !!state.cdpUrl);
        assert(step + ' - has daemonPid', typeof state.daemonPid === 'number' && state.daemonPid > 0);
        assert(step + ' - has ports', typeof state.publicPort === 'number');
        console.log(`      session: cdp=${state.cdpUrl}, daemonPid=${state.daemonPid}`);
      } catch (e) {
        fail(step, e.message);
      }
    }

    if (!state) {
      console.error('Cannot proceed without session state');
      process.exit(1);
    }

    // ── Step 3: Start fixture server ───────────────────────────────
    {
      const step = '3. Start fixtures';
      try {
        await startServer();
        await new Promise(r => setTimeout(r, 500));

        const { stdout: curlCheck } = await run('curl', [
          '-s', '-o', '/dev/null', '-w', '%{http_code}', `${FIXTURE_BASE}/login.html`
        ]);
        assert(step, curlCheck.trim() === '200', `curl login.html → ${curlCheck.trim()}`);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 4: Nav flow ───────────────────────────────────────────
    {
      const step = '4. Nav flow';
      try {
        let r, data;

        r = await browse('open', `${FIXTURE_BASE}/page1.html`);
        data = parseJson(r.stdout);
        assert(step + ' - open page1', data && data.title, r.stdout);

        r = await browse('click', "a[href='page2.html']");
        data = parseJson(r.stdout);
        assert(step + ' - click link', data && data.clicked, r.stdout);

        r = await browse('text', 'h1');
        assert(step + ' - text h1=Page 2', r.stdout.includes('Page 2'), `got: "${r.stdout}"`);

        r = await browse('open', `${FIXTURE_BASE}/page1.html`);
        data = parseJson(r.stdout);
        assert(step + ' - back to page1', data && data.title, r.stdout);

        r = await browse('status');
        data = parseJson(r.stdout);
        assert(step + ' - status has currentUrl', data && data.currentUrl && data.currentUrl.includes('page1.html'),
          data ? data.currentUrl : 'null');
        assert(step + ' - daemon alive', data && data.daemonAlive === true);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 5: Login flow ─────────────────────────────────────────
    {
      const step = '5. Login flow';
      try {
        let r, data;

        r = await browse('open', `${FIXTURE_BASE}/login.html`);
        data = parseJson(r.stdout);
        assert(step + ' - open login', data && data.title, r.stdout);

        r = await browse('wait-selector', '#username');
        data = parseJson(r.stdout);
        assert(step + ' - wait #username', data && data.found === '#username', r.stdout);

        r = await browse('type', '#username', 'alice');
        data = parseJson(r.stdout);
        assert(step + ' - type username', data && data.typed === 'alice', r.stdout);

        r = await browse('type', '#password', 'pw');
        data = parseJson(r.stdout);
        assert(step + ' - type password', data && data.typed === 'pw', r.stdout);

        r = await browse('click', '#submit');
        data = parseJson(r.stdout);
        assert(step + ' - click submit', data && data.clicked === '#submit', r.stdout);

        r = await browse('wait-selector', '#result');
        data = parseJson(r.stdout);
        assert(step + ' - wait #result', data && data.found === '#result', r.stdout);

        r = await browse('text', '#result');
        assert(step + ' - result welcome alice', r.stdout.toLowerCase().includes('welcome alice'),
          `got: "${r.stdout}"`);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 6: DOM inspection ─────────────────────────────────────
    {
      const step = '6. DOM inspection';
      try {
        let r, data;

        r = await browse('html');
        assert(step + ' - html contains markup', r.stdout.includes('<html'), 'html element found');
        assert(step + ' - html has login form', r.stdout.includes('login-form'), 'login form found');

        r = await browse('eval', 'document.title');
        data = parseJson(r.stdout);
        assert(step + ' - eval document.title',
          data && data.result && data.result.value,
          data ? JSON.stringify(data.result).substring(0, 80) : r.stdout);

        r = await browse('eval', 'throw new Error("e2e-test-error")');
        data = parseJson(r.stdout);
        assert(step + ' - eval throwing → result present',
          data && data.result !== undefined, r.stdout.substring(0, 100));
        assert(step + ' - eval throwing → subtype error',
          data && data.result && data.result.subtype === 'error',
          data && data.result ? `subtype=${data.result.subtype}` : r.stdout.substring(0, 80));
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 7: Screenshot ─────────────────────────────────────────
    {
      const step = '7. Screenshot';
      try {
        let r, data;

        r = await browse('open', `${FIXTURE_BASE}/page1.html`);
        data = parseJson(r.stdout);
        assert(step + ' - open tall page', data && data.title, r.stdout);

        await new Promise(r => setTimeout(r, 500));

        r = await browse('screenshot', '--viewport', '--full', 'step7-vp.png');
        data = parseJson(r.stdout);
        assert(step + ' - viewport PNG exists',
          data && data.bytes > 24 && data.format === 'png',
          data ? `bytes=${data.bytes}` : r.stdout);
        assert(step + ' - viewport dimensions plausible',
          data && data.width > 100 && data.height > 100,
          data ? `${data.width}x${data.height}` : r.stdout);
        const vpHeight = data ? data.height : 0;

        r = await browse('screenshot', '--full', 'step7-full.png');
        data = parseJson(r.stdout);
        assert(step + ' - full-page screenshot exists', data && data.bytes > 24, r.stdout);
        assert(step + ' - full-page larger than viewport',
          data && data.height > vpHeight,
          data ? `full=${data.height} vs vp=${vpHeight}` : r.stdout);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 7b: Tall-page full screenshot bounded + leak-free ─────
    {
      const step = '7b. Tall-page screenshot';
      try {
        let r, data;

        r = await browse('eval', `(function(){var d=document.createElement('div');d.style.height='20000px';d.style.width='1px';document.body.appendChild(d);return d.offsetHeight})()`);
        data = parseJson(r.stdout);
        assert(step + ' - page made tall', data && data.result && data.result.value >= 20000,
          data ? JSON.stringify(data.result).substring(0, 80) : r.stdout);

        const t0 = Date.now();
        r = await browse('screenshot', '--full', 'tall-regression.png');
        const elapsed = Date.now() - t0;
        data = parseJson(r.stdout);
        assert(step + ` - completed in ${elapsed}ms (< 30000)`, elapsed < 30000);
        assert(step + ' - truncated flag set', data && data.truncated === true,
          data ? JSON.stringify(data).substring(0, 150) : r.stdout.substring(0, 80));
        assert(step + ' - output non-empty', data && data.bytes > 24,
          data ? `bytes=${data.bytes}` : 'no data');

        let leftovers = [];
        try {
          leftovers = readdirSync(join('/tmp', 'csm-browse', SESSION_ID, 'artifacts')).filter(f => f.startsWith('.stitch-'));
        } catch {}
        assert(step + ' - no .stitch temps left', leftovers.length === 0,
          leftovers.length ? `leftovers: ${leftovers.join(',')}` : 'clean');
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 7c: Consent-wall dismissal ────────────────────────────
    {
      const step = '7c. Consent-wall dismissal';
      try {
        let r, data;

        r = await browse('open', `${FIXTURE_BASE}/wall.html`);
        data = parseJson(r.stdout);
        assert(step + ' - open wall fixture', data && data.title, r.stdout);

        r = await browse('eval', `!!document.querySelector('iframe[src*="cmpv2"]')`);
        data = parseJson(r.stdout);
        assert(step + ' - wall present before screenshot', data && data.result && data.result.value === true,
          data ? JSON.stringify(data.result) : r.stdout);

        r = await browse('screenshot', '--viewport', 'wall-check.jpg');
        data = parseJson(r.stdout);
        assert(step + ' - screenshot ok', data && data.bytes > 24, r.stdout);

        r = await browse('eval', `JSON.stringify({wall:!!document.querySelector('iframe[src*="cmpv2"]'),ov:getComputedStyle(document.body).overflow})`);
        data = parseJson(r.stdout);
        let st = null;
        try { st = data && data.result ? JSON.parse(data.result.value) : null; } catch {}
        assert(step + ' - wall dismissed', st && st.wall === false,
          st ? JSON.stringify(st) : r.stdout.substring(0, 120));
        assert(step + ' - scroll unlocked', st && st.ov !== 'hidden',
          st ? JSON.stringify(st) : r.stdout.substring(0, 120));
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 8: Devtools capture ───────────────────────────────────
    {
      const step = '8. Devtools capture';
      try {
        let r, data;

        r = await browse('console');
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const consoleEvents = Array.isArray(data) ? data : [];
        const hasPage1Ready = consoleEvents.some(e => {
          try {
            const args = e.payload && e.payload.args;
            if (!args) return false;
            return args.some(a => a && a.value === 'page1-ready');
          } catch { return false; }
        });
        assert(step + ' - console has page1-ready', hasPage1Ready,
          `found ${consoleEvents.length} console events`);

        r = await browse('network');
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const netEvents = Array.isArray(data) ? data : [];
        const hasPage1Request = netEvents.some(e => {
          try {
            return e.payload && e.payload.url && e.payload.url.includes('page1.html');
          } catch { return false; }
        });
        const hasPage1Response200 = netEvents.some(e => {
          try {
            return e.payload && e.payload.url && e.payload.url.includes('page1.html') &&
              e.payload.status === 200;
          } catch { return false; }
        });
        assert(step + ' - network has page1.html request', hasPage1Request,
          `found ${netEvents.length} network events`);
        assert(step + ' - network has page1.html status 200', hasPage1Response200);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 9: Daemon restart preservation ────────────────────────
    if (!QUICK) {
      const step = '9. Daemon restart preservation';
      try {
        const statePath = join('/tmp/csm-browse', SESSION_ID, 'state.json');
        const stateBefore = JSON.parse(readFileSync(statePath, 'utf-8'));
        if (stateBefore.daemonPid) {
          try { process.kill(stateBefore.daemonPid, 'SIGTERM'); } catch {}
        }

        const start = Date.now();
        let dead = false;
        while (Date.now() - start < 5000) {
          try {
            process.kill(stateBefore.daemonPid, 0);
            await new Promise(r => setTimeout(r, 200));
          } catch { dead = true; break; }
        }
        if (!dead && stateBefore.daemonPid) {
          try { process.kill(stateBefore.daemonPid, 'SIGKILL'); } catch {}
        }
        assert(step + ' - daemon killed', true);

        await new Promise(r => setTimeout(r, 1000));

        const state2 = await ensureSession();
        assert(step + ' - ensure restarted daemon',
          state2 && typeof state2.daemonPid === 'number' && state2.daemonPid > 0,
          state2 ? `newPid=${state2.daemonPid}` : 'no state');

        const { stdout } = await browse('console');
        let data;
        try { data = JSON.parse(stdout); } catch { data = null; }
        const consoleEvents2 = Array.isArray(data) ? data : [];
        const stillHasPage1Ready = consoleEvents2.some(e => {
          try {
            const args = e.payload && e.payload.args;
            if (!args) return false;
            return args.some(a => a && a.value === 'page1-ready');
          } catch { return false; }
        });
        assert(step + ' - console still has page1-ready after restart', stillHasPage1Ready,
          `found ${consoleEvents2.length} console events`);
      } catch (e) {
        fail(step, e.message);
      }
    } else {
      console.log(`SKIP: 9. Daemon restart preservation (--quick mode)`);
    }

    // ── Step 10: Video ─────────────────────────────────────────────
    if (!QUICK) {
      const step = '10. Video';
      let videoPath = null;
      try {
        let r, data;

        r = await browse('open', `${FIXTURE_BASE}/animated.html`);
        data = parseJson(r.stdout);
        assert(step + ' - open animated', data && data.title, r.stdout);

        r = await browse('screencast-start', 'e2e.webm');
        assert(step + ' - screencast started',
          r.stdout.includes('Recording started'), r.stdout);

        console.log('      waiting 6s for recording...');
        await new Promise(resolve => setTimeout(resolve, 6000));

        r = await browse('screencast-stop');
        data = parseJson(r.stdout);
        assert(step + ' - screencast stopped OK',
          data && data.file && !data.error,
          data ? JSON.stringify(data) : r.stdout);
        videoPath = data && data.file;
        console.log(`      video: file=${data.file}, frames=${data.frames}, duration=${data.duration}, codec=${data.codec}`);

        if (videoPath && existsSync(videoPath)) {
          const { stdout: probeOut } = await run('ffprobe', [
            '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath
          ]);
          const probe = parseJson(probeOut);
          const videoStream = (probe && probe.streams || []).find(s => s.codec_type === 'video');
          assert(step + ' - ffprobe: codec vp9',
            videoStream && videoStream.codec_name === 'vp9',
            videoStream ? videoStream.codec_name : 'no video stream');
          assert(step + ' - ffprobe: valid resolution',
            videoStream && videoStream.width === 1920 && videoStream.height >= 200,
            videoStream ? `${videoStream.width}x${videoStream.height}` : 'no video stream');

          const duration = parseFloat((probe && probe.format && probe.format.duration) || '0');
          assert(step + ' - ffprobe: duration >= 4s', duration >= 4,
            `duration=${duration.toFixed(2)}s`);

          const frameCount = videoStream && parseInt(videoStream.nb_frames, 10) || data.frames || 0;
          assert(step + ' - ffprobe: frames >= 10 (or recorded >= 10)',
            frameCount >= 10 || (data && data.frames >= 10),
            `ffprobe=${frameCount}, recorded=${data ? data.frames : '?'}`);
        } else {
          fail(step, `video file not found at ${videoPath}`);
        }
      } catch (e) {
        fail(step, e.message);
      }
    } else {
      console.log(`SKIP: 10. Video (--quick mode)`);
    }

    // ── Step 11: Close ─────────────────────────────────────────────
    {
      const step = '11. Close';
      try {
        const r = await browse('close');
        const data = parseJson(r.stdout);
        assert(step + ' - close returned removed',
          data && data.removed && data.removed.length > 0, r.stdout);
        console.log(`      removed: ${(data && data.removed) ? data.removed.join(', ') : 'none'}`);

        await new Promise(r => setTimeout(r, 500));

        const hostDir = join('/tmp', 'csm-browse', SESSION_ID);
        assert(step + ' - host dir removed', !existsSync(hostDir));

        const containerDirExists = await checkContainerDir(`/config/csm-browse/sessions/${SESSION_ID}`);
        assert(step + ' - container dir removed', !containerDirExists);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 12: After-close isolation ─────────────────────────────
    {
      const step = '12. After-close isolation';
      try {
        const { stdout: pidOut } = await run('docker', dockerArgs(['pgrep', '-af', '--', '--remote-debugging-port=9223']));
        const defaultAlive = pidOut.trim().split('\n').filter(Boolean).length > 0;
        assert(step + ' - default chromium still running (port 9223)', defaultAlive,
          `PIDs: ${pidOut.trim().split('\n').slice(0, 3).join(',')}`);

        const { stdout: cdpOut } = await run('curl', ['-s', 'http://localhost:9222/json/version']);
        const cdpJson = parseJson(cdpOut);
        assert(step + ' - 9222 CDP responsive', !!(cdpJson && cdpJson.webSocketDebuggerUrl));

        const csmForSession = await checkContainerProcesses(SESSION_ID);
        assert(step + ' - no csm-browse processes for this session', !csmForSession);
      } catch (e) {
        fail(step, e.message);
      }
    }

    // ── Step 13: Session sweep ─────────────────────────────────────
    {
      const step = '13. Session sweep';
      try {
        const staleDir = join('/tmp', 'csm-browse', 'sweep-test-stale');
        const freshDir = join('/tmp', 'csm-browse', 'sweep-test-fresh');
        const autoDir = join('/tmp', 'csm-browse', 'sweep-test-auto');
        const old = new Date(Date.now() - 5 * 3600 * 1000);

        const mkStale = (dir) => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'state.json'), JSON.stringify({ sid: dir.split('/').pop() }), 'utf-8');
          utimesSync(join(dir, 'state.json'), old, old);
          utimesSync(dir, old, old);
        };
        mkStale(staleDir);
        mkdirSync(freshDir, { recursive: true });
        writeFileSync(join(freshDir, 'state.json'), JSON.stringify({ sid: 'sweep-test-fresh' }), 'utf-8');

        const dry = await run('node', [join(SKILL_DIR, 'scripts', 'ensure-browser.mjs'), '--cleanup-stale', '--dry-run'], { timeout: 60000 });
        assert(step + ' - dry-run lists stale', dry.stdout.includes('sweep-test-stale'), dry.stdout.substring(0, 160));
        assert(step + ' - dry-run skips fresh', !dry.stdout.includes('sweep-test-fresh'), dry.stdout.substring(0, 160));
        assert(step + ' - dry-run removes nothing', existsSync(staleDir));

        const real = await run('node', [join(SKILL_DIR, 'scripts', 'ensure-browser.mjs'), '--cleanup-stale'], { timeout: 60000 });
        assert(step + ' - sweep removes stale', !existsSync(staleDir), real.stdout.substring(0, 160));
        assert(step + ' - sweep keeps fresh', existsSync(freshDir));

        mkStale(autoDir);
        const autoSid = `sweep-e2e-${Date.now()}`;
        const auto = await run('node', [join(SKILL_DIR, 'scripts', 'ensure-browser.mjs'), '--session', autoSid], { timeout: 120000 });
        assert(step + ' - auto-sweep line printed', auto.stdout.includes('Sweep:'), auto.stdout.substring(0, 200));
        assert(step + ' - auto-sweep removed stale', !existsSync(autoDir));
        await run('node', [join(SKILL_DIR, 'scripts', 'browse.mjs'), 'close', '--session', autoSid]);

        const { stdout: cdpOut } = await run('curl', ['-s', 'http://localhost:9222/json/version']);
        const cdpJson = parseJson(cdpOut);
        assert(step + ' - container CDP still up', !!(cdpJson && cdpJson.webSocketDebuggerUrl));

        for (const d of [freshDir, autoDir]) {
          try { rmSync(d, { recursive: true, force: true }); } catch {}
        }
      } catch (e) {
        fail(step, e.message);
      }
    }

  } finally {
    killServer();
    try {
      const { stdout } = await shell('fuser 8090/tcp 2>/dev/null');
      if (stdout.trim()) await shell('fuser -k 8090/tcp 2>/dev/null');
    } catch {}

    const hostDir = join('/tmp', 'csm-browse', SESSION_ID);
    if (existsSync(hostDir)) {
      try { await browse('close'); } catch {}
    }
  }

  // ── Step 13: Summary ────────────────────────────────────────────
  {
    const total = passCount + failCount;
    console.log(`\n=== E2E Summary ===`);
    console.log(`${'='.repeat(40)}`);
    console.log(`PASS: ${passCount}`);
    console.log(`FAIL: ${failCount}`);
    console.log(`TOTAL: ${total}`);

    const summary = {
      session: SESSION_ID,
      timestamp: new Date().toISOString(),
      quick: QUICK,
      pass: passCount,
      fail: failCount,
      total
    };

    mkdirSync(DOCS_DIR, { recursive: true });
    writeFileSync(join(DOCS_DIR, 'csm-browse-e2e-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\nSummary written to ${join(DOCS_DIR, 'csm-browse-e2e-summary.json')}`);

    if (failCount > 0) {
      process.exit(1);
    }
  }
}

runTests().catch(err => {
  console.error(`FATAL: ${err.message}`);
  killServer();
  try { exec('fuser -k 8090/tcp 2>/dev/null', () => {}); } catch {}
  process.exit(1);
});
