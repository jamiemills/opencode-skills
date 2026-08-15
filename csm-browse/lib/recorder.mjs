import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, unlink, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  SCREENCAST_QUALITY,
  SCREENCAST_MAX_WIDTH,
  SCREENCAST_MAX_HEIGHT,
  SCREENCAST_EVERY_NTH,
  RECORDER_FRAME_BUFFER_CAP,
  VIDEO_PRESETS,
  SPEED_PRESETS
} from './constants.mjs';

const VALID_NAME_RE = /^[A-Za-z0-9._-]+\.(mp4|webm)$/;

let activeRecording = null;

function validateName(name) {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid recording name: "${name}". Must match ^[A-Za-z0-9._-]+\\.(mp4|webm)$`);
  }
}

export async function reconcileRecorder(sessionDir) {
  const recorderJsonPath = join(sessionDir, 'recorder.json');
  let state;
  try {
    state = JSON.parse(await readFile(recorderJsonPath, 'utf-8'));
  } catch { return null; }
  if (state.running === true && !activeRecording) {
    const reset = {
      ...state,
      running: false,
      reset: true,
      note: 'stale running flag reset'
    };
    try { await writeFile(recorderJsonPath, JSON.stringify(reset, null, 2), 'utf-8'); } catch {}
    return reset;
  }
  return null;
}

export async function assertValidOutput(outPath, frames) {
  let size = 0;
  try {
    size = (await stat(outPath)).size;
  } catch {}
  if (!size) {
    throw new Error(`screencast produced empty/invalid output (${frames} frames captured); see ffmpeg-stderr.log`);
  }
}

export async function startRecorder(client, sessionId, sessionDir, outName, fps = 15, preset = 'medium', speed = 'medium') {
  validateName(outName);

  if (activeRecording) {
    throw new Error('already recording');
  }

  const recorderJsonPath = join(sessionDir, 'recorder.json');
  try {
    const raw = await readFile(recorderJsonPath, 'utf-8');
    const state = JSON.parse(raw);
    if (state.running && activeRecording) throw new Error('already recording');
  } catch (err) {
    if (err.message === 'already recording') throw err;
  }

  const artifactsDir = join(sessionDir, 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  const outPath = join(artifactsDir, outName);

  const p = VIDEO_PRESETS[preset] || VIDEO_PRESETS.medium;
  const fpsOut = SPEED_PRESETS[speed] || SPEED_PRESETS.medium;

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-c:v', 'mjpeg',
    '-framerate', String(fpsOut),
    '-i', '-',
    '-vf', "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    '-c:v', p.codec,
    '-deadline', p.deadline,
    '-cpu-used', String(p.cpuUsed),
    '-crf', String(p.crf),
    '-b:v', p.bitrate,
    '-row-mt', '1',
    outPath
  ];

  const stderrPath = join(sessionDir, 'ffmpeg-stderr.log');
  const stderrStream = createWriteStream(stderrPath, { flags: 'w' });

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'ignore', 'pipe']
  });

  ffmpeg.stderr.pipe(stderrStream);

  const startedAt = new Date().toISOString();
  let frameCount = 0;
  let droppedFrames = 0;
  let ffmpegExited = false;
  let ffmpegError = null;
  const frameBuffer = [];
  let stopRequested = false;
  let exitResolve;
  const exitPromise = new Promise(resolve => { exitResolve = resolve; });
  let drainResolve = () => {};
  let drainAgain = () => {};

  ffmpeg.on('exit', (code) => {
    ffmpegExited = true;
    if (code !== 0 && code !== null) {
      ffmpegError = new Error(`ffmpeg exited with code ${code}`);
    }
    exitResolve();
    stderrStream.end();
  });

  ffmpeg.on('error', (err) => {
    ffmpegError = err;
    ffmpegExited = true;
    exitResolve();
  });

  ffmpeg.stdin.on('error', (err) => {
    if (err.code === 'EPIPE') {
      ffmpegExited = true;
    } else {
      ffmpegError = err;
      ffmpegExited = true;
    }
    exitResolve();
  });

  const drainLoop = async () => {
    while (true) {
      if (ffmpegExited) break;

      if (frameBuffer.length > 0) {
        const buf = frameBuffer.shift();
        if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
          try {
            const canWrite = ffmpeg.stdin.write(buf);
            if (!canWrite) {
              await Promise.race([
                new Promise(resolve => { drainResolve = () => { drainResolve = () => {}; resolve(); }; }),
                exitPromise.then(() => {})
              ]);
            }
          } catch {
            break;
          }
        } else {
          break;
        }
      } else if (stopRequested) {
        break;
      } else {
        await Promise.race([
          setTimeout(50),
          exitPromise.then(() => {})
        ]);
      }
    }
  };

  const drainPromise = drainLoop();

  const onDrain = () => drainResolve();
  ffmpeg.stdin.on('drain', onDrain);

  const frameHandler = (params) => {
    const buf = Buffer.from(params.data, 'base64');

    client.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sessionId)
      .catch(() => {});

    if (stopRequested || ffmpegExited) return;

    if (frameBuffer.length >= RECORDER_FRAME_BUFFER_CAP) {
      frameBuffer.shift();
      droppedFrames++;
    }
    frameBuffer.push(buf);
    frameCount++;
  };

  client.on('Page.screencastFrame', frameHandler);

  try {
    await client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: SCREENCAST_MAX_WIDTH,
      maxHeight: SCREENCAST_MAX_HEIGHT,
      everyNthFrame: SCREENCAST_EVERY_NTH
    }, sessionId);
  } catch (err) {
    stopRequested = true;
    ffmpeg.kill();
    client.off('Page.screencastFrame', frameHandler);
    ffmpeg.stdin.off('drain', onDrain);
    try {
      await writeFile(recorderJsonPath, JSON.stringify({
        running: false,
        error: err.message
      }), 'utf-8');
    } catch {}
    throw err;
  }

  const recorderState = {
    running: true,
    startedAt,
    name: outName,
    outPath
  };

  await writeFile(recorderJsonPath, JSON.stringify(recorderState), 'utf-8');

  activeRecording = {
    ffmpeg,
    frameHandler,
    onDrain,
    drainPromise,
    exitPromise,
    frameCount: () => frameCount,
    droppedFrames: () => droppedFrames,
    startedAt,
    fps,
    outPath,
    codec: p.codec,
    recorderJsonPath,
    ffmpegError: () => ffmpegError,
    sessionDir,
    markStop: () => { stopRequested = true; }
  };

  return { isRecording: true };
}

export async function stopRecorder(client, sessionId, sessionDir) {
  if (!activeRecording) {
    throw new Error('not recording');
  }
  if (activeRecording.sessionDir !== sessionDir) {
    throw new Error('not recording');
  }

  const rec = activeRecording;
  activeRecording = null;

  try {
    await client.send('Page.stopScreencast', {}, sessionId);
  } catch {}

  client.off('Page.screencastFrame', rec.frameHandler);
  rec.markStop();

  try { await rec.drainPromise; } catch {}

  rec.ffmpeg.stdin.off('drain', rec.onDrain);

  if (rec.ffmpeg.stdin && !rec.ffmpeg.stdin.destroyed) {
    try { rec.ffmpeg.stdin.end(); } catch {}
  }

  if (rec.ffmpeg.exitCode === null && !rec.ffmpeg.killed) {
    await Promise.race([
      new Promise(resolve => rec.ffmpeg.on('exit', resolve)),
      setTimeout(8000).then(() => {
        try { rec.ffmpeg.kill('SIGKILL'); } catch {}
      })
    ]);
  }

  const duration = (Date.now() - new Date(rec.startedAt).getTime()) / 1000;
  const ffmpegErr = rec.ffmpegError();
  const stats = {
    running: false,
    file: rec.outPath,
    startedAt: rec.startedAt,
    stoppedAt: new Date().toISOString(),
    frames: rec.frameCount(),
    dropped: rec.droppedFrames(),
    fps: rec.fps,
    duration: duration.toFixed(2),
    codec: rec.codec,
    error: ffmpegErr ? ffmpegErr.message : null
  };

  let outputError = null;
  try {
    await assertValidOutput(rec.outPath, rec.frameCount());
    try { await unlink(join(sessionDir, 'ffmpeg-stderr.log')); } catch {}
  } catch (err) {
    outputError = err.message;
  }

  stats.error = outputError || stats.error;

  try {
    await writeFile(rec.recorderJsonPath, JSON.stringify(stats, null, 2), 'utf-8');
  } catch {}

  if (outputError) throw new Error(outputError);

  return {
    file: stats.file,
    frames: stats.frames,
    duration: stats.duration,
    codec: stats.codec
  };
}
