import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { constants as fsConstants, lstatSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const UID = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;
const CONTAINER_SESSION_PREFIX = "/config/csm-browse/sessions/";

export function defaultSessionsRoot() {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime && isAbsolute(runtime)) return join(runtime, "csm-browse");
  return join(homedir(), ".local", "state", "csm-browse");
}

// F-016: the ancestor walks run on every secureWrite/secureAppend, so the
// checks are promise-based (same ordering guarantees as the former sync
// lstat chain — each ancestor is still verified before the no-follow open).
async function assertOwnedDirectory(path, allowStickyShared = false) {
  let info;
  try {
    info = await lstat(path);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  const stickyShared = (info.mode & 0o7777) === 0o1777;
  if (!info.isDirectory() || (info.uid !== UID && !(allowStickyShared && stickyShared))) {
    throw new Error(`Unsafe csm-browse runtime root: ${path} must be a user-owned directory`);
  }
}

async function assertSafeAncestors(path) {
  const parts = resolve(path).split("/");
  let current = parts[0] || "/";
  for (const part of parts.slice(1, -1)) {
    current = join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (err) {
      if (err.code === "ENOENT") break;
      throw err;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
    }
    // Safe ancestors: user-owned dirs; sticky-shared dirs (e.g. /tmp); and
    // root-owned non-writable system dirs (e.g. /, /run, /run/user — the
    // parents of the canonical systemd XDG_RUNTIME_DIR). Group/world-writable
    // non-sticky ancestors are attacker-controllable and always rejected.
    const stickySharedDir = (info.mode & 0o7777) === 0o1777;
    const rootOwnedNonWritable = info.uid === 0 && (info.mode & 0o022) === 0;
    if (info.uid !== UID && !stickySharedDir && !rootOwnedNonWritable) {
      throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
    }
  }
}

// Hardened chmod for a directory we own: open with O_DIRECTORY|O_NOFOLLOW and
// fchmod through the descriptor, so a symlink swapped in between an lstat
// check and the chmod (the leaf TOCTOU) is refused instead of followed. Node
// does not expose openat-style directory handles, but O_DIRECTORY gives the
// same no-follow guarantee for the descriptor itself.
async function chmodOwnedNoFollow(path, mode) {
  const flags = fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
  const fh = await open(path, flags);
  try {
    const info = await fh.stat();
    if (info.uid !== UID) throw new Error(`Unsafe csm-browse path: ${path}`);
    await fh.chmod(mode);
  } finally {
    await fh.close();
  }
}

export async function ensurePrivateDir(path) {
  await assertSafeAncestors(path);
  const target = resolve(path);
  const parts = target.split("/");
  let current = parts[0] || "/";
  for (const part of parts.slice(1)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Refusing symlink directory: ${current}`);
      // Same three-bucket ancestor rule as assertSafeAncestors: user-owned,
      // sticky-shared (e.g. /tmp), or root-owned non-writable system dirs.
      const stickySharedDir = (info.mode & 0o7777) === 0o1777;
      const rootOwnedNonWritable = info.uid === 0 && (info.mode & 0o022) === 0;
      if (info.uid !== UID && !stickySharedDir && !rootOwnedNonWritable) {
        throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
      }
      // Only harden directories we own; system ancestors are never modified.
      if (info.uid !== UID) continue;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      // Leaf creation via mkdir is the one non-atomic step (mkdir has no
      // no-follow flag), and it races only while the parent is still the
      // shared/sticky root or is being created; the O_NOFOLLOW re-open below
      // re-verifies ownership before hardening, so a symlink that appears in
      // that window is refused rather than followed.
      await mkdir(current, { mode: 0o700 });
    }
    await chmodOwnedNoFollow(current, 0o700);
  }
  await assertOwnedDirectory(target);
  return path;
}

export async function validateRuntimeRootSelection(path) {
  await assertSafeAncestors(path);
  const parent =
    resolve(path) === "/" ? "/" : resolve(path).split("/").slice(0, -1).join("/") || "/";
  let info;
  try {
    info = await lstat(parent);
  } catch (err) {
    if (err.code === "ENOENT")
      throw new Error(`Unsafe csm-browse runtime root parent: ${parent} does not exist`, {
        cause: err,
      });
    throw err;
  }
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`Unsafe csm-browse runtime root parent: ${parent}`);
  // Same three-bucket rule as assertSafeAncestors: user-owned, sticky-shared
  // (e.g. /tmp), or root-owned non-writable system dirs (e.g. /run/user, the
  // parent of the canonical systemd XDG_RUNTIME_DIR).
  const stickySharedDir = (info.mode & 0o7777) === 0o1777;
  const rootOwnedNonWritable = info.uid === 0 && (info.mode & 0o022) === 0;
  if (info.uid !== UID && !stickySharedDir && !rootOwnedNonWritable) {
    throw new Error(
      `Unsafe csm-browse runtime root parent: ${parent} must be user-owned, sticky-shared, or root-owned non-writable`,
    );
  }
  return path;
}

// Sync on purpose: assertRuntimeRoot runs at startup (constants load) and in
// sessionDir(), whose sync signature is relied on by many callers. The hot
// write path (secureWrite/secureAppend/ensurePrivateFile/ensurePrivateDir)
// uses the async checks above instead.
export function assertRuntimeRoot(path) {
  const parent =
    resolve(path) === "/" ? "/" : resolve(path).split("/").slice(0, -1).join("/") || "/";
  let parentInfo;
  try {
    parentInfo = lstatSync(parent);
  } catch (err) {
    if (err.code === "ENOENT")
      throw new Error(`Unsafe csm-browse runtime root parent: ${parent} does not exist`, {
        cause: err,
      });
    throw err;
  }
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory())
    throw new Error(`Unsafe csm-browse runtime root parent: ${parent}`);
  const stickySharedParent = (parentInfo.mode & 0o7777) === 0o1777;
  const rootOwnedNonWritableParent = parentInfo.uid === 0 && (parentInfo.mode & 0o022) === 0;
  if (parentInfo.uid !== UID && !stickySharedParent && !rootOwnedNonWritableParent) {
    throw new Error(`Unsafe csm-browse runtime root parent: ${parent}`);
  }
  const parts = resolve(path).split("/");
  let current = parts[0] || "/";
  for (const part of parts.slice(1, -1)) {
    current = join(current, part);
    let info;
    try {
      info = lstatSync(current);
    } catch (err) {
      if (err.code === "ENOENT") break;
      throw err;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
    }
    const stickySharedDir = (info.mode & 0o7777) === 0o1777;
    const rootOwnedNonWritable = info.uid === 0 && (info.mode & 0o022) === 0;
    if (info.uid !== UID && !stickySharedDir && !rootOwnedNonWritable) {
      throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
    }
  }
  const rootInfo = lstatSync(path);
  const stickyShared = (rootInfo.mode & 0o7777) === 0o1777;
  if (
    !rootInfo.isDirectory() ||
    (rootInfo.uid !== UID && !stickyShared) ||
    (rootInfo.mode & 0o777) !== 0o700 ||
    rootInfo.uid !== UID
  ) {
    throw new Error(`Unsafe csm-browse runtime root: ${path} must be mode 0700 and user-owned`);
  }
}

export async function prepareRuntimeRoot(path) {
  await assertSafeAncestors(path);
  await ensurePrivateDir(path);
  assertRuntimeRoot(path);
  return path;
}

export function assertContained(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    resolve(path) === resolve(parent)
  ) {
    throw new Error(`Path escapes csm-browse root: ${path}`);
  }
  return path;
}

export function validateContainerSessionDir(path, sid = null) {
  if (
    typeof path !== "string" ||
    !/^\/config\/csm-browse\/sessions\/[a-z0-9][a-z0-9_-]{0,40}$/.test(path) ||
    (sid && path !== `${CONTAINER_SESSION_PREFIX}${sid}`)
  ) {
    throw new Error(`Unsafe container session path: ${path}`);
  }
  return path;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

function assertLoopbackEndpoint(value, key) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid session ${key}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password || !url.port) {
    throw new Error(`Invalid session ${key}: loopback host and explicit port required`);
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid session ${key}: unexpected port`);
  }
  return url;
}

export function validateState(state, sid = null) {
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new Error("Invalid session state");
  if (sid !== null && state.sid !== undefined && state.sid !== sid)
    throw new Error("Session state sid mismatch");
  if (state.wsUrl !== undefined) {
    const url = assertLoopbackEndpoint(state.wsUrl, "wsUrl", state.publicPort);
    if (url.protocol !== "ws:") throw new Error("Invalid session wsUrl");
  }
  if (state.cdpUrl !== undefined) {
    const url = assertLoopbackEndpoint(state.cdpUrl, "cdpUrl", state.publicPort);
    if (url.protocol !== "http:") throw new Error("Invalid session cdpUrl");
  }
  if (state.wsUrl && state.cdpUrl && new URL(state.wsUrl).port !== new URL(state.cdpUrl).port)
    throw new Error("Invalid session CDP endpoint port mismatch");
  if (state.token !== undefined) {
    if (typeof state.token !== "string" || !TOKEN_RE.test(state.token))
      throw new Error("Invalid session token");
    // Fail closed: a persisted token must be embedded — and identical — in
    // every URL the session exposes. A URL missing the token (or carrying a
    // stale rotated one) is never silently accepted.
    for (const key of ["wsUrl", "cdpUrl"]) {
      if (state[key] === undefined) continue;
      const embedded = new URL(state[key]).searchParams.get("token");
      if (embedded !== state.token) {
        throw new Error(`Invalid session ${key}: token mismatch`);
      }
    }
  }
  if (
    state.tokenGeneration !== undefined &&
    (!Number.isInteger(state.tokenGeneration) || state.tokenGeneration < 1)
  ) {
    throw new Error("Invalid session tokenGeneration");
  }
  for (const key of ["internalPort", "publicPort"]) {
    if (
      state[key] !== undefined &&
      (!Number.isInteger(state[key]) || state[key] < 1024 || state[key] > 65535)
    ) {
      throw new Error(`Invalid session ${key}`);
    }
  }
  if (state.profileDir !== undefined)
    validateContainerSessionDir(state.profileDir, state.sid ?? sid);
  if (state.sessionDir !== undefined && sid !== null) {
    if (
      resolve(state.sessionDir) !==
      resolve(join(process.env.CSM_BROWSE_SESSIONS_ROOT || defaultSessionsRoot(), sid))
    ) {
      throw new Error("Invalid sessionDir containment");
    }
  }
  return state;
}

export async function secureWrite(path, data, options = {}) {
  // Node does not expose Linux openat-style directory handles here. Ancestors
  // are checked before the no-follow open; a hostile rename after that check
  // remains outside the guarantee and is deliberately not called race-free.
  await assertSafeAncestors(path);
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW;
  const fh = await open(path, flags, 0o600);
  try {
    await fh.chmod(0o600);
    await fh.writeFile(data, options.encoding ? { encoding: options.encoding } : undefined);
  } finally {
    await fh.close();
  }
}

export async function secureAppend(path, data) {
  await assertSafeAncestors(path);
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW;
  const fh = await open(path, flags, 0o600);
  try {
    await fh.chmod(0o600);
    await fh.writeFile(data);
  } finally {
    await fh.close();
  }
}

export async function ensurePrivateFile(path) {
  await assertSafeAncestors(path);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.uid !== UID)
    throw new Error(`Unsafe csm-browse state file: ${path}`);
  await chmod(path, 0o600);
}

const SENSITIVE_KEY = /(pass(word)?|token|secret|api[-_]?key|auth|cookie|credential|session)/i;

// F4-06 class split: SENSITIVE_KEY is the UNANCHORED object-key/prose class —
// its substring semantics catch camelCase keys (apiToken, passwordHint) but
// must never grow URL-only credential words, because it also drives
// redactPairs' prose pair scan and redactTelemetry's recursive object-key
// walk: widening it would redact exitCode/statusCode/state/signal
// diagnostics. URL_CREDENTIAL_PARAM is the ANCHORED exact-token class for
// credential param names (OAuth code/state, key, sig/signature, mac, jwt,
// sid) that appear as standalone query/fragment keys; it is consumed ONLY by
// redactUrl — never by prose or object-key redaction — and its anchors keep
// look-alike params (?keynote=, ?codes=) readable.
const URL_CREDENTIAL_PARAM = /^(code|key|sig|signature|mac|jwt|sid|state)$/i;

export function redactUrl(value) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key) || URL_CREDENTIAL_PARAM.test(key))
        url.searchParams.set(key, "[REDACTED]");
    }
    if (url.hash) url.hash = `#${redactPairs(url.hash.slice(1), URL_CREDENTIAL_PARAM)}`;
    if (url.username || url.password) {
      url.username = "";
      url.password = "[REDACTED]";
    }
    return url.toString();
  } catch {
    return value;
  }
}

function redactPairs(value, urlKeyClass = null) {
  // Prefix class includes '?' so a LONE ?token= (no preceding '&') inside
  // prose or a bare URL is caught as a pair; the secret class excludes '?' so
  // a value like 'a=1?token=SECRET' redacts the token pair instead of being
  // swallowed whole, and 'token=SECRET?more' cannot eat the next key.
  // urlKeyClass is passed ONLY by redactUrl's fragment pass (fragment pair
  // keys are exact tokens); prose callers omit it so pair keys like the
  // `code` in "Exit code: 1" are judged by SENSITIVE_KEY alone.
  return value.replace(
    /(^|[&#;,\s?])([A-Za-z][\w-]*(?:[.:][\w-]+)?)\s*([=:])\s*("[^"]*"|'[^']*'|[^&#;,\s?]+)/gi,
    (whole, prefix, key, separator, _secret) =>
      SENSITIVE_KEY.test(key) || (urlKeyClass !== null && urlKeyClass.test(key))
        ? `${prefix}${key}${separator}[REDACTED]`
        : whole,
  );
}

// A scheme-ful URL embedded in prose is not a single parseable string, and
// redactPairs' `key: value` pair scan would swallow it whole (e.g. `ws:` as a
// non-sensitive key eating `//host/x?token=SECRET`). Extract each embedded
// URL and redact it individually so a prose-embedded ?token= is never missed.
const EMBEDDED_URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s<>"']+/gi;

function redactProse(value) {
  return value.replace(EMBEDDED_URL_RE, (m) => redactUrl(m));
}

export function redactTelemetry(value, key = "") {
  if (typeof value === "string") {
    if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (/^\s*[{[]/.test(value)) {
      try {
        return JSON.stringify(redactTelemetry(JSON.parse(value)));
      } catch {}
    }
    const redacted = redactPairs(redactProse(value));
    return redactUrl(redacted);
  }
  if (Array.isArray(value)) return value.map((item) => redactTelemetry(item));
  if (!value || typeof value !== "object") return value;
  const namedSensitive = typeof value.name === "string" && SENSITIVE_KEY.test(value.name);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      namedSensitive && k === "value" ? "[REDACTED]" : redactTelemetry(v, k),
    ]),
  );
}
