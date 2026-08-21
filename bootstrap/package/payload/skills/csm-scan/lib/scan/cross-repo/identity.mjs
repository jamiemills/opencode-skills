// Cross-repository identity synthesis — privacy-safe repository identities.
//
// T221 owns this module. It normalizes explicit scan IDs, sanitized exact VCS
// coordinates (credentials and fragments stripped), ecosystem-normalized
// package coordinates, component roots, and workspace/IaC/contract/event
// coordinate declarations into immutable repository and component identities.
// It is INERT: exported as deep-frozen data plus pure factory functions for
// tests and the future global synthesis stage (T222-T224), never wired into
// the pipeline, CLI, enrich, validate, write, or renderer.
//
// Guarantees:
//   - VCS coordinates are sanitized: schemes, ports, credentials, fragments,
//     queries, and `.git` suffixes are stripped; only exact
//     `host/namespace/repo` coordinates survive. Local and absolute filesystem
//     coordinates are rejected.
//   - Package coordinates are ecosystem-normalized (aliases such as `node`/
//     `javascript`/`typescript` → `npm`) into canonical `pkg:<ecosystem>/<name>`
//     (or `...@<version>`) form; version ranges and unsafe names are dropped.
//   - Component roots are normalized repository-relative POSIX paths.
//   - Duplicate identities (same scan id or same canonical repository id)
//     produce unresolved records that never enter the identity table.
//   - Missing/invalid scan ids produce unresolved `missing_identity` records.
//   - Every emitted coordinate and record passes the T206 privacy gate
//     (`assertPrivacySafe`): emails, absolute paths, credentials, owner
//     identities, and personal names are rejected, never redacted later.
//   - All outputs are deep-frozen and deterministically sorted.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the T202 evidence
// contract and the T206 privacy primitive and never touches node:fs /
// node:child_process / node:process / node:vm / node:module, so the recurring
// capability gate remains closed.

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
} from "../contracts/evidence.mjs";
import { assertPrivacySafe } from "../shared/privacy.mjs";

export const CROSS_REPO_SCHEMA_VERSION = 1;

export const IDENTITY_LIMITS = deepFreeze({
  componentRoots: 1024,
  coordinates: 256,
  coordinateLength: 256,
  identities: 4096,
  manifests: 1024,
  repositories: 2048,
  tokens: 256,
  value: 512,
});

export const REFERENCE_KINDS = Object.freeze([
  "vcs",
  "workspace",
  "path",
  "iac",
  "contract",
  "event",
]);

const COORDINATE_DIMENSIONS = Object.freeze([...REFERENCE_KINDS, "package"]);

const SAFE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const SAFE_TOKEN = /^[A-Za-z0-9@][A-Za-z0-9._:@/+%*-]*$/;
const PURL = /^pkg:[A-Za-z0-9.+-]+\/[A-Za-z0-9._~@+%/-]+(?:@[A-Za-z0-9._~+%-]+)?$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+%-]*$/;
const ECOSYSTEM_NORMALIZATION = Object.freeze({
  js: "npm",
  javascript: "npm",
  node: "npm",
  ts: "npm",
  typescript: "npm",
  python: "pypi",
  pip: "pypi",
  rust: "cargo",
  go: "go",
  gomod: "go",
  java: "maven",
  mvn: "maven",
  gem: "rubygems",
  ruby: "rubygems",
  dotnet: "nuget",
  nuget: "nuget",
});

export class CrossRepoError extends TypeError {
  constructor(code, message) {
    super(`Invalid cross-repository input: ${message}`);
    this.name = "CrossRepoError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CrossRepoError(code, message);
}

function privacySafe(value) {
  try {
    assertPrivacySafe(value);
    return true;
  } catch {
    return false;
  }
}

const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function safeToken(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= IDENTITY_LIMITS.coordinateLength &&
    SAFE_TOKEN.test(value) &&
    !EMAIL_LIKE.test(value)
  );
}

function safeScanId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= IDENTITY_LIMITS.coordinateLength &&
    SAFE_TOKEN.test(value) &&
    privacySafe(value)
  );
}

function safeUntaggedToken(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= IDENTITY_LIMITS.coordinateLength &&
    SAFE_TOKEN.test(value)
  );
}

function boundedArray(value) {
  return Array.isArray(value) ? value : [];
}

function coordinate(prefix, value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const candidate = `${prefix}:${value}`;
  if (candidate.length > IDENTITY_LIMITS.coordinateLength || !privacySafe(candidate)) return null;
  return candidate;
}

/**
 * Normalize a repository-relative POSIX path (leading `./` stripped, absolute
 * paths and traversal rejected). Pure and deterministic.
 * @param {unknown} value
 * @returns {string|null} normalized path or null when unsafe/invalid.
 */
export function normalizePath(value) {
  if (typeof value !== "string") return null;
  let candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 255) return null;
  if (candidate.startsWith("./")) candidate = candidate.slice(2);
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    /^[A-Za-z]:/.test(candidate)
  ) {
    return null;
  }
  try {
    return normalizeEvidencePath(candidate);
  } catch {
    return null;
  }
}

function stripPort(value) {
  return value.replace(/^([^/:]+):\d+(?=\/|$)/, "$1");
}

function vcsParts(value) {
  const parts = value.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const host = parts[0].split(":")[0].toLowerCase();
  if (!SAFE_HOST.test(host)) return null;
  const repo = parts[parts.length - 1].replace(/\.git$/i, "");
  const namespace = parts.slice(1, -1).join("/");
  if (repo.length === 0 || namespace.length === 0) return null;
  if (!safeUntaggedToken(namespace) || !safeUntaggedToken(repo)) return null;
  return { host, namespace, repo };
}

/**
 * Parse and sanitize a raw VCS coordinate (URL or scp-style remote) into a
 * structured `{ host, namespace, repo }` record. Credentials, schemes, ports,
 * fragments, queries, and `.git` suffixes are stripped; local and absolute
 * filesystem coordinates are rejected.
 * @param {unknown} value
 * @returns {{ host: string, namespace: string, repo: string }|null}
 */
export function normalizeVcsCoordinates(value) {
  if (typeof value !== "string") return null;
  let raw = value.trim();
  if (raw.length === 0 || raw.length > IDENTITY_LIMITS.value) return null;
  if (/[\s\0]/.test(raw)) return null;
  const fragment = raw.search(/[?#]/);
  if (fragment >= 0) raw = raw.slice(0, fragment);
  if (raw.length === 0 || /^(?:\.{0,2}\/|~|\\|\/|[A-Za-z]:[\\/])/.test(raw)) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i)[1].toLowerCase();
    if (scheme === "file" || !["git", "http", "https", "ssh"].includes(scheme)) return null;
    let rest = raw.slice(raw.indexOf("://") + 3);
    const at = rest.indexOf("@");
    if (at >= 0) rest = rest.slice(at + 1);
    return vcsParts(stripPort(rest));
  }

  // scp-style remote (git@host:path or host:path) or bare host/path.
  let rest = raw.replace(/^[^@/:]+@/, "");
  if (rest.includes("://")) return null;
  const colon = rest.indexOf(":");
  const slash = rest.indexOf("/");
  if (colon >= 0 && (slash < 0 || colon < slash)) {
    const after = rest.slice(colon + 1);
    if (after.length === 0 || /^\d+$/.test(after)) return null;
    rest = `${rest.slice(0, colon)}/${after}`;
  }
  return vcsParts(stripPort(rest));
}

/**
 * Canonical scheme-agnostic VCS coordinate string (`vcs:<host>/<namespace>/<repo>`).
 * Identical repositories reached via different transports produce the same
 * coordinate, so exact cross-format references still resolve.
 * @param {{ host: string, namespace: string, repo: string }} vcs
 * @returns {string|null}
 */
export function vcsCoordinate(vcs) {
  if (vcs === null || typeof vcs !== "object" || Array.isArray(vcs)) return null;
  if (
    typeof vcs.host !== "string" ||
    typeof vcs.namespace !== "string" ||
    typeof vcs.repo !== "string"
  ) {
    return null;
  }
  return coordinate("vcs", `${vcs.host}/${vcs.namespace}/${vcs.repo}`);
}

function normalizeEcosystem(ecosystem) {
  if (typeof ecosystem !== "string") return null;
  const raw = ecosystem.trim().toLowerCase();
  if (raw.length === 0 || raw.length > 64 || /[^a-z0-9+.-]/.test(raw)) return null;
  return ECOSYSTEM_NORMALIZATION[raw] ?? raw;
}

/**
 * Normalize one package manifest into a canonical ecosystem-normalized purl
 * coordinate (`package:pkg:<ecosystem>/<name>[@<version>]`). Version ranges and
 * unsafe names are dropped rather than emitted.
 * @param {object} manifest - `{ ecosystem, name, version? }`.
 * @returns {string|null}
 */
export function normalizePackageCoordinate(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const type = normalizeEcosystem(manifest.ecosystem);
  if (type === null || typeof manifest.name !== "string") return null;
  const name = manifest.name.trim();
  if (!safeUntaggedToken(name) || name.length > IDENTITY_LIMITS.coordinateLength) return null;
  let suffix = "";
  if (typeof manifest.version === "string") {
    const version = manifest.version.trim();
    if (VERSION_PATTERN.test(version) && version.length <= 128) suffix = `@${version}`;
  }
  const purl = `pkg:${type}/${name}${suffix}`;
  if (!PURL.test(purl) || !privacySafe(purl)) return null;
  return coordinate("package", purl);
}

export function normalizePackageCoordinates(manifests) {
  const coords = new Set();
  for (const manifest of boundedArray(manifests).slice(0, IDENTITY_LIMITS.manifests)) {
    const normalized = normalizePackageCoordinate(manifest);
    if (normalized !== null) coords.add(normalized);
  }
  return deepFreeze([...coords].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.coordinates));
}

export function normalizeComponentRoots(roots) {
  const seen = new Set();
  for (const root of boundedArray(roots).slice(0, IDENTITY_LIMITS.componentRoots)) {
    const normalized = normalizePath(root);
    if (normalized !== null) seen.add(normalized);
  }
  return deepFreeze([...seen].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.componentRoots));
}

export function normalizeTokens(values) {
  const seen = new Set();
  for (const value of boundedArray(values).slice(0, IDENTITY_LIMITS.tokens)) {
    if (safeToken(value)) seen.add(value);
  }
  return deepFreeze([...seen].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.coordinates));
}

function tokenValue(value) {
  return safeToken(value) ? value : null;
}

/**
 * Normalize an IaC module source value into a canonical `iac:` coordinate.
 * Schemes, credentials, queries, and `.git` suffixes are stripped; local and
 * absolute module sources are rejected.
 * @param {unknown} value
 * @returns {string|null} the full `iac:<normalized>` coordinate.
 */
export function normalizeIacCoordinate(value) {
  const normalized = normalizeIacValue(value);
  return normalized === null ? null : coordinate("iac", normalized);
}

function normalizeIacValue(value) {
  if (typeof value !== "string") return null;
  let raw = value.trim();
  if (raw.length === 0 || raw.length > IDENTITY_LIMITS.value) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = raw.slice(raw.indexOf("://") + 3);
  raw = raw.replace(/^[^@/:]+@/, "");
  const query = raw.indexOf("?");
  if (query >= 0) raw = raw.slice(0, query);
  if (raw.length === 0 || /^(?:\.{0,2}\/|~|\\|\/|[A-Za-z]:[\\/])/.test(raw)) return null;
  raw = raw.replace(/\.git$/, "");
  if (!safeUntaggedToken(raw)) return null;
  return raw;
}

function coordinateList(prefix, values, normalizeEntry) {
  const out = new Set();
  for (const value of boundedArray(values).slice(0, IDENTITY_LIMITS.tokens)) {
    const normalized = normalizeEntry(value);
    if (normalized === null) continue;
    const candidate = coordinate(prefix, normalized);
    if (candidate !== null) out.add(candidate);
  }
  return deepFreeze([...out].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.coordinates));
}

function emptyCoordinates() {
  return deepFreeze(
    Object.fromEntries(COORDINATE_DIMENSIONS.map((dimension) => [dimension, deepFreeze([])])),
  );
}

/**
 * Normalize one repository identity declaration into an immutable identity
 * record. The record is `resolved` when the declaration is complete and unique
 * at this stage; duplicate detection happens in `synthesizeRepositoryIdentities`.
 * @param {object} input
 * @returns {object} deep-frozen identity record.
 */
export function normalizeRepositoryIdentity(input) {
  try {
    assertDataOnly(input, CrossRepoError, {
      maxArray: IDENTITY_LIMITS.manifests + IDENTITY_LIMITS.componentRoots + 8,
      maxDepth: 4,
      maxNodes: 32768,
      maxObjectKeys: 16,
      maxString: IDENTITY_LIMITS.value,
    });
  } catch (error) {
    if (error instanceof CrossRepoError) throw error;
    fail("INVALID_DATA", "repository identity must contain plain bounded data");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_TYPE", "repository identity must be an object");
  }

  const scanId = safeScanId(input.scanId) ? input.scanId : null;
  if (scanId === null) {
    return deepFreeze({
      kind: "repository",
      scanId: null,
      repositoryId: null,
      vcs: null,
      packageCoordinates: deepFreeze([]),
      componentRoots: deepFreeze([]),
      coordinates: emptyCoordinates(),
      status: "unresolved",
      reason: "missing_identity",
    });
  }

  const vcs = normalizeVcsCoordinates(input.vcs);
  const vcsCoord = vcs === null ? null : vcsCoordinate(vcs);
  const repositoryId = vcsCoord === null ? `scan:${scanId}` : vcsCoord;

  const componentRoots = normalizeComponentRoots(input.componentRoots);
  const rootSet = new Set(componentRoots);

  const manifests = boundedArray(input.manifests).slice(0, IDENTITY_LIMITS.manifests);
  const byRoot = new Map();
  const repoPackages = [];
  for (const manifest of manifests) {
    const normalized = normalizePackageCoordinate(manifest);
    if (normalized === null) continue;
    const root =
      manifest === null || typeof manifest !== "object" ? null : normalizePath(manifest.root);
    if (root !== null && rootSet.has(root)) {
      const list = byRoot.get(root) ?? [];
      list.push(normalized);
      byRoot.set(root, list);
    } else {
      repoPackages.push(normalized);
    }
  }

  const claimedWorkspaces = new Set();
  for (const [root, purls] of byRoot) {
    const names = [];
    for (const manifest of manifests) {
      if (manifest === null || typeof manifest !== "object") continue;
      if (normalizePath(manifest.root) !== root) continue;
      if (typeof manifest.name === "string" && safeToken(manifest.name)) names.push(manifest.name);
    }
    byRoot.set(root, { purls, names });
  }
  for (const entry of byRoot.values()) {
    for (const name of entry.names) claimedWorkspaces.add(name);
  }

  const workspaceNames = normalizeTokens(input.workspaceNames).filter(
    (entry) => !claimedWorkspaces.has(entry),
  );

  const coordinates = {
    vcs: vcsCoord === null ? deepFreeze([]) : deepFreeze([vcsCoord]),
    workspace: coordinateList("workspace", workspaceNames, tokenValue),
    path: deepFreeze([]),
    iac: coordinateList("iac", input.iac, normalizeIacValue),
    contract: coordinateList("contract", input.contracts, tokenValue),
    event: coordinateList("event", input.events, tokenValue),
    package: deepFreeze(
      [...repoPackages].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.coordinates),
    ),
  };

  const record = {
    kind: "repository",
    scanId,
    repositoryId,
    vcs,
    packageCoordinates: coordinates.package,
    componentRoots,
    workspaceCoordinates: coordinates.workspace,
    coordinates,
    status: "resolved",
    reason: null,
  };
  assertPrivacySafe(record);
  return deepFreeze(record);
}

/**
 * Build a resolved repository identity and its component identities from an
 * already-normalized repository record and its source manifests.
 * @param {object} repo - a resolved repository identity record.
 * @param {object[]} manifests - raw manifest declarations (with `root`).
 * @returns {{ repo: object, components: object[] }}
 */
function buildResolved(repo, manifests) {
  const byRoot = new Map();
  for (const manifest of boundedArray(manifests).slice(0, IDENTITY_LIMITS.manifests)) {
    if (manifest === null || typeof manifest !== "object") continue;
    const normalized = normalizePackageCoordinate(manifest);
    const root = normalizePath(manifest.root);
    if (normalized === null || root === null || !repo.componentRoots.includes(root)) continue;
    const entry = byRoot.get(root) ?? { purls: [], names: [] };
    entry.purls.push(normalized);
    if (typeof manifest.name === "string" && safeToken(manifest.name))
      entry.names.push(manifest.name);
    byRoot.set(root, entry);
  }

  const components = [];
  for (const root of repo.componentRoots) {
    const entry = byRoot.get(root);
    const component = {
      kind: "component",
      id: coordinate("component", `${repo.repositoryId}:${root}`),
      scanId: repo.scanId,
      repositoryId: repo.repositoryId,
      root,
      coordinates: {
        vcs: deepFreeze([]),
        workspace: coordinateList("workspace", entry?.names ?? [], tokenValue),
        path: deepFreeze([coordinate("path", root)]),
        iac: deepFreeze([]),
        contract: deepFreeze([]),
        event: deepFreeze([]),
        package: deepFreeze(
          [...(entry?.purls ?? [])].toSorted(compareAscii).slice(0, IDENTITY_LIMITS.coordinates),
        ),
      },
    };
    assertPrivacySafe(component);
    components.push(deepFreeze(component));
  }
  return { repo, components };
}

function unresolvedRecord(record, reason) {
  const unresolved = {
    kind: "repository",
    scanId: record.scanId,
    repositoryId: record.repositoryId,
    vcs: record.vcs ?? null,
    status: "unresolved",
    reason,
  };
  assertPrivacySafe(unresolved);
  return deepFreeze(unresolved);
}

function unresolvedSortKey(record) {
  return `${record.scanId ?? ""}\0${record.repositoryId ?? ""}`;
}

/**
 * Synthesize the resolved identity table plus unresolved records from a list
 * of repository identity declarations. Duplicate scan ids and duplicate
 * canonical repository ids become unresolved records and never enter the
 * table; missing scan ids become unresolved `missing_identity` records.
 * @param {object[]} inputs - repository identity declarations.
 * @returns {{ repositories: object[], components: object[], unresolved: object[] }}
 *   A deep-frozen identity table.
 */
export function synthesizeRepositoryIdentities(inputs) {
  if (!Array.isArray(inputs)) fail("INVALID_TYPE", "repository identities must be an array");
  if (inputs.length > IDENTITY_LIMITS.identities) {
    fail("BOUND_EXCEEDED", "repository identity count exceeds the bound");
  }

  const normalized = inputs.map(normalizeRepositoryIdentity);
  const byScan = new Map();
  const byRepo = new Map();
  const flagged = new Set();

  for (const record of normalized) {
    if (record.status === "unresolved") continue;
    const scanList = byScan.get(record.scanId) ?? [];
    scanList.push(record);
    byScan.set(record.scanId, scanList);
    const repoList = byRepo.get(record.repositoryId) ?? [];
    repoList.push(record);
    byRepo.set(record.repositoryId, repoList);
  }

  const unresolved = [];
  for (const list of byScan.values()) {
    if (list.length > 1) {
      for (const record of list) flagged.add(record);
    }
  }
  for (const list of byRepo.values()) {
    if (list.length > 1) {
      for (const record of list) flagged.add(record);
    }
  }

  const repositories = [];
  const components = [];
  for (const record of normalized) {
    if (record.status === "unresolved") {
      unresolved.push(record);
      continue;
    }
    if (flagged.has(record)) {
      const reason =
        byScan.get(record.scanId).length > 1 ? "duplicate_scan_id" : "duplicate_identity";
      unresolved.push(unresolvedRecord(record, reason));
      continue;
    }
    const { repo, components: built } = buildResolved(
      record,
      inputs[normalized.indexOf(record)].manifests,
    );
    repositories.push(repo);
    components.push(...built);
  }

  repositories.sort((left, right) => compareAscii(left.repositoryId, right.repositoryId));
  components.sort((left, right) => compareAscii(left.id, right.id));
  unresolved.sort((left, right) => compareAscii(unresolvedSortKey(left), unresolvedSortKey(right)));

  return deepFreeze({
    repositories: deepFreeze(repositories),
    components: deepFreeze(components),
    unresolved: deepFreeze(unresolved),
  });
}
