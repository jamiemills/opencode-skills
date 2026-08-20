import { unlink, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { dismissCookies } from '../cookies.mjs';
import { MAX_STITCH_HEIGHT_PX } from '../constants.mjs';
import { ensurePrivateDir, ensurePrivateFile, secureWrite } from '../security.mjs';

const PRESETS = {
  small:  { format: 'jpeg', quality: 30, ext: 'jpg' },
  medium: { format: 'jpeg', quality: 80, ext: 'jpg' },
  full:   { format: 'png',  quality: 0,  ext: 'png' },
};

// F-063: same shape as recorder.mjs's VALID_NAME_RE (not exported there, so
// replicated here): path separators, traversal, and absolute names are all
// excluded by construction; the resolved-path containment check below is the
// belt-and-braces second layer.
const VALID_OUT_NAME_RE = /^[A-Za-z0-9._-]+$/;

async function captureOne(client, sessionId, params) {
  const result = await client.send('Page.captureScreenshot', params, sessionId);
  return Buffer.from(result.data, 'base64');
}

async function scrollAndWait(client, sessionId, y) {
  await client.send('Runtime.evaluate', {
    expression: `window.scrollTo(0,${y})`
  }, sessionId);
  await new Promise(r => setTimeout(r, 200));
}

async function getStickyHeight(client, sessionId) {
  const { result } = await client.send('Runtime.evaluate', {
    expression: `(function(){
      var h=0;
      Array.from(document.querySelectorAll('*')).forEach(function(e){
        var s=getComputedStyle(e);
        if((s.position==='fixed'||s.position==='sticky')&&e.offsetHeight>0&&e.offsetHeight<window.innerHeight)h=Math.max(h,e.offsetHeight)
      });
      return h
    })()`,
    returnByValue: true
  }, sessionId);
  return (result && result.value) ? result.value : 0;
}

function jpegQScale(quality) {
  // Map quality 1-100 to ffmpeg mjpeg -q:v range (2 = best, 31 = worst)
  return Math.max(2, Math.min(31, Math.round(31 - (quality * 29) / 100)));
}

async function ffmpegVstack(inputFiles, outputPath, quality = null) {
  await secureWrite(outputPath, '');
  return new Promise((res, reject) => {
    const args = [];
    for (const f of inputFiles) args.push('-i', f);
    const pads = inputFiles.map((_, i) => `[${i}]`).join('');
    const filter = `${pads}vstack=inputs=${inputFiles.length}`;
    args.push('-filter_complex', filter, '-frames:v', '1');
    if (quality !== null) args.push('-q:v', String(jpegQScale(quality)));
    args.push('-y', outputPath);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) ensurePrivateFile(outputPath).then(res, reject);
      else reject(new Error(`ffmpeg vstack failed: ${stderr.slice(-200)}`));
    });
    proc.on('error', reject);
  });
}

export async function run({ args, state }) {
  const fullPage = !args.includes('--viewport');
  const stitch = fullPage;  // stitch is the default for full-page

  let preset = 'medium';
  if (args.includes('--small')) preset = 'small';
  if (args.includes('--medium')) preset = 'medium';
  if (args.includes('--full')) preset = 'full';

  const cfg = PRESETS[preset];

  let quality = cfg.quality;
  const qi = args.indexOf('--quality');
  const qualityExplicit = qi !== -1;
  if (qi !== -1 && args[qi + 1]) quality = Math.min(100, Math.max(1, parseInt(args[qi + 1], 10) || 80));
  if (qualityExplicit && cfg.format === 'png') {
    console.error('Warning: --quality applies to JPEG output only; ignored for lossless PNG');
  }

  const positional = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a)).filter(a => {
    const idx = args.indexOf(a);
    return args[idx - 1] !== '--quality';
  });
  const outName = positional.length > 0
    ? (positional[0].endsWith(`.${cfg.ext}`) ? positional[0] : `${positional[0]}.${cfg.ext}`)
    : `screenshot-${Date.now()}.${cfg.ext}`;

  const sDir = state.sessionDir;
  const artifactsDir = join(sDir, 'artifacts');

  if (!VALID_OUT_NAME_RE.test(outName) || outName === '.' || outName === '..') {
    console.error(`Invalid output name: "${outName}". Must match ^[A-Za-z0-9._-]+$ — no path separators, no traversal.`);
    process.exit(1);
  }
  if (!resolve(artifactsDir, outName).startsWith(resolve(artifactsDir) + sep)) {
    console.error(`Invalid output name: "${outName}" — resolved path escapes the artifacts directory.`);
    process.exit(1);
  }

  await ensurePrivateDir(artifactsDir);

  const CRI = await import('chrome-remote-interface');
  const client = await CRI.default({ target: state.wsUrl });

  let sessionId;
  try {
    const { targetInfos } = await client.send('Target.getTargets');
    const pages = targetInfos.filter(t => t.type === 'page');
    if (pages.length === 0) throw new Error('No page target found');

    const attachResult = await client.send('Target.attachToTarget', {
      targetId: pages[0].targetId,
      flatten: true
    });
    sessionId = attachResult.sessionId;

    await dismissCookies(client, sessionId);

    if (stitch && fullPage) {
      const stickyHeight = await getStickyHeight(client, sessionId);
      const dims = await client.send('Runtime.evaluate', {
        expression: 'JSON.stringify({h:document.body.scrollHeight,wh:window.innerHeight})',
        returnByValue: true
      }, sessionId);
      const body = JSON.parse(dims.result.value);
      const bodyH = body.h || 4096;
      const winH = body.wh || 875;
      const step = winH - stickyHeight;
      const cappedH = Math.min(bodyH, MAX_STITCH_HEIGHT_PX);
      const truncated = bodyH > cappedH;
      const totalTiles = Math.ceil(cappedH / step);
      const MAX_TILES = 60;

      if (totalTiles > MAX_TILES) {
        console.error(`Full page too large (${totalTiles} tiles). Re-run with --viewport for a single-viewport capture.`);
        process.exit(1);
      }

      const tmpFiles = [];
      const outPath = join(artifactsDir, outName);
      try {
        let y = 0;
        while (y < cappedH) {
          const tileNum = tmpFiles.length + 1;
          process.stderr.write(JSON.stringify({tile: tileNum, total: totalTiles}) + '\n');
          await scrollAndWait(client, sessionId, y);
          const params = { format: 'png' };
          const buf = await captureOne(client, sessionId, params);
          const tmpPath = join(artifactsDir, `.stitch-${tileNum}.png`);
          await secureWrite(tmpPath, buf);

          // Crop sticky header from tiles after the first
          if (tileNum > 1 && stickyHeight > 0) {
            const cropPath = join(artifactsDir, `.stitch-${tileNum}-crop.png`);
            await secureWrite(cropPath, '');
            await new Promise((res, reject) => {
              const proc = spawn('ffmpeg', [
                '-i', tmpPath, '-vf', `crop=iw:ih-${stickyHeight}:0:${stickyHeight}`,
                '-frames:v', '1', '-y', cropPath
              ], { stdio: ['ignore', 'ignore', 'pipe'] });
              proc.on('close', code => {
                if (code === 0) ensurePrivateFile(cropPath).then(res, reject);
                else reject(new Error('crop failed'));
              });
              proc.on('error', reject);
            });
            await unlink(tmpPath);
            tmpFiles.push(cropPath);
          } else {
            tmpFiles.push(tmpPath);
          }
          y += step;
        }

        await ffmpegVstack(tmpFiles, outPath, cfg.format === 'jpeg' ? quality : null);
      } finally {
        for (const f of tmpFiles) {
          try { await unlink(f); } catch {}
        }
        try {
          for (const f of await readdir(artifactsDir)) {
            if (f.startsWith('.stitch-')) {
              try { await unlink(join(artifactsDir, f)); } catch {}
            }
          }
        } catch {}
      }

      // Read output dimensions
      let width = 0, height = 0;
      try {
        const outBuf = await import('fs').then(m => m.promises.readFile(outPath));
        if (cfg.format === 'png' && outBuf.length > 24) {
          width = outBuf.readUInt32BE(16);
          height = outBuf.readUInt32BE(20);
        }
      } catch {}

      const output = { path: outPath, bytes: (await import('fs').then(m => m.promises.stat(outPath))).size, format: cfg.ext, preset, stitched: true, tiles: totalTiles, width, height };
      if (truncated) {
        output.truncated = true;
        output.sourceHeight = bodyH;
        output.cappedHeight = cappedH;
      }
      process.stdout.write(JSON.stringify(output) + '\n');

    } else {
      // ── Single capture (original behavior) ──
      const params = { format: cfg.format, captureBeyondViewport: fullPage };
      if (cfg.format === 'jpeg') params.quality = quality;

      const buf = await captureOne(client, sessionId, params);
      const outPath = join(artifactsDir, outName);
      await secureWrite(outPath, buf);

      const output = { path: outPath, bytes: buf.length, format: cfg.ext, preset };
      if (buf.length > 24 && cfg.format === 'png') {
        output.width = buf.readUInt32BE(16);
        output.height = buf.readUInt32BE(20);
      }

      process.stdout.write(JSON.stringify(output) + '\n');
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  } finally {
    try { await client.close(); } catch {}
  }
}
