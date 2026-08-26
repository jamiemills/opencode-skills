import { spawn, execFile as execFileCb } from "node:child_process";
import { unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import {
  SCREENCAST_QUALITY,
  SCREENCAST_MAX_WIDTH,
  SCREENCAST_MAX_HEIGHT,
  SCREENCAST_EVERY_NTH,
  RECORDER_FRAME_BUFFER_CAP,
  VIDEO_PRESETS,
  SPEED_PRESETS,
} from "./constants.mjs";
import { ensurePrivateDir, ensurePrivateFile, secureAppend, secureWrite } from "./security.mjs";
import { readDurableJson } from "../../lib/durable-json/index.mjs";

const execFile = promisify(execFileCb);

// F-007: probe the actual duration of a recorded file. A size>0 check passes
// a trailer-less SIGKILL'd webm; ffprobe reading a real duration is the
// integrity proof the muxer actually closed the stream.
async function probeVideoDuration(outPath) {
  const { stdout } = await execFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      outPath,
    ],
    { timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

const VALID_NAME_RE = /^[A-Za-z0-9._-]+\.(mp4|webm)$/;

function noop() {}

let activeRecording = null;

function validateName(name) {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid recording name: "${name}". Must match ^[A-Za-z0-9._-]+\\.(mp4|webm)$`);
  }
}

export async function reconcileRecorder(sessionDir) {
  const recorderJsonPath = join(sessionDir, "recorder.json");
  let state;
  try {
    state = await readDurableJson(recorderJsonPath);
  } catch {
    return null;
  }
  if (state.running === true && !activeRecording) {
    const reset = {
      ...state,
      running: false,
      reset: true,
      note: "stale running flag reset",
    };
    try {
      await secureWrite(recorderJsonPath, JSON.stringify(reset, null, 2), { encoding: "utf-8" });
    } catch {}
    return reset;
  }
  return null;
}

export async function assertValidOutput(outPath, frames) {
  await ensurePrivateFile(outPath);
  let size = 0;
  try {
    size = (await stat(outPath)).size;
  } catch {}
  if (!size) {
    throw new Error(
      `screencast produced empty/invalid output (${frames} frames captured); see ffmpeg-stderr.log`,
    );
  }
}

// F-014/R1.7: best-effort teardown of a recorder that may be mid-start — the
// daemon's command-timeout branch calls this when a screencast-start hung
// (e.g. Page.startScreencast never resolved). If a recording is active for
// THIS session dir, kill the spawned ffmpeg, clear the module-level state and
// the on-disk running flag so the next start/stop is not blocked by 'already
// recording'. Never throws. A recording belonging to another session dir is
// left untouched.
export async function abortRecorder(client, sessionId, sessionDir) {
  const rec = activeRecording;
  if (!rec) return;
  if (rec.sessionDir !== sessionDir) return;
  activeRecording = null;
  try {
    rec.markStop();
  } catch {}
  try {
    client.off("Page.screencastFrame", rec.frameHandler);
  } catch {}
  try {
    rec.ffmpeg.stdin.off("drain", rec.onDrain);
  } catch {}
  try {
    rec.ffmpeg.kill("SIGKILL");
  } catch {}
  try {
    await secureWrite(
      rec.recorderJsonPath,
      JSON.stringify(
        {
          running: false,
          stoppedAt: new Date().toISOString(),
          error: "recording aborted after command timeout",
        },
        null,
        2,
      ),
      { encoding: "utf-8" },
    );
  } catch {}
}

export async function startRecorder(
  client,
  sessionId,
  sessionDir,
  outName,
  fps = 15,
  preset = "medium",
  speed = "medium",
) {
  validateName(outName);

  if (activeRecording) {
    throw new Error("already recording");
  }

  // F-067-1: the old on-disk "already recording" guard here was dead code —
  // `state.running && activeRecording` can never throw after the activeRecording
  // check above (and if state.running && !activeRecording it is a stale flag
  // reconciled by reconcileRecorder at daemon startup). Only the in-memory
  // guard is authoritative.
  const recorderJsonPath = join(sessionDir, "recorder.json");

  const artifactsDir = join(sessionDir, "artifacts");
  await ensurePrivateDir(artifactsDir);
  const outPath = join(artifactsDir, outName);
  await secureWrite(outPath, "");

  const p = VIDEO_PRESETS[preset] || VIDEO_PRESETS.medium;
  const fpsOut = SPEED_PRESETS[speed] || SPEED_PRESETS.medium;

  const ffmpegArgs = [
    "-y",
    "-f",
    "image2pipe",
    "-c:v",
    "mjpeg",
    "-framerate",
    String(fpsOut),
    "-i",
    "-",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    p.codec,
    "-deadline",
    p.deadline,
    "-cpu-used",
    String(p.cpuUsed),
    "-crf",
    String(p.crf),
    "-b:v",
    p.bitrate,
    "-row-mt",
    "1",
    outPath,
  ];

  const stderrPath = join(sessionDir, "ffmpeg-stderr.log");
  await secureWrite(stderrPath, "", { encoding: "utf-8" });

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "ignore", "pipe"],
  });

  // F-067-11: bound the stderr write queue — a chatty ffmpeg or slow disk
  // must not grow the promise chain without limit. Past the cap, chunks are
  // dropped instead of buffered forever.
  const MAX_PENDING_WRITES = 64;
  let pendingWrites = 0;
  let stderrWrite = Promise.resolve();
  ffmpeg.stderr.on("data", (chunk) => {
    if (pendingWrites >= MAX_PENDING_WRITES) return;
    pendingWrites++;
    stderrWrite = stderrWrite
      .then(() => secureAppend(stderrPath, chunk))
      .catch(() => {})
      .finally(() => {
        pendingWrites--;
      });
  });

  const startedAt = new Date().toISOString();
  let frameCount = 0;
  let droppedFrames = 0;
  let ffmpegExited = false;
  let ffmpegError = null;
  const frameBuffer = [];
  let stopRequested = false;
  let exitResolve;
  const exitPromise = new Promise((resolve) => {
    exitResolve = resolve;
  });
  let drainResolve = noop;

  ffmpeg.on("exit", (code) => {
    ffmpegExited = true;
    if (code !== 0 && code !== null) {
      ffmpegError = new Error(`ffmpeg exited with code ${code}`);
    }
    exitResolve();
  });

  ffmpeg.on("error", (err) => {
    ffmpegError = err;
    ffmpegExited = true;
    exitResolve();
  });

  ffmpeg.stdin.on("error", (err) => {
    if (err.code === "EPIPE") {
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
                new Promise((resolve) => {
                  drainResolve = () => {
                    drainResolve = () => {};
                    resolve();
                  };
                }),
                exitPromise.then(() => {}),
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
        await Promise.race([setTimeout(50), exitPromise.then(() => {})]);
      }
    }
  };

  const drainPromise = drainLoop();

  const onDrain = () => drainResolve();
  ffmpeg.stdin.on("drain", onDrain);

  const frameHandler = (params) => {
    const buf = Buffer.from(params.data, "base64");

    client
      .send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId)
      .catch(() => {});

    if (stopRequested || ffmpegExited) return;

    if (frameBuffer.length >= RECORDER_FRAME_BUFFER_CAP) {
      frameBuffer.shift();
      droppedFrames++;
    }
    frameBuffer.push(buf);
    frameCount++;
  };

  client.on("Page.screencastFrame", frameHandler);

  // F-067-6: publish activeRecording BEFORE any further await so a concurrent
  // stopRecorder (or a second startRecorder) sees the recording the instant
  // ffmpeg is spawned — otherwise a stop issued between spawn and assignment
  // throws 'not recording' and the ffmpeg child is orphaned until sweep's
  // age cutoff.
  activeRecording = {
    ffmpeg,
    frameHandler,
    onDrain,
    drainPromise,
    exitPromise,
    frameCount: () => frameCount,
    droppedFrames: () => droppedFrames,
    startedAt,
    fps: fpsOut,
    outPath,
    codec: p.codec,
    recorderJsonPath,
    ffmpegError: () => ffmpegError,
    sessionDir,
    markStop: () => {
      stopRequested = true;
    },
  };

  const failStart = async (err) => {
    stopRequested = true;
    try {
      ffmpeg.kill();
    } catch {}
    if (activeRecording && activeRecording.ffmpeg === ffmpeg) activeRecording = null;
    client.off("Page.screencastFrame", frameHandler);
    ffmpeg.stdin.off("drain", onDrain);
    try {
      await secureWrite(
        recorderJsonPath,
        JSON.stringify({
          running: false,
          error: err.message,
        }),
        { encoding: "utf-8" },
      );
    } catch {}
  };

  const recorderState = {
    running: true,
    startedAt,
    name: outName,
    fps: fpsOut,
    outPath,
  };

  try {
    await secureWrite(recorderJsonPath, JSON.stringify(recorderState), { encoding: "utf-8" });
  } catch (err) {
    await failStart(err);
    throw err;
  }

  try {
    await client.send(
      "Page.startScreencast",
      {
        format: "jpeg",
        quality: SCREENCAST_QUALITY,
        maxWidth: SCREENCAST_MAX_WIDTH,
        maxHeight: SCREENCAST_MAX_HEIGHT,
        everyNthFrame: SCREENCAST_EVERY_NTH,
      },
      sessionId,
    );
  } catch (err) {
    await failStart(err);
    throw err;
  }

  return { isRecording: true };
}

export async function stopRecorder(client, sessionId, sessionDir) {
  if (!activeRecording) {
    throw new Error("not recording");
  }
  if (activeRecording.sessionDir !== sessionDir) {
    throw new Error("not recording");
  }

  const rec = activeRecording;
  activeRecording = null;

  try {
    await client.send("Page.stopScreencast", {}, sessionId);
  } catch {}

  client.off("Page.screencastFrame", rec.frameHandler);
  rec.markStop();

  try {
    await rec.drainPromise;
  } catch {}

  rec.ffmpeg.stdin.off("drain", rec.onDrain);

  if (rec.ffmpeg.stdin && !rec.ffmpeg.stdin.destroyed) {
    try {
      rec.ffmpeg.stdin.end();
    } catch {}
  }

  let usedKill = false;
  let ffmpegNeverExited = false;
  if (rec.ffmpeg.exitCode === null && !rec.ffmpeg.killed) {
    await Promise.race([
      new Promise((resolve) => rec.ffmpeg.on("exit", resolve)),
      setTimeout(8000).then(() => {
        try {
          rec.ffmpeg.kill("SIGKILL");
        } catch {}
      }),
    ]);
    usedKill = rec.ffmpeg.killed;
    // F-007: the race above resolves the moment SIGKILL is issued, NOT when
    // ffmpeg actually exited — validating against a dying muxer would accept
    // a trailer-less file. Await the real 'exit' with a short hard bound.
    if (rec.ffmpeg.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => rec.ffmpeg.on("exit", resolve)),
        setTimeout(2000).then(() => {
          try {
            rec.ffmpeg.kill("SIGKILL");
          } catch {}
        }),
      ]);
    }
    // R1.6/F-007: after the hard bound the process STILL has not emitted
    // 'exit' — it is wedged (uninterruptible D state or a zombie not yet
    // reaped), so its output cannot be trusted as a cleanly-finalized file.
    // Treat the output as a failure rather than validating it as success.
    if (rec.ffmpeg.exitCode === null) ffmpegNeverExited = true;
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
    error: ffmpegErr ? ffmpegErr.message : null,
  };

  let outputError = null;
  try {
    await assertValidOutput(rec.outPath, rec.frameCount());
    try {
      await unlink(join(sessionDir, "ffmpeg-stderr.log"));
    } catch {}
  } catch (err) {
    outputError = err.message;
  }

  // F-007: on the forced-kill path, a non-empty but trailer-less file must
  // not be reported as success — probe the real duration.
  if (usedKill) {
    let dur = null;
    try {
      dur = await probeVideoDuration(rec.outPath);
    } catch {}
    if (dur === null && !outputError) {
      outputError = "screencast output is unreadable after forced kill (no duration)";
    }
  }

  // R1.6/F-007: a muxer that never emitted 'exit' after SIGKILL cannot have
  // written a valid trailer — fail the output regardless of probe results.
  if (ffmpegNeverExited && !outputError) {
    outputError = "screencast output unverified: ffmpeg did not exit after SIGKILL";
  }

  stats.error = outputError || stats.error;

  try {
    await secureWrite(rec.recorderJsonPath, JSON.stringify(stats, null, 2), { encoding: "utf-8" });
  } catch {}

  if (outputError) throw new Error(outputError);

  return {
    file: stats.file,
    frames: stats.frames,
    duration: stats.duration,
    codec: stats.codec,
  };
}
