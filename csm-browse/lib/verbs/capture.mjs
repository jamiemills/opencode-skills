import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { dismissCookies } from '../cookies.mjs';

const PRESETS = {
  small:  { format: 'jpeg', quality: 30, ext: 'jpg' },
  medium: { format: 'jpeg', quality: 80, ext: 'jpg' },
  full:   { format: 'png',  quality: 0,  ext: 'png' },
};

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

async function ffmpegVstack(inputFiles, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [];
    for (const f of inputFiles) args.push('-i', f);
    const pads = inputFiles.map((_, i) => `[${i}]`).join('');
    const filter = `${pads}vstack=inputs=${inputFiles.length}`;
    args.push('-filter_complex', filter, '-frames:v', '1', '-y', outputPath);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve();
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
  if (qi !== -1 && args[qi + 1]) quality = Math.min(100, Math.max(1, parseInt(args[qi + 1], 10) || 80));

  const positional = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a)).filter((a, i, arr) => {
    const idx = args.indexOf(a);
    return args[idx - 1] !== '--quality';
  });
  const outName = positional.length > 0
    ? (positional[0].endsWith(`.${cfg.ext}`) ? positional[0] : `${positional[0]}.${cfg.ext}`)
    : `screenshot-${Date.now()}.${cfg.ext}`;

  const sDir = state.sessionDir;
  const artifactsDir = join(sDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });

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
      const totalTiles = Math.ceil(bodyH / step);
      const MAX_TILES = 60;

      if (totalTiles > MAX_TILES) {
        console.error(`Stitch requires ${totalTiles} tiles (max ${MAX_TILES}). Use --full-page without --stitch or reduce page height.`);
        process.exit(1);
      }

      const tmpFiles = [];
      let y = 0;
      while (y < bodyH) {
        const tileNum = tmpFiles.length + 1;
        process.stderr.write(JSON.stringify({tile: tileNum, total: totalTiles}) + '\n');
        await scrollAndWait(client, sessionId, y);
        const params = { format: 'png' };
        const buf = await captureOne(client, sessionId, params);
        const tmpPath = join(artifactsDir, `.stitch-${tileNum}.png`);
        await writeFile(tmpPath, buf);

        // Crop sticky header from tiles after the first
        if (tileNum > 1 && stickyHeight > 0) {
          const cropPath = join(artifactsDir, `.stitch-${tileNum}-crop.png`);
          await new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', [
              '-i', tmpPath, '-vf', `crop=iw:ih-${stickyHeight}:0:${stickyHeight}`,
              '-frames:v', '1', '-y', cropPath
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            proc.on('close', code => code === 0 ? resolve() : reject(new Error('crop failed')));
            proc.on('error', reject);
          });
          await unlink(tmpPath);
          tmpFiles.push(cropPath);
        } else {
          tmpFiles.push(tmpPath);
        }
        y += step;
      }

      const outPath = join(artifactsDir, outName);
      await ffmpegVstack(tmpFiles, outPath);

      // Clean up temp files
      for (const f of tmpFiles) {
        try { await unlink(f); } catch {}
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
      process.stdout.write(JSON.stringify(output) + '\n');

    } else {
      // ── Single capture (original behavior) ──
      const params = { format: cfg.format, captureBeyondViewport: fullPage };
      if (cfg.format === 'jpeg') params.quality = quality;

      const buf = await captureOne(client, sessionId, params);
      const outPath = join(artifactsDir, outName);
      await writeFile(outPath, buf);

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
