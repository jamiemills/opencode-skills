// Durable registry of temporary resources (worktrees + temp dirs) created by
// the session helpers. Written atomically (tmp + rename) under the repository's
// `.agents/state/` so an interrupted session's resources remain discoverable
// and safely removable later. This module never deletes anything.
//
// Entry shape: { kind: "worktree" | "tempdir", path (absolute), branch?, runId,
// ts (UTC ISO, ends with Z) }. Entries are deduplicated by absolute path —
// re-registering a path updates its record in place.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const STATE_DIR = path.join(".agents", "state");
const REGISTRY_BASENAME = "temp-registry.json";
const KINDS = new Set(["worktree", "tempdir"]);

function utcNow() {
  return new Date().toISOString();
}

function isUtc(ts) {
  return typeof ts === "string" && ts.endsWith("Z") && !Number.isNaN(Date.parse(ts));
}

function defaultRoot(root) {
  return root ? path.resolve(root) : process.cwd();
}

export function registryPath(root = process.cwd()) {
  return path.join(defaultRoot(root), STATE_DIR, REGISTRY_BASENAME);
}

// Load the registry as an array, tolerating a missing or corrupt file (an
// unreadable registry is treated as empty, never as a reason to fail).
export function load(root = process.cwd()) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath(root), "utf8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      KINDS.has(entry.kind) &&
      typeof entry.path === "string" &&
      entry.path.length > 0,
  );
}

// Atomic write: serialize to a sibling temp file, then rename over the target
// so a crash mid-write can never leave a truncated registry.
function save(root, entries) {
  const file = registryPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best effort cleanup of the temp file
    }
    throw err;
  }
}

function normalize(entry) {
  if (!entry || typeof entry !== "object") throw new Error("registry entry must be an object");
  if (!KINDS.has(entry.kind))
    throw new Error(`registry entry kind must be one of ${[...KINDS].join(", ")}`);
  if (typeof entry.path !== "string" || entry.path.length === 0)
    throw new Error("registry entry path is required");
  const ts = entry.ts === undefined ? utcNow() : entry.ts;
  if (!isUtc(ts)) throw new Error("registry entry ts must be a UTC ISO timestamp (ends with Z)");
  const normalized = {
    kind: entry.kind,
    path: path.resolve(entry.path),
    runId:
      entry.runId === undefined ? process.env.CSM_RUN_ID || "unattributed" : String(entry.runId),
    ts,
  };
  if (entry.branch !== undefined && entry.branch !== null && entry.branch !== "") {
    normalized.branch = String(entry.branch);
  }
  return normalized;
}

// Register (or update, deduplicated by absolute path) a resource. Returns the
// normalized entry as stored.
export function register(entry, root = process.cwd()) {
  const normalized = normalize(entry);
  const entries = load(root);
  const idx = entries.findIndex((e) => path.resolve(e.path) === normalized.path);
  if (idx >= 0) entries[idx] = normalized;
  else entries.push(normalized);
  save(root, entries);
  return normalized;
}

// Remove a path from the registry. Idempotent: a path that is not registered is
// a no-op and returns false. Returns true when an entry was removed.
export function unregister(target, root = process.cwd()) {
  if (typeof target !== "string" || target.length === 0) return false;
  const abs = path.resolve(target);
  const entries = load(root);
  const next = entries.filter((e) => path.resolve(e.path) !== abs);
  if (next.length === entries.length) return false;
  save(root, next);
  return true;
}

export function list(root = process.cwd()) {
  return load(root).map((entry) => ({ ...entry }));
}
