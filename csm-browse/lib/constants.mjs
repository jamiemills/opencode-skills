import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultSessionsRoot, validateRuntimeRootSelection } from "./security.mjs";

export const SKILL_DIR = fileURLToPath(new URL("..", import.meta.url));
export const SESSIONS_ROOT = process.env.CSM_BROWSE_SESSIONS_ROOT || defaultSessionsRoot();
await validateRuntimeRootSelection(SESSIONS_ROOT);
export const CONTAINER_NAME = "chromium-vnc";
// F-050: digest-pinned so `docker pull` is immutable — the :latest tag can
// never repoint underneath us. Refresh the digest quarterly (same cadence as
// dependency updates) via:
//   docker pull jlesage/chromium:latest && \
//   docker image inspect --format '{{index .RepoDigests 0}}' jlesage/chromium:latest
export const IMAGE =
  "jlesage/chromium@sha256:7514667737463e4302d5b58bd07311790dd29c816d4a980143a96de85cf0210e";
// F-059: digest-age staleness check. The pinned digest is refreshed on this
// date; after IMAGE_MAX_AGE_MS (90 days, ~quarterly) imageStaleMs() reports
// how overdue the pin is so ensure-browser can surface it loudly instead of
// letting browser CVEs age silently behind the digest.
export const IMAGE_PINNED_AT = new Date("2026-08-20T00:00:00Z");
export const IMAGE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export function imageStaleMs(now = new Date()) {
  return Math.max(0, now.getTime() - IMAGE_PINNED_AT.getTime() - IMAGE_MAX_AGE_MS);
}
export function assertImageFresh(now = new Date()) {
  const staleMs = imageStaleMs(now);
  if (staleMs > 0) {
    throw new Error(
      `Pinned browser image is ${Math.round(staleMs / 86400000)} days stale — refresh the digest per the IMAGE comment cadence`,
    );
  }
}
// VNC password is generated once by ensure-browser.mjs and stored here (0600,
// parent dir 0700); it is passed to the container via CONTAINER_ENV_FILE, so
// the value never appears in a docker run argv (ps-visible).
export const VNC_PASS_PATH = join(homedir(), ".config", "csm-browse", "vnc-pass");
// Single source for every path the shared container needs: the F-067-5 rule
// is that the printed/executed command can never hardcode a second copy.
export const CONTAINER_CONFIG_DIR = join(homedir(), ".config", "csm-browse");
export const CONTAINER_CONFIG_HOST_DIR = join(CONTAINER_CONFIG_DIR, "container-config");
export const CONTAINER_ENV_FILE = join(CONTAINER_CONFIG_DIR, "container.env");
export const CONTAINER_TOKEN_PATH = join(CONTAINER_CONFIG_DIR, "container-token");
export const CONTAINER_GATE_LOG = join(CONTAINER_CONFIG_DIR, "shared-gate.log");
export const CONTAINER_GATE_SID = "container-9222";
// F-001 / F-016 / F-067-10: the shared container runs on a dedicated bridge
// (off the default bridge, so sibling default-bridge containers cannot reach
// its CDP relay), drops the dangerous caps the image does not need, disables
// new privileges, mounts a read-only rootfs with writable tmpfs, and carries
// cgroup limits. Chromium's debug server binds loopback via CHROMIUM_CUSTOM_ARGS.
export const CONTAINER_NETWORK = "csm-browse-net";
export const CONTAINER_CAP_DROP = [
  "NET_RAW",
  "SYS_ADMIN",
  "SYS_PTRACE",
  "NET_ADMIN",
  "MKNOD",
  "SETFCAP",
  "AUDIT_WRITE",
];
export const CONTAINER_MEMORY = "4g";
export const CONTAINER_CPUS = "4";
export const CONTAINER_PIDS_LIMIT = 1024;
export const CONTAINER_SHM_SIZE = "1g";
export const CHROMIUM_CUSTOM_ARGS = "--remote-debugging-address=127.0.0.1";
// The primary shared browser's CDP port. It is NOT published to the host
// anymore: host access goes only through the token-gated funnel (a host-side
// cdp-gate on 127.0.0.1:9222), and the container is off the default bridge.
export const SHARED_CDP_PORT = 9222;
// F-001: the jlesage image starts chromium with
// `--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1` (when
// CHROMIUM_REMOTE_DEBUGGING=1) and then runs its OWN `socat TCP-LISTEN:9222,
// fork TCP:127.0.0.1:9223` on 0.0.0.0 inside the container — which answers
// unauthenticated CDP on the container's bridge IP even though chromium binds
// loopback. That relay is neutralized after every container create/start/
// restart, and the token-gated host funnel targets chromium's real loopback
// listener here, NOT the dead 9222 relay.
export const CONTAINER_CDP_INTERNAL_PORT = 9223;
export const DOCKER_RUN_CMD = [
  "docker run -d --name chromium-vnc --restart unless-stopped",
  `--network ${CONTAINER_NETWORK}`,
  CONTAINER_CAP_DROP.map((c) => `--cap-drop ${c}`).join(" "),
  "--security-opt no-new-privileges --read-only",
  "--tmpfs /tmp --tmpfs /run --tmpfs /dev/shm:size=1073741824",
  `--memory ${CONTAINER_MEMORY} --memory-swap ${CONTAINER_MEMORY} --cpus ${CONTAINER_CPUS} --pids-limit ${CONTAINER_PIDS_LIMIT} --shm-size ${CONTAINER_SHM_SIZE}`,
  "-e CHROMIUM_REMOTE_DEBUGGING=1 -e KEEP_APP_RUNNING=1",
  `--env-file ${CONTAINER_ENV_FILE}`,
  `-e CHROMIUM_CUSTOM_ARGS=${CHROMIUM_CUSTOM_ARGS}`,
  `-v ${CONTAINER_CONFIG_HOST_DIR}:/config`,
  "-p 127.0.0.1:5900:5900",
  IMAGE,
].join(" ");
export const CHROMIUM_BIN = "/usr/lib/chromium/chromium";
export const PORT_POOL_START = 9224;
export const PORT_POOL_END = 9234;
export const SID_REGEX = "^[a-z0-9][a-z0-9_-]{0,40}$";
// Fixture-server base URL selection lives in tests/serve.mjs and tests/e2e.mjs
// (env CSM_BROWSE_FIXTURE_BASE → docker0 gateway detection → 172.17.0.1 fallback);
// kept OUT of this module so production entrypoints never fork `ip route` at import.
export const FFMPEG_ARGS = [
  "-y",
  "-f",
  "image2pipe",
  "-c:v",
  "mjpeg",
  "-framerate",
  "15",
  "-i",
  "-",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "23",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
];
export const SCREENCAST_QUALITY = 70;
export const SCREENCAST_MAX_WIDTH = 1920;
export const SCREENCAST_MAX_HEIGHT = 1080;
export const SCREENCAST_EVERY_NTH = 1;
export const MAX_STITCH_HEIGHT_PX = 16384;
export const RECORDER_FRAME_BUFFER_CAP = 60;
export const VIDEO_PRESETS = {
  small: {
    codec: "libvpx-vp9",
    crf: 35,
    cpuUsed: 8,
    deadline: "realtime",
    bitrate: "200k",
    ext: "webm",
  },
  medium: {
    codec: "libvpx-vp9",
    crf: 30,
    cpuUsed: 2,
    deadline: "good",
    bitrate: "1M",
    ext: "webm",
  },
  full: { codec: "libvpx-vp9", crf: 15, cpuUsed: 0, deadline: "good", bitrate: "4M", ext: "webm" },
};

export const SPEED_PRESETS = { slow: 3, medium: 7, fast: 15 };
export const CMD_TIMEOUT_MS = 30000;
export const CMD_POLL_INTERVAL_MS = 500;
export const DAEMON_READY_TIMEOUT_MS = 10000;
export const CDP_RETRY_TIMEOUT_MS = 30000;
export const EVENTS_JSONL_ROTATION = 2000;
export const CHROMIUM_FLAGS = [
  "--ozone-platform-hint=auto",
  "--no-first-run",
  "--password-store=basic",
  "--no-sandbox",
  "--disable-gpu",
  "--enable-software-rasterization",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-webgl",
  "--hide-scrollbars",
];
