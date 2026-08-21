"use strict";

import fs from "node:fs";
import path from "node:path";

const TOGGLE_FILE = path.join(".agents", "token-efficiency.json");

// Parses the toggle file text. Contract: OFF by default (fail-open) —
// anything other than a valid `{"enabled": true}` resolves to DISABLED. Only
// `{"enabled": <boolean>}` yields ok:true; absent key, non-object JSON (e.g.
// the literal `true`), a non-boolean value, and unparseable text all yield
// enabled:false with ok:false (the caller surfaces a warning).
export function parseToggle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { enabled: false, ok: false };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { enabled: false, ok: false };
  }
  if (Object.prototype.hasOwnProperty.call(data, "enabled") && typeof data.enabled === "boolean") {
    return { enabled: data.enabled, ok: true };
  }
  return { enabled: false, ok: false };
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
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Resolves the effective toggle for startDir. Absent file -> disabled with no
// source. Malformed/unreadable/non-boolean content -> disabled with a warning
// naming the file. Only an explicit {"enabled": true} enables.
export function isEnabled(startDir) {
  const file = findToggleFile(startDir);
  if (file === null) return { enabled: false, source: null, warning: null };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return {
      enabled: false,
      source: file,
      warning: `cannot read ${file} (${err.code}) — treated as disabled (default off)`,
    };
  }
  const parsed = parseToggle(text);
  if (!parsed.ok) {
    return {
      enabled: false,
      source: file,
      warning: `${file} malformed or non-boolean — treated as disabled (default off)`,
    };
  }
  return { enabled: parsed.enabled, source: file, warning: null };
}
