import { fileURLToPath } from 'node:url';

export const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
export const SESSIONS_ROOT = '/tmp/csm-browse';
export const CONTAINER_NAME = 'chromium-vnc';
export const IMAGE = 'jlesage/chromium:latest';
export const DOCKER_RUN_CMD = 'docker run -d --name chromium-vnc --restart unless-stopped -e CHROMIUM_REMOTE_DEBUGGING=1 -e KEEP_APP_RUNNING=1 -p 5900:5900 -p 9222:9222 jlesage/chromium:latest';
export const CHROMIUM_BIN = '/usr/lib/chromium/chromium';
export const PORT_POOL_START = 9224;
export const PORT_POOL_END = 9234;
export const SID_REGEX = '^[a-z0-9][a-z0-9_-]{0,40}$';
export const FIXTURE_BASE = 'http://172.17.0.1:8090';
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
  '--remote-debugging-address=0.0.0.0',
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
