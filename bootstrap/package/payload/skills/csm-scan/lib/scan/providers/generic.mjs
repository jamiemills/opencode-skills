// Artifact-only generic fallback provider for unknown languages.
//
// T210 owns this module. When a repository's detected languages are NOT among
// the five first-class built-ins (python, javascript, typescript, shell, rust),
// this provider produces metadata/path observations ONLY. It never claims:
//   - source syntax or semantic constructs,
//   - import edges or module graphs,
//   - effective runtime behavior,
//   - first-class language depth (parity with the built-ins).
//
// All observations are derived exclusively from normalized repository-relative
// path, extension, size, directory, manifest, lockfile, and known artifact
// metadata. The provider is inert: it is exported as factory functions for
// tests and future provider catalogs (T218-T220), never wired into the
// pipeline, CLI, enrich, validate, write, or renderer.
//
// Bounded disclosure: file_metric observations are capped at
// GENERIC_LIMITS.maxObservations (the measurement-universe record is kept
// first) instead of throwing when a repository has more distinct extensions
// than the bound; `genericProviderResults` returns a deep-frozen
// `{ results, capped }` envelope so callers can detect and disclose the cap.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no side effects.
//
// Source-policy note (T201): this module imports only contracts, the provider
// foundation, and the shared descriptor table; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from "../contracts/evidence.mjs";
import { DESCRIPTORS } from "../shared/ecosystem.mjs";
import { createProviderResult } from "./base.mjs";

export const GENERIC_PROVIDER_ID = "PRV-generic-artifacts-v1";

export const GENERIC_LIMITS = deepFreeze({
  maxFiles: 1_000_000,
  maxObservations: 2048,
  size: 1_099_511_627_776,
  matchedKey: 128,
});

const KNOWN_ECOSYSTEM_IDS = Object.freeze(Object.keys(DESCRIPTORS));
const KNOWN_LANGUAGE_NAMES = new Set([
  "python",
  "javascript",
  "typescript",
  "shell",
  "shell script",
  "bash",
  "rust",
]);

const KNOWN_DOC_ARTIFACTS = deepFreeze({
  readme: ["README", "README.md", "README.txt", "README.rst", "README.markdown", "README.mdx"],
  license: [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE.rst",
    "LICENSE.markdown",
    "COPYING",
    "COPYING.md",
    "UNLICENSE",
  ],
  contributing: ["CONTRIBUTING", "CONTRIBUTING.md", "CONTRIBUTING.rst", "CONTRIBUTING.txt"],
});

export class GenericProviderError extends TypeError {
  constructor(code, message) {
    super(`Generic provider failed: ${message}`);
    this.name = "GenericProviderError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new GenericProviderError(code, message);
}

function knownManifests() {
  const names = new Set();
  for (const descriptor of Object.values(DESCRIPTORS)) {
    for (const name of descriptor.manifests ?? []) names.add(name);
  }
  return [...names].toSorted(compareAscii);
}

function knownLockfiles() {
  const names = new Set();
  for (const descriptor of Object.values(DESCRIPTORS)) {
    for (const name of descriptor.lockfiles ?? []) names.add(name);
  }
  return [...names].toSorted(compareAscii);
}

function basenameOf(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function directoryOf(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function extensionOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * Determine whether a repository contains unknown-language content that the
 * five built-in ecosystems do not cover. Returns true only when no known
 * ecosystem is detected AND at least one detected language name is not a
 * known built-in language name.
 *
 * @param {object} input - `{ languages, ecosystems, manifestEcosystems }`.
 * @returns {boolean}
 */
export function isUnknownLanguageEcosystem({
  languages = [],
  ecosystems = [],
  manifestEcosystems = [],
} = {}) {
  const ids = [
    ...(Array.isArray(ecosystems) ? ecosystems : []),
    ...(Array.isArray(manifestEcosystems) ? manifestEcosystems : []),
  ];
  if (ids.some((id) => KNOWN_ECOSYSTEM_IDS.includes(id))) return false;
  const names = (Array.isArray(languages) ? languages : [])
    .filter((name) => typeof name === "string")
    .map((name) => name.toLowerCase().trim());
  if (names.length === 0) return false;
  return names.some((name) => !KNOWN_LANGUAGE_NAMES.has(name));
}

function normalizeFiles(files) {
  try {
    assertDataOnly(files, GenericProviderError, {
      maxArray: GENERIC_LIMITS.maxFiles,
      maxDepth: 2,
      maxNodes: GENERIC_LIMITS.maxFiles * 2,
      maxObjectKeys: 8,
      maxString: 512,
    });
  } catch (error) {
    if (error instanceof GenericProviderError) throw error;
    fail("INVALID_FILES", "files must contain plain bounded data");
  }
  if (!Array.isArray(files) || files.length > GENERIC_LIMITS.maxFiles) {
    fail("INVALID_FILES", "files must be a bounded array");
  }
  const result = [];
  const seen = new Set();
  for (const entry of files) {
    let path;
    let size = 0;
    if (typeof entry === "string") {
      path = entry;
    } else if (entry !== null && typeof entry === "object") {
      path = entry.path;
      if (entry.size !== undefined) {
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          entry.size > GENERIC_LIMITS.size
        ) {
          fail("INVALID_SIZE", "file size is outside the explicit bound");
        }
        size = entry.size;
      }
    }
    if (typeof path !== "string") fail("INVALID_FILES", "files must contain paths");
    let normalized;
    try {
      normalized = normalizeEvidencePath(path);
    } catch {
      fail("INVALID_PATH", "file path is not a normalized repository-relative POSIX path");
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ path: normalized, size });
  }
  return result.toSorted((left, right) => compareAscii(left.path, right.path));
}

// Keep the file-metric matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation) when a repository holds files with
// very long extensions. The key embeds a deterministically truncated
// extension; the full extension is preserved in observation details so
// truncation is disclosed without data loss.
function boundedFileMetricKey(extension) {
  const key = `file-metric:${extension || "no-extension"}`;
  return key.length > GENERIC_LIMITS.matchedKey ? key.slice(0, GENERIC_LIMITS.matchedKey) : key;
}

function extensionMetrics(files) {
  const counts = new Map();
  for (const { path, size } of files) {
    const extension = extensionOf(path);
    const entry = counts.get(extension) ?? { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += size;
    counts.set(extension, entry);
  }
  return [...counts.entries()]
    .map(([extension, { count, bytes }]) => ({
      extension,
      count,
      bytes,
      matchedKey: boundedFileMetricKey(extension),
    }))
    .toSorted((left, right) => compareAscii(left.matchedKey, right.matchedKey));
}

function presentArtifact(files, name) {
  const hit = files.find(({ path }) => basenameOf(path) === name);
  return hit ? hit.path : null;
}

/**
 * Build artifact-only provider results for an unknown-language repository.
 *
 * @param {object} input - `{ languages, ecosystems, manifestEcosystems, files }`.
 *   `files` is a bounded array of repository-relative paths or
 *   `{ path, size }` records. When no unknown language is present the result
 *   envelope has an empty `results` array (the generic provider does not fire
 *   for the five built-in ecosystems).
 * @returns {{ results: object[], capped: boolean }} A deep-frozen bounded
 *   result envelope. `results` holds deep-frozen provider results with
 *   metadata/path observations only; `capped` is true when file_metric
 *   observations exceeded GENERIC_LIMITS.maxObservations and were
 *   deterministically truncated (the measurement-universe record is kept
 *   first) rather than raising an array-limit error. Invalid inputs fail with
 *   `GenericProviderError`.
 */
export function genericProviderResults({
  languages = [],
  ecosystems = [],
  manifestEcosystems = [],
  files = [],
} = {}) {
  if (!isUnknownLanguageEcosystem({ languages, ecosystems, manifestEcosystems })) {
    return deepFreeze({ results: [], capped: false });
  }
  const normalized = normalizeFiles(files);
  if (normalized.length === 0) return deepFreeze({ results: [], capped: false });

  const results = [];

  const fileMetrics = extensionMetrics(normalized);
  const directoryCount = new Set(normalized.map(({ path }) => directoryOf(path))).size;
  const totalBytes = normalized.reduce((sum, { size }) => sum + size, 0);
  let capped = false;
  if (fileMetrics.length > 0) {
    const observations = [
      {
        category: "measurement_universe",
        path: null,
        matchedKey: "measurement-universe",
        details: {
          filesInspected: normalized.length,
          bytesInspected: totalBytes,
          directoryCount,
        },
        sourceKind: "file_metadata",
      },
      ...fileMetrics.map(({ extension, count, bytes, matchedKey: key }) => ({
        category: "file_metric",
        path: null,
        matchedKey: key,
        details: { extension, count, bytes },
        sourceKind: "file_metadata",
      })),
    ];
    if (observations.length > GENERIC_LIMITS.maxObservations) {
      observations.length = GENERIC_LIMITS.maxObservations;
      capped = true;
    }
    results.push(
      createProviderResult({
        providerId: GENERIC_PROVIDER_ID,
        dimensionId: "DIM-maintainability-v1",
        observations,
      }),
    );
  }

  const assuranceObservations = [];
  for (const name of knownManifests()) {
    const path = presentArtifact(normalized, name);
    if (path !== null) {
      assuranceObservations.push({
        category: "manifest",
        path,
        matchedKey: `manifest:${name}`,
        details: { name },
        sourceKind: "manifest",
      });
    }
  }
  for (const name of knownLockfiles()) {
    const path = presentArtifact(normalized, name);
    if (path !== null) {
      assuranceObservations.push({
        category: "lock",
        path,
        matchedKey: `lock:${name}`,
        details: { name },
        sourceKind: "lockfile",
      });
    }
  }
  if (assuranceObservations.length > 0) {
    results.push(
      createProviderResult({
        providerId: GENERIC_PROVIDER_ID,
        dimensionId: "DIM-assurance-v1",
        observations: assuranceObservations,
      }),
    );
  }

  const documentationObservations = [];
  for (const [category, names] of Object.entries(KNOWN_DOC_ARTIFACTS)) {
    for (const name of names) {
      const path = presentArtifact(normalized, name);
      if (path !== null) {
        documentationObservations.push({
          category,
          path,
          matchedKey: `${category}:${name}`,
          details: { name },
          sourceKind: "documentation",
        });
      }
    }
  }
  if (documentationObservations.length > 0) {
    results.push(
      createProviderResult({
        providerId: GENERIC_PROVIDER_ID,
        dimensionId: "DIM-documentation-v1",
        observations: documentationObservations,
      }),
    );
  }

  return deepFreeze({ results, capped });
}
