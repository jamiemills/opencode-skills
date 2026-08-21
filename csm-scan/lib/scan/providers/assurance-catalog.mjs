// Inert provider catalog for Security, Operations, and the six new dimensions.
//
// T220 owns this module. It adapts the Security and Operations scanner models
// (`lib/scan/deep/security.mjs`, `operations.mjs`) and the already-inert
// per-dimension providers for API, Data, Deployment, Maintainability,
// Governance, and Assurance (`providers/api.mjs`, `data.mjs`,
// `deployment.mjs`, `maintainability.mjs`, `governance.mjs`, `assurance.mjs`)
// into immutable provider results under the T202 provider result contract for
// DIM-security-v1 / DIM-operations-v1 / DIM-api-v1 / DIM-data-v1 /
// DIM-deployment-v1 / DIM-maintainability-v1 / DIM-governance-v1 /
// DIM-assurance-v1. It is inert: exported as deep-frozen data plus pure factory
// functions for tests and future provider catalogs (T222-T224), never wired
// into the pipeline, CLI, enrich, validate, write, or renderer.
//
// Guarantees:
//   - ASSURANCE_CATALOG_PROVIDERS is a validated, deep-frozen, duplicate-free
//     T202 provider registry for the eight built-in provider dimensions plus
//     the generic artifact fallback.
//   - Adapter outputs are pure deterministic functions of the scanner findings;
//     identical findings produce byte-identical observations.
//   - Only categories allowlisted for each dimension are emitted; unknown
//     categories and duplicate observations are rejected by the provider
//     foundation with typed errors.
//   - The generic fallback behavior for unknown languages is preserved:
//     `assuranceCatalogResults` returns artifact-only generic results and never
//     claims built-in security/operations/api/data/deployment/maintainability/
//     governance/assurance semantics for an unknown language.
//   - Plugin observations can contribute but never replace or rewrite built-in
//     findings (T210 `mergeProviderResults` rules: built-in first, plugin
//     observations appended, exact duplicates dropped). When a built-in
//     adapter yields no observations for a dimension but plugin observations
//     exist, a plugin-only provider result is emitted (built-in semantics are
//     never invented). When the generic fallback fires, its `capped` flag is
//     threaded through the envelope so callers can disclose the cap.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only contracts, the provider
// foundation, the generic fallback, and the per-dimension provider adapters; it
// never touches node:fs / node:child_process / node:process / node:vm /
// node:module, so the recurring capability gate remains closed.

import { compareAscii, deepFreeze } from "../contracts/evidence.mjs";
import { validateProviders } from "../contracts/provider.mjs";
import { createProviderResult, mergeProviderResults } from "./base.mjs";
import { ASSURANCE_PROVIDER_ID, assuranceProviderResult } from "./assurance.mjs";
import { API_PROVIDER_ID, apiProviderResult } from "./api.mjs";
import { DATA_PROVIDER_ID, dataProviderResult } from "./data.mjs";
import { DEPLOYMENT_PROVIDER_ID, deploymentProviderResults } from "./deployment.mjs";
import { GOVERNANCE_PROVIDER_ID, governanceProviderResult } from "./governance.mjs";
import { MAINTAINABILITY_PROVIDER_ID, maintainabilityProviderResults } from "./maintainability.mjs";
import {
  GENERIC_PROVIDER_ID,
  genericProviderResults,
  isUnknownLanguageEcosystem,
} from "./generic.mjs";

export const ASSURANCE_CATALOG_VERSION = 1;

export const SECURITY_CATALOG_PROVIDER_ID = "PRV-security-hardening-v1";
export const OPERATIONS_CATALOG_PROVIDER_ID = "PRV-operations-declarations-v1";
export const ASSURANCE_PLUGIN_PROVIDER_ID = "PRV-assurance-plugin-v1";

export const SECURITY_DIMENSION_ID = "DIM-security-v1";
export const OPERATIONS_DIMENSION_ID = "DIM-operations-v1";
export const API_DIMENSION_ID = "DIM-api-v1";
export const DATA_DIMENSION_ID = "DIM-data-v1";
export const DEPLOYMENT_DIMENSION_ID = "DIM-deployment-v1";
export const MAINTAINABILITY_DIMENSION_ID = "DIM-maintainability-v1";
export const GOVERNANCE_DIMENSION_ID = "DIM-governance-v1";
export const ASSURANCE_DIMENSION_ID = "DIM-assurance-v1";

export const ASSURANCE_DIMENSION_IDS = deepFreeze([
  SECURITY_DIMENSION_ID,
  OPERATIONS_DIMENSION_ID,
  API_DIMENSION_ID,
  DATA_DIMENSION_ID,
  DEPLOYMENT_DIMENSION_ID,
  MAINTAINABILITY_DIMENSION_ID,
  GOVERNANCE_DIMENSION_ID,
  ASSURANCE_DIMENSION_ID,
]);

export const ASSURANCE_PROVIDER_IDS = deepFreeze({
  security: SECURITY_CATALOG_PROVIDER_ID,
  operations: OPERATIONS_CATALOG_PROVIDER_ID,
  api: API_PROVIDER_ID,
  data: DATA_PROVIDER_ID,
  deployment: DEPLOYMENT_PROVIDER_ID,
  maintainability: MAINTAINABILITY_PROVIDER_ID,
  governance: GOVERNANCE_PROVIDER_ID,
  assurance: ASSURANCE_PROVIDER_ID,
});

// ---------------------------------------------------------------------------
// T202 provider registry
// ---------------------------------------------------------------------------

const CATALOG_DEFINITIONS = Object.freeze([
  {
    id: SECURITY_CATALOG_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: SECURITY_DIMENSION_ID,
        categories: [
          "authentication",
          "authorization",
          "dependency_lock",
          "secret_pattern",
          "security_tool",
          "validation",
        ],
      },
    ],
  },
  {
    id: OPERATIONS_CATALOG_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: OPERATIONS_DIMENSION_ID,
        categories: [
          "container",
          "deployment_declaration",
          "health_check",
          "monitoring",
          "workflow",
        ],
      },
    ],
  },
  {
    id: API_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: API_DIMENSION_ID,
        categories: ["cli_command", "contract", "event", "public_export", "route", "rpc"],
      },
    ],
  },
  {
    id: DATA_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: DATA_DIMENSION_ID,
        categories: [
          "cache",
          "entity",
          "field",
          "key",
          "migration",
          "queue",
          "relation",
          "schema",
          "store",
        ],
      },
    ],
  },
  {
    id: DEPLOYMENT_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: DEPLOYMENT_DIMENSION_ID,
        categories: ["image", "resource", "service", "template_indicator", "topology_edge"],
      },
    ],
  },
  {
    id: MAINTAINABILITY_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: MAINTAINABILITY_DIMENSION_ID,
        categories: [
          "branch_point",
          "dead_code",
          "duplicate_span",
          "file_metric",
          "generated_boundary",
          "measurement_universe",
          "tool_result",
        ],
      },
    ],
  },
  {
    id: GOVERNANCE_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: GOVERNANCE_DIMENSION_ID,
        categories: [
          "contribution",
          "decision",
          "funding",
          "ownership",
          "policy",
          "reference",
          "release",
          "review",
          "runbook",
          "support",
        ],
      },
    ],
  },
  {
    id: ASSURANCE_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: ASSURANCE_DIMENSION_ID,
        categories: [
          "accessibility",
          "attestation",
          "configuration",
          "license",
          "lock",
          "manifest",
          "pin",
          "sarif",
          "sbom",
          "source",
          "standard",
          "tool_result",
          "vex",
        ],
      },
    ],
  },
  {
    id: GENERIC_PROVIDER_ID,
    apiVersion: ASSURANCE_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: "DIM-maintainability-v1",
        categories: ["file_metric", "measurement_universe"],
      },
      { dimensionId: "DIM-assurance-v1", categories: ["lock", "manifest"] },
      { dimensionId: "DIM-documentation-v1", categories: ["contributing", "license", "readme"] },
    ],
  },
]);

/**
 * Validated, deep-frozen, duplicate-free T202 provider registry. Sorted by
 * provider id; every dimension/category is allowlisted by the provider
 * contract. Deterministic and immutable.
 */
export const ASSURANCE_CATALOG_PROVIDERS = validateProviders(CATALOG_DEFINITIONS);

// ---------------------------------------------------------------------------
// Deterministic matched-key encoding
// ---------------------------------------------------------------------------
// matchedKey must be bounded stable ASCII within the foundation's
// MATCHED_KEY_PATTERN. Free-text scanner values (secret pattern names, CI
// platform labels, monitoring package names) can contain characters outside
// that pattern, so unsafe values are disambiguated by a stable short hash while
// safe values keep their readable form.

const MATCHED_KEY_SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+%()[\],-]*$/;

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function keyFor(prefix, value) {
  const raw = `${prefix}:${value}`;
  if (raw.length <= 128 && MATCHED_KEY_SAFE.test(raw)) return raw;
  return `${prefix}:${stableHash(raw)}`;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0;
}

function plainList(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function plain(value) {
  return plainObject(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Security adapter (DIM-security-v1)
// ---------------------------------------------------------------------------

/**
 * Derive DIM-security-v1 observations from security scanner findings. Pure and
 * deterministic; never throws for foreign input. Only allowlisted categories
 * (authentication, authorization, dependency_lock, secret_pattern,
 * security_tool, validation) are emitted.
 * @param {object} findings - the `findings` object from `security.mjs:scan`.
 * @returns {object[]} provider observations (unsorted).
 */
export function securityCatalogObservations(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return [];
  const observations = [];

  const secrets = plain(findings.secrets);
  for (const finding of plainList(secrets && secrets.findings)) {
    if (finding === null || typeof finding !== "object" || !stringValue(finding.pattern)) continue;
    observations.push({
      category: "secret_pattern",
      path: Array.isArray(finding.files) && stringValue(finding.files[0]) ? finding.files[0] : null,
      matchedKey: keyFor("secret", finding.pattern),
      details: {
        pattern: finding.pattern,
        totalFiles: Number.isSafeInteger(finding.totalFiles) ? finding.totalFiles : 0,
      },
      sourceKind: "search_result",
    });
  }

  const auth = plain(findings.auth);
  for (const framework of plainList(auth && auth.frameworks)) {
    if (framework === null || typeof framework !== "object" || !stringValue(framework.package))
      continue;
    observations.push({
      category: "authentication",
      path: null,
      matchedKey: keyFor("auth", framework.package),
      details: {
        package: framework.package,
        label: stringValue(framework.label) ? framework.label : framework.package,
        type: typeof framework.type === "string" ? framework.type : null,
      },
      sourceKind: "manifest",
    });
  }

  const validation = plain(findings.inputValidation);
  for (const library of plainList(validation && validation.libraries)) {
    if (library === null || typeof library !== "object" || !stringValue(library.package)) continue;
    observations.push({
      category: "validation",
      path: null,
      matchedKey: keyFor("validation", library.package),
      details: {
        package: library.package,
        label: stringValue(library.label) ? library.label : library.package,
      },
      sourceKind: "manifest",
    });
  }

  const rateLimit = plain(findings.rateLimiting);
  for (const library of plainList(rateLimit && rateLimit.libraries)) {
    if (library === null || typeof library !== "object" || !stringValue(library.package)) continue;
    observations.push({
      category: "validation",
      path: null,
      matchedKey: keyFor("rate-limit", library.package),
      details: {
        package: library.package,
        label: stringValue(library.label) ? library.label : library.package,
        control: "rate_limit",
      },
      sourceKind: "manifest",
    });
  }
  if (
    rateLimit !== null &&
    Number.isSafeInteger(rateLimit.codeReferences) &&
    rateLimit.codeReferences > 0
  ) {
    observations.push({
      category: "validation",
      path: null,
      matchedKey: "rate-limit-references",
      details: { codeReferences: rateLimit.codeReferences },
      sourceKind: "search_result",
    });
  }

  if (findings.hasLockfile === true) {
    observations.push({
      category: "dependency_lock",
      path: null,
      matchedKey: "dependency-lock",
      details: { present: true },
      sourceKind: "lockfile",
    });
  }

  for (const tool of plainList(findings.securityTools)) {
    if (!stringValue(tool)) continue;
    observations.push({
      category: "security_tool",
      path: null,
      matchedKey: keyFor("security-tool", tool),
      details: { name: tool },
      sourceKind: tool.startsWith(".") ? "config" : "manifest",
    });
  }

  for (const entry of plainList(findings.auditEvidence)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.tool)) continue;
    observations.push({
      category: "security_tool",
      path: null,
      matchedKey: keyFor(
        "audit-tool",
        `${entry.tool}:${stringValue(entry.source) ? entry.source : ""}:${stringValue(entry.location) ? entry.location : ""}`,
      ),
      details: {
        tool: entry.tool,
        source: stringValue(entry.source) ? entry.source : null,
        location: stringValue(entry.location) ? entry.location : null,
      },
      sourceKind: "tool_result",
    });
  }

  if (findings.dependabot === true) {
    observations.push({
      category: "security_tool",
      path: null,
      matchedKey: "dependabot",
      details: { present: true },
      sourceKind: "config",
    });
  }
  if (findings.envExample === true) {
    observations.push({
      category: "security_tool",
      path: null,
      matchedKey: "env-example",
      details: { present: true },
      sourceKind: "config",
    });
  }
  if (findings.gitignoreEnvProtected === true) {
    observations.push({
      category: "security_tool",
      path: null,
      matchedKey: "gitignore-env",
      details: { present: true },
      sourceKind: "config",
    });
  }

  return observations;
}

/**
 * Build an immutable DIM-security-v1 provider result from security findings.
 * @param {object} findings - security scanner findings.
 * @returns {object|null} deep-frozen provider result, or null when no
 *   observations can be derived.
 */
export function securityCatalogResult(findings) {
  const observations = securityCatalogObservations(findings);
  if (observations.length === 0) return null;
  return createProviderResult({
    providerId: SECURITY_CATALOG_PROVIDER_ID,
    dimensionId: SECURITY_DIMENSION_ID,
    observations,
  });
}

// ---------------------------------------------------------------------------
// Operations adapter (DIM-operations-v1)
// ---------------------------------------------------------------------------

/**
 * Derive DIM-operations-v1 observations from operations scanner findings. Pure
 * and deterministic; never throws for foreign input. Only allowlisted
 * categories (container, deployment_declaration, health_check, monitoring,
 * workflow) are emitted.
 * @param {object} findings - the `findings` object from `operations.mjs:scan`.
 * @returns {object[]} provider observations (unsorted).
 */
export function operationsCatalogObservations(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return [];
  const observations = [];

  for (const dockerfile of plainList(findings.dockerfiles)) {
    if (dockerfile === null || typeof dockerfile !== "object" || !stringValue(dockerfile.name))
      continue;
    observations.push({
      category: "container",
      path: dockerfile.name,
      matchedKey: keyFor("dockerfile", dockerfile.name),
      details: {
        name: dockerfile.name,
        baseImages: plainList(dockerfile.baseImages),
        exposedPorts: plainList(dockerfile.exposedPorts),
        isMultiStage: dockerfile.isMultiStage === true,
        hasHealthcheck: dockerfile.hasHealthcheck === true,
        hasUser: dockerfile.hasUser === true,
        isAlpine: dockerfile.isAlpine === true,
        isSlim: dockerfile.isSlim === true,
        hasEntrypoint: dockerfile.hasEntrypoint === true,
        hasCmd: dockerfile.hasCmd === true,
        lineCount: Number.isSafeInteger(dockerfile.lineCount) ? dockerfile.lineCount : null,
      },
      sourceKind: "container",
    });
  }
  if (findings.hasDockerignore === true) {
    observations.push({
      category: "container",
      path: ".dockerignore",
      matchedKey: "dockerignore",
      details: { present: true },
      sourceKind: "container",
    });
  }

  const compose = plain(findings.dockerCompose);
  for (const entry of plainList(compose && compose.services)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.file)) continue;
    observations.push({
      category: "deployment_declaration",
      path: entry.file,
      matchedKey: keyFor("compose", entry.file),
      details: {
        file: entry.file,
        serviceCount: Number.isSafeInteger(entry.count) ? entry.count : 0,
        services: plainList(entry.names),
      },
      sourceKind: "config",
    });
  }
  if (
    compose !== null &&
    (plainList(compose.networks).length > 0 || plainList(compose.volumes).length > 0)
  ) {
    observations.push({
      category: "deployment_declaration",
      path: null,
      matchedKey: "compose-networks-volumes",
      details: {
        networks: plainList(compose.networks),
        volumes: plainList(compose.volumes),
      },
      sourceKind: "config",
    });
  }

  for (const entry of plainList(findings.ci)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.platform)) continue;
    const details = { platform: entry.platform };
    if (Array.isArray(entry.jobs)) details.jobs = entry.jobs;
    if (Array.isArray(entry.triggers)) details.triggers = entry.triggers;
    if (Array.isArray(entry.stages)) details.stages = entry.stages;
    if (Number.isSafeInteger(entry.workflowCount)) details.workflowCount = entry.workflowCount;
    observations.push({
      category: "workflow",
      path: null,
      matchedKey: keyFor("workflow", entry.platform),
      details,
      sourceKind: "workflow",
    });
  }

  const health = plain(findings.healthChecks);
  if (health !== null && health.detected === true) {
    observations.push({
      category: "health_check",
      path: null,
      matchedKey: "health-check",
      details: {
        detected: true,
        references: plainList(health.references),
      },
      sourceKind: "search_result",
    });
  }
  for (const entry of plainList(findings.gracefulShutdown)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.pattern)) continue;
    observations.push({
      category: "health_check",
      path: null,
      matchedKey: keyFor("shutdown", entry.pattern),
      details: {
        pattern: entry.pattern,
        fileCount: Number.isSafeInteger(entry.fileCount) ? entry.fileCount : 0,
      },
      sourceKind: "search_result",
    });
  }

  const monitoring = plain(findings.monitoring);
  for (const library of plainList(monitoring && monitoring.libraries)) {
    if (library === null || typeof library !== "object" || !stringValue(library.package)) continue;
    observations.push({
      category: "monitoring",
      path: null,
      matchedKey: keyFor("monitoring", library.package),
      details: {
        package: library.package,
        label: stringValue(library.label) ? library.label : library.package,
      },
      sourceKind: "manifest",
    });
  }

  if (findings.hasDeployScripts === true) {
    observations.push({
      category: "deployment_declaration",
      path: null,
      matchedKey: "deploy-scripts",
      details: { present: true },
      sourceKind: "config",
    });
  }
  if (findings.hasMakefile === true) {
    observations.push({
      category: "deployment_declaration",
      path: null,
      matchedKey: "makefile",
      details: { present: true },
      sourceKind: "config",
    });
  }
  if (findings.hasJustfile === true) {
    observations.push({
      category: "deployment_declaration",
      path: null,
      matchedKey: "justfile",
      details: { present: true },
      sourceKind: "config",
    });
  }
  if (findings.procfile !== null && findings.procfile !== undefined) {
    observations.push({
      category: "deployment_declaration",
      path: "Procfile",
      matchedKey: "procfile",
      details: { present: true },
      sourceKind: "config",
    });
  }

  return observations;
}

/**
 * Build an immutable DIM-operations-v1 provider result from operations
 * findings.
 * @param {object} findings - operations scanner findings.
 * @returns {object|null} deep-frozen provider result, or null when no
 *   observations can be derived.
 */
export function operationsCatalogResult(findings) {
  const observations = operationsCatalogObservations(findings);
  if (observations.length === 0) return null;
  return createProviderResult({
    providerId: OPERATIONS_CATALOG_PROVIDER_ID,
    dimensionId: OPERATIONS_DIMENSION_ID,
    observations,
  });
}

// ---------------------------------------------------------------------------
// Per-dimension built-in adapter dispatch
// ---------------------------------------------------------------------------

function builtInEnvelope(dimensionId, models) {
  switch (dimensionId) {
    case SECURITY_DIMENSION_ID: {
      const result = securityCatalogResult(models.security);
      return { results: result ? [result] : [], capped: false };
    }
    case OPERATIONS_DIMENSION_ID: {
      const result = operationsCatalogResult(models.operations);
      return { results: result ? [result] : [], capped: false };
    }
    case API_DIMENSION_ID:
      return {
        results: plainObject(models.api) ? apiProviderResult(models.api) : [],
        capped: false,
      };
    case DATA_DIMENSION_ID:
      return plainObject(models.data)
        ? dataProviderResult(models.data)
        : { results: [], capped: false };
    case DEPLOYMENT_DIMENSION_ID:
      return plainObject(models.deployment)
        ? deploymentProviderResults({ topology: models.deployment })
        : { results: [], capped: false };
    case MAINTAINABILITY_DIMENSION_ID:
      return plainObject(models.maintainability)
        ? maintainabilityProviderResults(models.maintainability)
        : { results: [], capped: false };
    case GOVERNANCE_DIMENSION_ID:
      return {
        results: plainObject(models.governance) ? governanceProviderResult(models.governance) : [],
        capped: false,
      };
    case ASSURANCE_DIMENSION_ID:
      return {
        results: plainObject(models.assurance) ? assuranceProviderResult(models.assurance) : [],
        capped: false,
      };
    default:
      return { results: [], capped: false };
  }
}

// ---------------------------------------------------------------------------
// Plugin declarative observations (T210)
// ---------------------------------------------------------------------------

function boundedKey(value) {
  return value.length > 96 ? value.slice(0, 96) : value;
}

function validPluginMatch(match) {
  return (
    plainObject(match) &&
    stringValue(match.ruleId) &&
    stringValue(match.category) &&
    stringValue(match.path) &&
    ASSURANCE_DIMENSION_IDS.includes(match.dimensionId)
  );
}

/**
 * Convert `rules.mjs` rule matches into provider observations for the eight
 * catalog dimensions. Matches carry only rule identity and the normalized
 * artifact path (never matched content), so the observations inherit the same
 * privacy guarantee. Matches for other dimensions are ignored. Deterministic.
 * @param {object[]} matches - matches from `evaluateRules`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen), grouped by
 *   dimension in canonical order.
 */
export function assurancePluginObservations(matches) {
  const grouped = new Map();
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!validPluginMatch(match)) continue;
    const observations = grouped.get(match.dimensionId) ?? [];
    observations.push({
      category: match.category,
      path: match.path,
      matchedKey: `plugin-rule:${boundedKey(match.ruleId)}`,
      details: {
        ruleId: match.ruleId,
        label: stringValue(match.label) ? match.label : match.ruleId,
      },
      sourceKind: "artifact_metadata",
    });
    grouped.set(match.dimensionId, observations);
  }
  return deepFreeze(
    [...grouped.entries()]
      .toSorted(([left], [right]) => compareAscii(left, right))
      .map(([dimensionId, observations]) => ({ dimensionId, observations })),
  );
}

/**
 * Build an immutable plugin provider result for one dimension. The catalog
 * carrier provider id is used; the merged result keeps the built-in id.
 * @param {string} dimensionId - a provider dimension id.
 * @param {object[]} observations - plugin observations for that dimension.
 * @returns {object} deep-frozen provider result.
 */
export function assurancePluginResult(dimensionId, observations) {
  return createProviderResult({
    providerId: ASSURANCE_PLUGIN_PROVIDER_ID,
    dimensionId,
    observations,
  });
}

/**
 * Build immutable plugin provider results for the eight catalog dimensions.
 * Category validation (and duplicate rejection) is enforced by the provider
 * foundation, so an unallowlisted plugin category fails with a typed error.
 * @param {object} input - `{ matches }`.
 * @returns {object[]} Deep-frozen provider results (possibly empty).
 */
export function assurancePluginProviderResults(input) {
  const matches = plainObject(input) ? input.matches : undefined;
  return deepFreeze(
    assurancePluginObservations(matches).map(({ dimensionId, observations }) =>
      assurancePluginResult(dimensionId, observations),
    ),
  );
}

/**
 * Deterministic merge of a built-in result with plugin observations for the
 * same dimension (T210 rules). Built-in observations always come first; plugin
 * observations are appended and exact duplicates are dropped. Delegates to
 * `mergeProviderResults` unchanged.
 * @param {object} input - `{ builtin, plugin }` provider results.
 * @returns {object} deep-frozen merged provider result.
 */
export function mergeAssurancePlugin({ builtin, plugin }) {
  return mergeProviderResults({ builtin, plugin });
}

// ---------------------------------------------------------------------------
// Assurance catalog orchestration
// ---------------------------------------------------------------------------

/**
 * Build the inert assurance catalog result envelope for a repository. Pure and
 * deterministic; never performs filesystem or network access.
 *
 * @param {object} input
 *   - `security`, `operations`: the security/operations scanner `findings`.
 *   - `api`, `data`, `deployment`, `maintainability`, `governance`,
 *     `assurance`: the per-dimension scanner models (the deep-frozen model
 *     objects produced by the respective scanners).
 *   - `languages`, `ecosystems`, `manifestEcosystems`, `files`: the generic
 *     fallback inputs (see `genericProviderResults`).
 *   - `pluginObservations`: optional `{ [dimensionId]: observations[] }` map
 *     contributed by T210 declarative plugin rules. Plugin observations are
 *     merged per built-in dimension and can never replace built-in findings;
 *     when a built-in adapter yields no observations for a dimension, a
 *     plugin-only provider result is emitted for that dimension.
 * @returns {{ results: object[], capped: boolean, mode: string }} A deep-frozen
 *   envelope. `mode` is `'builtin'` when the eight built-in adapters produced
 *   the results and `'generic'` when an unknown language triggered the
 *   artifact-only generic fallback; `capped` is true when any built-in adapter
 *   truncated its observations at the provider bound, or in generic mode when
 *   the generic provider truncated file_metric observations at its limit.
 */
export function assuranceCatalogResults({
  security,
  operations,
  api,
  data,
  deployment,
  maintainability,
  governance,
  assurance,
  languages = [],
  ecosystems = [],
  manifestEcosystems = [],
  files = [],
  pluginObservations = null,
} = {}) {
  const unknown = isUnknownLanguageEcosystem({ languages, ecosystems, manifestEcosystems });
  if (unknown) {
    const { results, capped } = genericProviderResults({
      languages,
      ecosystems,
      manifestEcosystems,
      files,
    });
    return deepFreeze({ results, capped, mode: "generic" });
  }

  const pluginEntriesFor = (dimensionId) =>
    pluginObservations !== null && pluginObservations !== undefined
      ? pluginObservations[dimensionId]
      : null;

  const results = [];
  let capped = false;
  const models = {
    security,
    operations,
    api,
    data,
    deployment,
    maintainability,
    governance,
    assurance,
  };
  for (const dimensionId of ASSURANCE_DIMENSION_IDS) {
    const envelope = builtInEnvelope(dimensionId, models);
    capped = capped || envelope.capped;
    // Built-in results with zero observations are treated as absent (matching
    // the runtime/analysis catalogs); they are never emitted, and a plugin-only
    // result is emitted instead when plugin observations exist.
    const builtResults = envelope.results.filter((result) => result.observations.length > 0);
    const pluginEntries = pluginEntriesFor(dimensionId);
    const hasPlugin = Array.isArray(pluginEntries) && pluginEntries.length > 0;
    if (builtResults.length === 0) {
      if (hasPlugin) results.push(assurancePluginResult(dimensionId, pluginEntries));
      continue;
    }
    for (const built of builtResults) {
      if (hasPlugin) {
        results.push(
          mergeProviderResults({
            builtin: built,
            plugin: assurancePluginResult(dimensionId, pluginEntries),
          }),
        );
      } else {
        results.push(built);
      }
    }
  }
  results.sort((left, right) => compareAscii(left.dimensionId, right.dimensionId));
  return deepFreeze({ results, capped, mode: "builtin" });
}
