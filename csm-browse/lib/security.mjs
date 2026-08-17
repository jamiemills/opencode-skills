import { chmod, mkdir, open } from 'node:fs/promises';
import { constants as fsConstants, lstatSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const UID = typeof process.getuid === 'function' ? process.getuid() : userInfo().uid;
const CONTAINER_SESSION_PREFIX = '/config/csm-browse/sessions/';

export function defaultSessionsRoot() {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime && isAbsolute(runtime)) return join(runtime, 'csm-browse');
  return join(homedir(), '.local', 'state', 'csm-browse');
}

function assertOwnedDirectory(path, allowStickyShared = false) {
  let info;
  try { info = lstatSync(path); } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const stickyShared = (info.mode & 0o7777) === 0o1777;
  if (!info.isDirectory() || (info.uid !== UID && !(allowStickyShared && stickyShared))) {
    throw new Error(`Unsafe csm-browse runtime root: ${path} must be a user-owned directory`);
  }
}

function assertSafeAncestors(path) {
  const parts = resolve(path).split('/');
  let current = parts[0] || '/';
  for (const part of parts.slice(1, -1)) {
    current = join(current, part);
    let info;
    try { info = lstatSync(current); } catch (err) {
      if (err.code === 'ENOENT') break;
      throw err;
    }
    const stickySharedDir = (info.mode & 0o7777) === 0o1777;
    if (info.isSymbolicLink() || !info.isDirectory() || (info.uid !== UID && !stickySharedDir)) {
      throw new Error(`Unsafe csm-browse path ancestor: ${current}`);
    }
  }
}

export async function ensurePrivateDir(path) {
  assertSafeAncestors(path);
  const target = resolve(path);
  const parts = target.split('/');
  let current = parts[0] || '/';
  for (const part of parts.slice(1)) {
    current = join(current, part);
    try {
      assertOwnedDirectory(current, true);
      const info = lstatSync(current);
      if (info.isSymbolicLink()) throw new Error(`Refusing symlink directory: ${current}`);
      if (info.uid !== UID && (info.mode & 0o7777) === 0o1777) continue;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await mkdir(current, { mode: 0o700 });
    }
    await chmod(current, 0o700);
  }
  assertOwnedDirectory(target);
  return path;
}

export function validateRuntimeRootSelection(path) {
  assertSafeAncestors(path);
  const parent = resolve(path) === '/' ? '/' : resolve(path).split('/').slice(0, -1).join('/') || '/';
  let info;
  try { info = lstatSync(parent); } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Unsafe csm-browse runtime root parent: ${parent} does not exist`);
    throw err;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe csm-browse runtime root parent: ${parent}`);
  const stickySharedDir = (info.mode & 0o7777) === 0o1777;
  if (info.uid !== UID && !stickySharedDir) throw new Error(`Unsafe csm-browse runtime root parent: ${parent} must be user-owned`);
  if (!stickySharedDir && (info.mode & 0o022) !== 0) throw new Error(`Unsafe csm-browse runtime root parent: ${parent} must not be group/world writable`);
  return path;
}

export function assertRuntimeRoot(path) {
  validateRuntimeRootSelection(path);
  assertSafeAncestors(path);
  assertOwnedDirectory(path);
  const info = lstatSync(path);
  if ((info.mode & 0o777) !== 0o700 || info.uid !== UID) {
    throw new Error(`Unsafe csm-browse runtime root: ${path} must be mode 0700 and user-owned`);
  }
}

export async function prepareRuntimeRoot(path) {
  assertSafeAncestors(path);
  await ensurePrivateDir(path);
  assertRuntimeRoot(path);
  return path;
}

export function assertContained(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || resolve(path) === resolve(parent)) {
    throw new Error(`Path escapes csm-browse root: ${path}`);
  }
  return path;
}

export function validateContainerSessionDir(path, sid = null) {
  if (typeof path !== 'string' || !/^\/config\/csm-browse\/sessions\/[a-z0-9][a-z0-9_-]{0,40}$/.test(path) || (sid && path !== `${CONTAINER_SESSION_PREFIX}${sid}`)) {
    throw new Error(`Unsafe container session path: ${path}`);
  }
  return path;
}

export function validateState(state, sid = null) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid session state');
  if (sid !== null && state.sid !== undefined && state.sid !== sid) throw new Error('Session state sid mismatch');
  if (state.wsUrl !== undefined) {
    let url;
    try { url = new URL(state.wsUrl); } catch { throw new Error('Invalid session wsUrl'); }
    if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid session wsUrl');
  }
  for (const key of ['internalPort', 'publicPort']) {
    if (state[key] !== undefined && (!Number.isInteger(state[key]) || state[key] < 1024 || state[key] > 65535)) {
      throw new Error(`Invalid session ${key}`);
    }
  }
  if (state.profileDir !== undefined) validateContainerSessionDir(state.profileDir, state.sid ?? sid);
  if (state.sessionDir !== undefined && sid !== null) {
    if (resolve(state.sessionDir) !== resolve(join(process.env.CSM_BROWSE_SESSIONS_ROOT || defaultSessionsRoot(), sid))) {
      throw new Error('Invalid sessionDir containment');
    }
  }
  return state;
}

export async function secureWrite(path, data, options = {}) {
  // Node does not expose Linux openat-style directory handles here. Ancestors
  // are checked before the no-follow open; a hostile rename after that check
  // remains outside the guarantee and is deliberately not called race-free.
  assertSafeAncestors(path);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW;
  const fh = await open(path, flags, 0o600);
  try {
    await fh.chmod(0o600);
    await fh.writeFile(data, options.encoding ? { encoding: options.encoding } : undefined);
  } finally { await fh.close(); }
}

export async function secureAppend(path, data) {
  assertSafeAncestors(path);
  const flags = fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW;
  const fh = await open(path, flags, 0o600);
  try { await fh.chmod(0o600); await fh.writeFile(data); } finally { await fh.close(); }
}

export async function ensurePrivateFile(path) {
  assertSafeAncestors(path);
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || info.uid !== UID) throw new Error(`Unsafe csm-browse state file: ${path}`);
  await chmod(path, 0o600);
}

const SENSITIVE_KEY = /(pass(word)?|token|secret|api[-_]?key|auth|cookie|credential|session)/i;

export function redactUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    if (url.hash) url.hash = `#${redactPairs(url.hash.slice(1))}`;
    if (url.username || url.password) { url.username = ''; url.password = '[REDACTED]'; }
    return url.toString();
  } catch { return value; }
}

function redactPairs(value) {
  return value.replace(/(^|[&#;,\s])([A-Za-z][\w-]*(?:[.:][\w-]+)?)\s*([=:])\s*("[^"]*"|'[^']*'|[^&#;,\s]+)/gi,
    (whole, prefix, key, separator, secret) => SENSITIVE_KEY.test(key) ? `${prefix}${key}${separator}[REDACTED]` : whole);
}

export function redactTelemetry(value, key = '') {
  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (/^\s*[\[{]/.test(value)) {
      try { return JSON.stringify(redactTelemetry(JSON.parse(value))); } catch {}
    }
    const redacted = redactPairs(value);
    return redactUrl(redacted);
  }
  if (Array.isArray(value)) return value.map(item => redactTelemetry(item));
  if (!value || typeof value !== 'object') return value;
  const namedSensitive = typeof value.name === 'string' && SENSITIVE_KEY.test(value.name);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [
    k,
    namedSensitive && k === 'value' ? '[REDACTED]' : redactTelemetry(v, k)
  ]));
}
