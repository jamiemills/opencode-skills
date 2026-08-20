'use strict';

import fs from 'node:fs';
import path from 'node:path';

const TOGGLE_FILE = path.join('.agents', 'token-efficiency.json');

// Parses the toggle file text. Contract (A9): ON by default, fail-closed —
// anything other than a valid `{"enabled": false}` resolves to ENABLED. Only
// `{"enabled": <boolean>}` yields ok:true; absent key, non-object JSON (e.g.
// the literal `true`), a non-boolean value, and unparseable text all yield
// enabled:true with ok:false (the caller surfaces a warning).
export function parseToggle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { enabled: true, ok: false };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { enabled: true, ok: false };
  }
  if (Object.prototype.hasOwnProperty.call(data, 'enabled') && typeof data.enabled === 'boolean') {
    return { enabled: data.enabled, ok: true };
  }
  return { enabled: true, ok: false };
}

// Walks up from startDir to the nearest git root (a dir containing `.git`,
// file or dir; else the filesystem root), checking `<dir>/.agents/
// token-efficiency.json` at each level. Nearest match wins; the walk stops at
// the nearest git root so a nested repo resolves its own toggle, never its
// parent repo's. Returns the winning file path or null.
export function findToggleFile(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, TOGGLE_FILE);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // no toggle at this level — keep walking up
    }
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Resolves the effective toggle for startDir. Absent file -> enabled with no
// source. Malformed/unreadable/non-boolean content -> enabled (fail-closed,
// A9) with a warning naming the file. Only an explicit {"enabled": false}
// disables.
export function isEnabled(startDir) {
  const file = findToggleFile(startDir);
  if (file === null) return { enabled: true, source: null, warning: null };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { enabled: true, source: file, warning: `cannot read ${file} (${err.code}) — treated as enabled (fail-closed)` };
  }
  const parsed = parseToggle(text);
  if (!parsed.ok) {
    return { enabled: true, source: file, warning: `${file} malformed or non-boolean — treated as enabled (fail-closed)` };
  }
  return { enabled: parsed.enabled, source: file, warning: null };
}
