// Deployment Topology scanner.
//
// T213 owns this module. It orchestrates the literal static extractors over
// bounded artifact reads (T206 readArtifacts) and produces a deep-frozen,
// privacy-safe repository topology with a T202-compatible search space.
//
// Per-artifact atomicity: an artifact that is unreadable, unsupported,
// malformed, privacy-violating, or over a declared cap becomes a diagnostic
// without erasing the results of valid peer artifacts. Cross-artifact
// resolution happens only in mergeTopology and only for explicit references.
//
// No Docker/Helm/Terraform/Kubernetes/cloud execution, no network. ESM only.
// Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only shared primitives and
// the deployment model/extractors; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module.

import {
  deepFreeze,
  normalizeEvidencePath,
  normalizeSearchSpace,
} from "../../contracts/evidence.mjs";
import { readArtifacts } from "../../shared/artifacts.mjs";
import { assertPrivacySafe, PrivacyError } from "../../shared/privacy.mjs";
import {
  DEPLOYMENT_LIMITS,
  DeploymentModelError,
  createArtifactResult,
  mergeTopology,
} from "./model.mjs";
import {
  detectDeploymentKind,
  discoverDeploymentArtifacts,
  extractArtifact,
} from "./extractor.mjs";

function requestOf(entry) {
  if (typeof entry === "string") return { path: entry, format: "text", sensitivity: "internal" };
  if (entry !== null && typeof entry === "object" && typeof entry.path === "string") {
    return {
      path: entry.path,
      format: entry.format ?? "text",
      sensitivity: entry.sensitivity ?? "internal",
    };
  }
  throw new DeploymentModelError(
    "INVALID_REQUEST",
    "deployment requests must be paths or request objects",
  );
}

function artifactFailure(path, status, reason) {
  return createArtifactResult({
    path,
    kind: "unsupported",
    status,
    reason,
    lineCount: 0,
    resources: [],
    images: [],
    services: [],
    edges: [],
    stubs: [],
    indicators: [],
    diagnostics: [],
  });
}

/**
 * Derive a deployment-aware search space from per-artifact statuses.
 *
 * The read-level search space only reflects artifact reads; extractor-level
 * outcomes (malformed documents, unsupported candidates, extraction caps, and
 * privacy rejections) fold in here while the read accounting fields
 * (inspected counts and limits) are retained verbatim. Valid peer results are
 * unaffected: status flags are aggregates, never erasures.
 */
function deploymentSearchSpace(artifacts, read) {
  const statuses = new Set(artifacts.map(({ status }) => status));
  const any = (status) => statuses.has(status);
  return normalizeSearchSpace({
    supported: !any("unsupported"),
    readable: !any("unreadable"),
    complete: statuses.size === 0 || (statuses.size === 1 && statuses.has("parsed")),
    capped: any("capped"),
    error: any("unreadable"),
    malformed: any("malformed"),
    ambiguous: false,
    filesInspected: read.filesInspected,
    fileLimit: read.fileLimit,
    bytesInspected: read.bytesInspected,
    byteLimit: read.byteLimit,
    recordsInspected: read.recordsInspected,
    recordLimit: read.recordLimit,
    omittedCount: read.omittedCount,
  });
}

/**
 * Scan deployment artifacts and build a repository-level topology.
 *
 * @param {object} input - `{ root, files, requests, options }`.
 *   `files` is an optional list of repository-relative paths (discovery);
 *   `requests` is an optional list of paths or `{ path, format, sensitivity }`
 *   records. `options` is a `DEPLOYMENT_LIMITS`-shaped bounds object.
 * @returns {object} A deep-frozen `{ artifacts, topology, searchSpace }`
 *   envelope. `artifacts` holds per-artifact results; `topology` is the
 *   aggregated model; `searchSpace` is the T202-compatible search space that
 *   folds extractor-level statuses onto the read accounting fields.
 */
export async function scanDeploymentTopology({
  root,
  files = [],
  requests = [],
  options = DEPLOYMENT_LIMITS,
} = {}) {
  if (typeof root !== "string" || root.length === 0) {
    throw new DeploymentModelError("INVALID_ROOT", "repository root is required");
  }
  const paths = new Map();
  for (const candidate of discoverDeploymentArtifacts(files)) paths.set(candidate, true);
  for (const entry of requests) {
    let normalized;
    try {
      normalized = normalizeEvidencePath(requestOf(entry).path);
    } catch {
      throw new DeploymentModelError("INVALID_PATH", "deployment request path is not normalized");
    }
    paths.set(normalized, true);
  }
  const sorted = [...paths.keys()].toSorted();
  if (sorted.length > options.maxArtifacts) {
    throw new DeploymentModelError(
      "ARTIFACT_LIMIT",
      "deployment artifact count exceeds the declared cap",
    );
  }
  const artifactRequests = sorted.map((path) => ({
    path,
    format: "text",
    sensitivity: "internal",
  }));
  const read = await readArtifacts(root, artifactRequests, {
    maxBytes: options.maxBytes,
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
    maxRecords: options.maxRecords,
  });
  const artifacts = [];
  for (const result of read.results) {
    if (result.status !== "read") {
      artifacts.push(artifactFailure(result.path, result.status, result.status));
      continue;
    }
    const kind = detectDeploymentKind(result.path, result.value);
    if (kind === "unknown") {
      artifacts.push(artifactFailure(result.path, "unsupported", "NO_EXTRACTOR"));
      continue;
    }
    try {
      const raw = extractArtifact(kind, result.value, result.path);
      assertPrivacySafe(raw);
      artifacts.push(createArtifactResult(raw));
    } catch (error) {
      if (error instanceof PrivacyError) {
        artifacts.push(artifactFailure(result.path, "unverified", "privacy"));
      } else if (error instanceof DeploymentModelError) {
        artifacts.push(artifactFailure(result.path, "capped", error.code));
      } else {
        artifacts.push(artifactFailure(result.path, "malformed", "PARSE_UNSUPPORTED"));
      }
    }
  }
  const topology = mergeTopology(artifacts, options);
  const searchSpace = deploymentSearchSpace(artifacts, read.searchSpace);
  // The topology IS the pipeline's `findings` payload, so the search space is
  // embedded in it: partially-unsupported scans (mixed supported/unsupported
  // manifests) must reach the claim grader as incomplete, never as a fully
  // complete search (F-020). The envelope-level `searchSpace` is retained for
  // direct callers.
  return deepFreeze({
    artifacts,
    topology: deepFreeze({ ...topology, searchSpace }),
    searchSpace,
  });
}
