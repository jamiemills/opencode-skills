import { readFile, rename, rm, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SID_REGEX, SESSIONS_ROOT } from "./constants.mjs";
import {
  assertContained,
  assertRuntimeRoot,
  ensurePrivateFile,
  prepareRuntimeRoot,
  secureWrite,
  validateState,
} from "./security.mjs";

// Per-session CDP auth token (F-0XX / T001): 32 random bytes, base64url.
// Bound to a session's generation counter; rotated on daemon reconnect,
// revoked on session close/cleanup. Rides ?token= on wsUrl + cdpUrl so
// consumers are untouched; the raw value lives only in 0600 state.json and
// the gate's process env.
const TOKEN_BYTES = 32;

export function generateToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// Append (or overwrite) ?token=<value> on any ws/http URL string.
export function withToken(urlString, token) {
  const url = new URL(urlString);
  url.searchParams.set("token", token);
  return url.toString();
}

function withoutToken(urlString) {
  const url = new URL(urlString);
  url.searchParams.delete("token");
  return url.toString();
}

// Join `path` onto a base CDP URL that may already carry ?token= and keep
// every existing query param. `cdpUrl + '/json/version'` is NOT safe once
// cdpUrl carries a query, so every curl site must go through this helper.
export function cdpEndpoint(cdpUrl, path, token) {
  const base = new URL(cdpUrl);
  const target = new URL(path, `${base.origin}${base.pathname}`);
  for (const [k, v] of base.searchParams) target.searchParams.set(k, v);
  if (token) target.searchParams.set("token", token);
  return target.toString();
}

// Bump the generation and mint a fresh token on wsUrl + cdpUrl. The old
// token is invalidated: any client still holding it is rejected at the gate.
export function rotateToken(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Invalid session state for token rotation");
  }
  const token = generateToken();
  const generation = (Number.isInteger(state.tokenGeneration) ? state.tokenGeneration : 0) + 1;
  state.token = token;
  state.tokenGeneration = generation;
  if (state.wsUrl) state.wsUrl = withToken(state.wsUrl, token);
  if (state.cdpUrl) state.cdpUrl = withToken(state.cdpUrl, token);
  return state;
}

// Drop the token from state and its URLs. Revocation at the session layer;
// the gate process itself is killed separately (killGate).
export function revokeToken(state) {
  if (state && typeof state === "object") {
    delete state.token;
    delete state.tokenGeneration;
    if (state.wsUrl) state.wsUrl = withoutToken(state.wsUrl);
    if (state.cdpUrl) state.cdpUrl = withoutToken(state.cdpUrl);
  }
  return state;
}

export function validateSid(sid) {
  if (typeof sid !== "string" || !sid) {
    throw new Error(`Invalid session ID: "${sid}". Must match ${SID_REGEX}`);
  }
  const re = new RegExp(SID_REGEX);
  if (!re.test(sid)) {
    throw new Error(`Invalid session ID: "${sid}". Must match ${SID_REGEX}`);
  }
}

export function sessionDir(sid) {
  validateSid(sid);
  if (existsSync(SESSIONS_ROOT)) assertRuntimeRoot(SESSIONS_ROOT);
  assertContained(join(SESSIONS_ROOT, sid), SESSIONS_ROOT);
  return join(SESSIONS_ROOT, sid);
}

export function containerSessionDir(sid) {
  return `/config/csm-browse/sessions/${sid}`;
}

export async function loadState(sid) {
  const dir = sessionDir(sid);
  const statePath = join(dir, "state.json");
  if (!existsSync(statePath)) return null;
  await ensurePrivateFile(statePath);
  const raw = await readFile(statePath, "utf-8");
  return validateState(JSON.parse(raw), sid);
}

export async function saveState(sid, state) {
  const dir = sessionDir(sid);
  await prepareRuntimeRoot(SESSIONS_ROOT);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  validateState(state, sid);
  const statePath = join(dir, "state.json");
  const tmpPath = join(dir, "state.json.tmp");
  await secureWrite(tmpPath, JSON.stringify(state, null, 2), { encoding: "utf-8" });
  await rename(tmpPath, statePath);
  await chmod(statePath, 0o600);
}

export async function removeState(sid) {
  const dir = sessionDir(sid);
  await rm(dir, { recursive: true, force: true });
}
