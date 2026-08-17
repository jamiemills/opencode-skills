import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultSessionsRoot, validateRuntimeRootSelection } from './security.mjs';

export const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
export const SESSIONS_ROOT = process.env.CSM_BROWSE_SESSIONS_ROOT || defaultSessionsRoot();
validateRuntimeRootSelection(SESSIONS_ROOT);
export const CONTAINER_NAME = 'chromium-vnc';
// F-050: digest-pinned so `docker pull` is immutable — the :latest tag can
// never repoint underneath us. Refresh the digest quarterly (same cadence as
// dependency updates) via:
//   docker pull jlesage/chromium:latest && \
//   docker image inspect --format '{{index .RepoDigests 0}}' jlesage/chromium:latest
export const IMAGE = 'jlesage/chromium@sha256:7514667737463e4302d5b58bd07311790dd29c816d4a980143a96de85cf0210e';
// VNC password is generated once by ensure-browser.mjs and stored here (0600,
// parent dir 0700); it is passed to the container as VNC_PASSWORD.
export const VNC_PASS_PATH = join(homedir(), '.config', 'csm-browse', 'vnc-pass');
// Interpolates IMAGE so the printed command always matches the executed
// argv (ensure-browser logs DOCKER_RUN_CMD and runs IMAGE) — the doc string
// can never drift back to a floating :latest tag while IMAGE is digest-pinned.
export const DOCKER_RUN_CMD = `docker run -d --name chromium-vnc --restart unless-stopped -e CHROMIUM_REMOTE_DEBUGGING=1 -e KEEP_APP_RUNNING=1 -e VNC_PASSWORD=$(cat ~/.config/csm-browse/vnc-pass) -p 127.0.0.1:5900:5900 -p 127.0.0.1:9222:9222 ${IMAGE}`;
export const CHROMIUM_BIN = '/usr/lib/chromium/chromium';
export const PORT_POOL_START = 9224;
export const PORT_POOL_END = 9234;
export const SID_REGEX = '^[a-z0-9][a-z0-9_-]{0,40}$';
// Fixture-server base URL selection lives in tests/serve.mjs and tests/e2e.mjs
// (env CSM_BROWSE_FIXTURE_BASE → docker0 gateway detection → 172.17.0.1 fallback);
// kept OUT of this module so production entrypoints never fork `ip route` at import.
export const FFMPEG_ARGS = ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '15', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
export const SCREENCAST_QUALITY = 70;
export const SCREENCAST_MAX_WIDTH = 1920;
export const SCREENCAST_MAX_HEIGHT = 1080;
export const SCREENCAST_EVERY_NTH = 1;
export const MAX_STITCH_HEIGHT_PX = 16384;
export const RECORDER_FRAME_BUFFER_CAP = 60;
export const VIDEO_PRESETS = {
  small:  { codec: 'libvpx-vp9', crf: 35, cpuUsed: 8, deadline: 'realtime', bitrate: '200k', ext: 'webm' },
  medium: { codec: 'libvpx-vp9', crf: 30, cpuUsed: 2, deadline: 'good',     bitrate: '1M',   ext: 'webm' },
  full:   { codec: 'libvpx-vp9', crf: 15, cpuUsed: 0, deadline: 'good',     bitrate: '4M',   ext: 'webm' },
};

export const SPEED_PRESETS = { slow: 3, medium: 7, fast: 15 };
export const CMD_TIMEOUT_MS = 30000;
export const CMD_POLL_INTERVAL_MS = 500;
export const DAEMON_READY_TIMEOUT_MS = 10000;
export const CDP_RETRY_TIMEOUT_MS = 30000;
export const EVENTS_JSONL_ROTATION = 2000;
export const CHROMIUM_FLAGS = [
  '--ozone-platform-hint=auto',
  '--no-first-run',
  '--password-store=basic',
  '--no-sandbox',
  '--disable-gpu',
  '--enable-software-rasterization',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-webgl',
  '--hide-scrollbars'
];
