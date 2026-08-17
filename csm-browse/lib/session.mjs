import { readFile, rename, rm, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SID_REGEX, SESSIONS_ROOT } from './constants.mjs';
import { assertContained, assertRuntimeRoot, ensurePrivateFile, prepareRuntimeRoot, secureWrite, validateState } from './security.mjs';

export function validateSid(sid) {
  if (typeof sid !== 'string' || !sid) {
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
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) return null;
  await ensurePrivateFile(statePath);
  const raw = await readFile(statePath, 'utf-8');
  return validateState(JSON.parse(raw), sid);
}

export async function saveState(sid, state) {
  const dir = sessionDir(sid);
  await prepareRuntimeRoot(SESSIONS_ROOT);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  validateState(state, sid);
  const statePath = join(dir, 'state.json');
  const tmpPath = join(dir, 'state.json.tmp');
  await secureWrite(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf-8' });
  await rename(tmpPath, statePath);
  await chmod(statePath, 0o600);
}

export async function removeState(sid) {
  const dir = sessionDir(sid);
  await rm(dir, { recursive: true, force: true });
}
