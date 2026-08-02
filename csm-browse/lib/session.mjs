import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SID_REGEX, SESSIONS_ROOT } from './constants.mjs';

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
  return join(SESSIONS_ROOT, sid);
}

export function containerSessionDir(sid) {
  return `/config/csm-browse/sessions/${sid}`;
}

export async function loadState(sid) {
  const dir = sessionDir(sid);
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) return null;
  const raw = await readFile(statePath, 'utf-8');
  return JSON.parse(raw);
}

export async function saveState(sid, state) {
  const dir = sessionDir(sid);
  await mkdir(dir, { recursive: true });
  const statePath = join(dir, 'state.json');
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

export async function removeState(sid) {
  const dir = sessionDir(sid);
  await rm(dir, { recursive: true, force: true });
}
