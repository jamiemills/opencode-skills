// Canonical declared-layer-model scanner.
//
// Reads the canonical module-to-layer classification declared in
// `quality/architecture.toml` (and equivalent conventions: an
// `architecture.toml` at the repository root, or `architecture.toml` beside
// the primary package) and derives the declared architecture model: per-layer
// name / allowed-dependency / module membership (with exact module counts),
// adapter-independence groups, composition-root membership, and
// composition-root seam-wiring assignments (`_wire_*_seam(...)` calls).
//
// This is a bounded, deterministic, read-only scan. When no canonical
// artifact exists the scanner returns `null` so the architecture findings
// stay byte-identical to the heuristic-only output (backward compatibility).
// A malformed TOML document also degrades to `null` rather than aborting the
// scan, keeping the heuristic model as the fallback.
//
// The seam-wiring fact is bounded: only the composition-root modules (from
// the `composition_root` layer, falling back to `[[composition_roots]]` and
// then the heuristic entry-point files) are scanned, only `_wire_*_seam`
// call sites whose first argument is a string literal are recorded, and only
// identifier-shaped attribute names are kept (never arbitrary string
// content).
//
// ESM only. Zero npm deps. node: builtins only. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseToml } from "../../shared/parse.mjs";
import { compareAscii } from "../../contracts/evidence.mjs";

const MAX_LAYERS = 32;
const MAX_MODULES_PER_LAYER = 512;
const MAX_ADAPTER_GROUPS = 64;
const MAX_MODULES_PER_GROUP = 512;
const MAX_ALLOWED_DEPS = 128;
const MAX_COMPOSITION_ROOT_MODULES = 64;
const MAX_SEAM_WIRINGS = 128;
const MAX_SEAM_SOURCE_BYTES = 1_000_000;

const CANONICAL_FILENAMES = Object.freeze(["quality/architecture.toml", "architecture.toml"]);

const SEAM_CALL_RE = /_wire_([A-Za-z_][A-Za-z0-9_]*)_seam\s*\(\s*(["'])([^"']{1,64})\2/g;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}

function stringList(value, cap) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, cap);
}

// Ordered, de-duplicated candidate paths checked for the canonical artifact.
// The third form is `<primary package dir>/../architecture.toml`.
function candidatePaths(pkgRoot) {
  const candidates = [...CANONICAL_FILENAMES];
  if (pkgRoot) {
    const segments = toPosix(pkgRoot).split("/").filter(Boolean);
    if (segments.length > 1)
      candidates.push(`${segments.slice(0, -1).join("/")}/architecture.toml`);
  }
  return [...new Set(candidates)];
}

function detectCanonicalPath(repoPath, pkgRoot) {
  for (const rel of candidatePaths(pkgRoot)) {
    if (existsSync(join(repoPath, rel))) return rel;
  }
  return null;
}

function parseLayers(parsed) {
  const layers = [];
  const seenNames = new Set();
  for (const raw of Array.isArray(parsed.layers) ? parsed.layers : []) {
    if (layers.length >= MAX_LAYERS) break;
    const name = String((raw && raw.name) || "").trim();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    const modules = stringList(raw.modules, MAX_MODULES_PER_LAYER);
    const allowedDeps = stringList(raw.allowed_deps, MAX_ALLOWED_DEPS);
    layers.push({ name, allowedDeps, moduleCount: modules.length, modules });
  }
  return layers;
}

function parseAdapterIndependence(parsed) {
  const groups = [];
  for (const raw of Array.isArray(parsed.adapter_independence) ? parsed.adapter_independence : []) {
    if (groups.length >= MAX_ADAPTER_GROUPS) break;
    const name = String((raw && raw.name) || `adapter-group-${groups.length}`).trim();
    const modules = stringList(raw.modules, MAX_MODULES_PER_GROUP);
    const mayImportFrom = stringList(raw.may_import_from, MAX_ALLOWED_DEPS);
    groups.push({ name, modules, mayImportFrom });
  }
  return groups;
}

// Composition-root membership: the `composition_root` layer's module list when
// declared, otherwise the `[[composition_roots]]` table declarations.
function compositionRootModuleNames(parsed, layers) {
  const fromLayer = layers.find((layer) => layer.name === "composition_root");
  if (fromLayer) return fromLayer.modules.slice(0, MAX_COMPOSITION_ROOT_MODULES);
  const names = [];
  for (const raw of Array.isArray(parsed.composition_roots) ? parsed.composition_roots : []) {
    for (const module of stringList(raw.modules, MAX_COMPOSITION_ROOT_MODULES)) {
      if (!names.includes(module)) names.push(module);
    }
    if (names.length >= MAX_COMPOSITION_ROOT_MODULES) break;
  }
  return names;
}

// A dot-separated module path relative to the primary package becomes a
// repository-relative `.py` path (`.`, the root package `__init__.py`).
function moduleToRelativeFile(pkgRoot, moduleName) {
  const posix = toPosix(pkgRoot);
  if (moduleName === ".") return `${posix}/__init__.py`;
  const segments = String(moduleName).split(".");
  const stem = segments[segments.length - 1];
  const directory = segments.slice(0, -1).join("/");
  return directory ? `${posix}/${directory}/${stem}.py` : `${posix}/${stem}.py`;
}

function existingRelativeFiles(repoPath, pkgRoot, moduleNames) {
  const files = [];
  for (const module of moduleNames) {
    const rel = moduleToRelativeFile(pkgRoot, module);
    if (existsSync(join(repoPath, rel))) files.push(rel);
  }
  return files;
}

function scanSeamWirings(repoPath, files) {
  const wirings = [];
  for (const file of files) {
    let content;
    try {
      const buffer = readFileSync(join(repoPath, file));
      if (buffer.byteLength > MAX_SEAM_SOURCE_BYTES) continue;
      content = buffer.toString("utf-8");
    } catch {
      continue;
    }
    SEAM_CALL_RE.lastIndex = 0;
    let match;
    while ((match = SEAM_CALL_RE.exec(content)) && wirings.length < MAX_SEAM_WIRINGS) {
      if (!IDENTIFIER_RE.test(match[3])) continue;
      wirings.push({ file, seam: match[1], attribute: match[3] });
    }
  }
  wirings.sort(
    (left, right) =>
      compareAscii(left.file, right.file) ||
      compareAscii(left.seam, right.seam) ||
      compareAscii(left.attribute, right.attribute),
  );
  return wirings;
}

/**
 * Scan the canonical declared-layer model for a repository.
 *
 * Detection is bounded to the ordered candidate list `quality/architecture.toml`,
 * `architecture.toml`, and `<primary package dir>/../architecture.toml`; the
 * first existing artifact wins. When none exists, or the artifact is malformed
 * or declares no layers, `null` is returned so callers can keep the heuristic
 * model untouched.
 *
 * @param {string} repoPath - Repository root.
 * @param {object} [context] - Optional context carrying `pkgRoot` (repository-
 *   relative primary package directory) and `entrypointFiles` (resolved
 *   heuristic entry-point files used as the seam-wiring fallback).
 * @returns {object|null} The canonical model `{ detected, source, layers,
 *   adapterIndependence, compositionRoots, seamWirings }`, or `null`.
 */
export function scanCanonicalLayerModel(repoPath, context = {}) {
  const pkgRoot = String(context.pkgRoot || "").trim();
  const source = detectCanonicalPath(repoPath, pkgRoot);
  if (!source) return null;

  let parsed;
  try {
    parsed = parseToml(readFileSync(join(repoPath, source), "utf-8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const layers = parseLayers(parsed);
  if (layers.length === 0) return null;

  const adapterIndependence = parseAdapterIndependence(parsed);
  const declaredCompositionRoots = compositionRootModuleNames(parsed, layers);
  const compositionRootFiles = existingRelativeFiles(repoPath, pkgRoot, declaredCompositionRoots);
  const seamFiles =
    compositionRootFiles.length > 0
      ? compositionRootFiles
      : Array.isArray(context.entrypointFiles)
        ? context.entrypointFiles
        : [];
  const seamWirings = scanSeamWirings(repoPath, seamFiles);

  return {
    detected: true,
    source,
    layers,
    adapterIndependence,
    compositionRoots: {
      modules: declaredCompositionRoots,
      files: compositionRootFiles,
    },
    seamWirings,
  };
}
