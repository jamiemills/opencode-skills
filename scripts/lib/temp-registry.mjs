// Durable, lock-free registry of temporary resources (worktrees + temp dirs)
// created by the session helpers.
//
// F3.3: the old single-file read-modify-write lost concurrent entries. Entries
// now live as one JSON file per normalized path under the shared repo state dir
// (`<git-common-dir>/csm/state/registry.d/`), so two processes registering two
// different paths never touch the same file and no lock is needed. Each write
// is same-directory tmp + rename (atomic on local POSIX; EXDEV is impossible),
// so a concurrent reader never observes a torn entry.
//
// File name: `<sha256hex(normalized real path)>.json` (full digest, never
// truncated). Entry shape: { kind: "worktree" | "tempdir", path (absolute),
// branch?, runId, ts (UTC ISO, ends with Z) }. Entries are deduplicated by
// resolved path — re-registering a path overwrites its single file in place.
//
// This module never deletes anything on its own; `unregister` is the only
// remover and it only unlinks a registry entry file.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash, randomBytes } from "node:crypto";
import { repoMainRoot, repoStateDir } from "./repo-state.mjs";

const STATE_DIR = path.join(".agents", "state");
const REGISTRY_BASENAME = "temp-registry.json";
const REGISTRY_DIRNAME = "registry.d";
const SENTINEL_BASENAME = ".migrated";
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

// The legacy single-file registry path. Kept as the migration source (and for
// backwards compatibility); the live registry is the per-entry directory below.
export function registryPath(root = process.cwd()) {
  return path.join(defaultRoot(root), STATE_DIR, REGISTRY_BASENAME);
}

// The per-entry registry directory under the shared repo state dir. `repoStateDir`
// resolves the git *common* dir, so every linked worktree of a repository reads
// and writes the same registry.
export function registryDir(root = process.cwd()) {
  return path.join(repoStateDir(defaultRoot(root)), REGISTRY_DIRNAME);
}

// A stable id for a target path: the full SHA-256 of its normalized *real*
// path. Symlinked spellings of one directory collapse to one entry. A path that
// does not exist yet (a ghost registration) falls back to its absolute form.
function normalizePath(target) {
  const abs = path.resolve(target);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

export function entryId(target) {
  return createHash("sha256").update(normalizePath(target)).digest("hex");
}

function randomToken() {
  return randomBytes(6).toString("hex");
}

function isValidEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    KINDS.has(entry.kind) &&
    typeof entry.path === "string" &&
    entry.path.length > 0
  );
}

// Load the registry as an array, tolerating a missing or corrupt file (an
// unreadable registry is treated as empty, never as a reason to fail).
export function load(root = process.cwd()) {
  return list(root);
}

// Atomic same-directory write: serialize to a unique sibling temp file, then
// rename over the target so a crash mid-write can never leave a truncated
// entry. Temp files (and the `.migrated` sentinel) are never valid entries.
function writeEntry(dir, entry) {
  const id = entryId(entry.path);
  const target = path.join(dir, `${id}.json`);
  const tmp = path.join(dir, `${id}.${process.pid}.${randomToken()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, target);
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

// The legacy registry only ever lived in the main checkout; `repoMainRoot`
// resolves that shared main-worktree root (bare-repo and non-git fallbacks
// included) without a second porcelain parser.
function readLegacyEntries(root) {
  const candidates = [];
  const main = repoMainRoot(root);
  candidates.push(path.join(main, STATE_DIR, REGISTRY_BASENAME));
  candidates.push(registryPath(root));
  const seen = new Set();
  const entries = [];
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let raw;
    try {
      raw = fs.readFileSync(resolved, "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      if (isValidEntry(entry)) entries.push(entry);
    }
  }
  return entries;
}

// One-time migration of the legacy single-file registry, guarded by an
// atomically-created `registry.d/.migrated` sentinel (tmp + rename). Entries
// are copied before the sentinel lands, so a crash mid-migration simply re-runs
// (the copy is idempotent). Once the sentinel exists the legacy file is never
// read again — an entry unregistered after migration can never be resurrected.
// The legacy file itself is left in place (never deleted), so no deletion trace
// is owed.
function migrateOnce(root) {
  const dir = registryDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const sentinel = path.join(dir, SENTINEL_BASENAME);
  if (fs.existsSync(sentinel)) return;
  for (const entry of readLegacyEntries(root)) {
    try {
      writeEntry(dir, normalize(entry));
    } catch {
      // A malformed legacy entry is quarantined (skipped), never fatal.
    }
  }
  const tmp = path.join(dir, `${SENTINEL_BASENAME}.${process.pid}.${randomToken()}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ ts: utcNow() })}\n`, "utf8");
    fs.renameSync(tmp, sentinel);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best effort cleanup of the temp file
    }
  }
}

// Register (or update, deduplicated by resolved path) a resource. Returns the
// normalized entry as stored.
export function register(entry, root = process.cwd()) {
  const normalized = normalize(entry);
  migrateOnce(root);
  writeEntry(registryDir(root), normalized);
  return normalized;
}

// Remove a path from the registry. Idempotent: a path that is not registered is
// a no-op and returns false. Returns true when an entry file was removed.
export function unregister(target, root = process.cwd()) {
  if (typeof target !== "string" || target.length === 0) return false;
  migrateOnce(root);
  const file = path.join(registryDir(root), `${entryId(target)}.json`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

// List the live entries. Only `*.json` files are considered (`*.tmp` writes and
// the `.migrated` sentinel are ignored). A malformed file, or one whose
// embedded `path` does not hash to the file's own id, is quarantined — skipped,
// never thrown.
export function list(root = process.cwd()) {
  migrateOnce(root);
  const dir = registryDir(root);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isValidEntry(parsed)) continue;
    if (entryId(parsed.path) !== id) continue;
    entries.push({ ...parsed });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}
