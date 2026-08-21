// Inert runtime provider catalog for the Stack, Config, and Testing dimensions.
//
// T218 owns this module. It adapts the existing stack/config/testing scanner
// models (`lib/scan/deep/stack.mjs`, `config.mjs`, `testing.mjs`) and the T210
// plugin declarative observation pipeline (rule matches merged through the
// provider foundation) into immutable provider results under the T202 provider
// result contract for the DIM-stack-v1 / DIM-config-v1 / DIM-testing-v1
// category allowlists. It is inert: exported as deep-frozen data plus pure
// factory functions for tests and future provider catalogs (T222-T224), never
// wired into the pipeline, CLI, enrich, validate, write, or renderer.
//
// Guarantees:
//   - RUNTIME_CATALOG_PROVIDERS is a validated, deep-frozen, duplicate-free
//     T202 provider registry for the three runtime dimensions plus the generic
//     artifact fallback.
//   - Adapter outputs are pure deterministic functions of the scanner findings;
//     identical findings produce byte-identical observations.
//   - Only categories allowlisted for each dimension are emitted; unknown
//     categories and duplicate observations are rejected by the provider
//     foundation with typed errors.
//   - The generic fallback behavior for unknown languages is preserved:
//     `runtimeCatalogResults` returns artifact-only generic results and never
//     claims built-in stack/config/testing semantics for an unknown language.
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
// foundation, the generic fallback, and the shared descriptor table; it never
// touches node:fs / node:child_process / node:process / node:vm / node:module,
// so the recurring capability gate remains closed.

import { compareAscii, deepFreeze } from "../contracts/evidence.mjs";
import { validateProviders } from "../contracts/provider.mjs";
import { descriptorFor } from "../shared/ecosystem.mjs";
import { createProviderResult, mergeProviderResults } from "./base.mjs";
import {
  GENERIC_PROVIDER_ID,
  genericProviderResults,
  isUnknownLanguageEcosystem,
} from "./generic.mjs";

export const RUNTIME_CATALOG_VERSION = 1;

export const STACK_CATALOG_PROVIDER_ID = "PRV-runtime-stack-v1";
export const CONFIG_CATALOG_PROVIDER_ID = "PRV-runtime-config-v1";
export const TESTING_CATALOG_PROVIDER_ID = "PRV-runtime-testing-v1";
export const RUNTIME_PLUGIN_PROVIDER_ID = "PRV-runtime-plugin-v1";

const STACK_DIMENSION_ID = "DIM-stack-v1";
const CONFIG_DIMENSION_ID = "DIM-config-v1";
const TESTING_DIMENSION_ID = "DIM-testing-v1";

// ---------------------------------------------------------------------------
// T202 provider registry
// ---------------------------------------------------------------------------

const CATALOG_DEFINITIONS = Object.freeze([
  {
    id: STACK_CATALOG_PROVIDER_ID,
    apiVersion: RUNTIME_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: STACK_DIMENSION_ID,
        categories: ["framework", "language", "package_manager", "runtime"],
      },
    ],
  },
  {
    id: CONFIG_CATALOG_PROVIDER_ID,
    apiVersion: RUNTIME_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: CONFIG_DIMENSION_ID,
        categories: ["configuration", "editor", "environment", "format", "lint"],
      },
    ],
  },
  {
    id: TESTING_CATALOG_PROVIDER_ID,
    apiVersion: RUNTIME_CATALOG_VERSION,
    dimensions: [
      {
        dimensionId: TESTING_DIMENSION_ID,
        categories: [
          "configuration",
          "coverage",
          "fixture",
          "framework",
          "test_directory",
          "test_file",
        ],
      },
    ],
  },
  {
    id: GENERIC_PROVIDER_ID,
    apiVersion: RUNTIME_CATALOG_VERSION,
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
export const RUNTIME_CATALOG_PROVIDERS = validateProviders(CATALOG_DEFINITIONS);

// ---------------------------------------------------------------------------
// Deterministic matched-key encoding
// ---------------------------------------------------------------------------
// matchedKey must be bounded stable ASCII within the foundation's
// MATCHED_KEY_PATTERN. Free-text scanner values (glob patterns, coverage
// labels with spaces, version strings) can contain characters outside that
// pattern, so unsafe values are disambiguated by a stable short hash while
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

// ---------------------------------------------------------------------------
// Stack adapter (DIM-stack-v1)
// ---------------------------------------------------------------------------

function runtimeSourceKind(kind) {
  if (kind === "version-file") return "version_file";
  if (kind === "container-image") return "container";
  if (kind === "signal") return "file_metadata";
  return "manifest";
}

/**
 * Derive DIM-stack-v1 observations from stack scanner findings. Pure and
 * deterministic; never throws for foreign input. Only allowlisted categories
 * (framework, language, package_manager, runtime) are emitted.
 * @param {object} findings - the `findings` object from `stack.mjs:scan`.
 * @returns {object[]} provider observations (unsorted).
 */
export function stackCatalogObservations(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return [];
  const observations = [];

  if (stringValue(findings.language)) {
    observations.push({
      category: "language",
      path: null,
      matchedKey: "language",
      details: { name: findings.language },
      sourceKind: "repository_metadata",
    });
  }
  for (const id of plainList(findings.ecosystems)) {
    if (!stringValue(id)) continue;
    const label = descriptorFor(id)?.label ?? id;
    observations.push({
      category: "language",
      path: null,
      matchedKey: keyFor("language", id),
      details: { name: id, label },
      sourceKind: "repository_metadata",
    });
  }
  if (stringValue(findings.runtime)) {
    observations.push({
      category: "runtime",
      path: null,
      matchedKey: "runtime",
      details: { name: findings.runtime },
      sourceKind: "repository_metadata",
    });
  }
  for (const entry of plainList(findings.runtimeDeclarations)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.runtime)) continue;
    observations.push({
      category: "runtime",
      path: null,
      matchedKey: keyFor(
        "runtime-declaration",
        `${entry.runtime}:${entry.kind ?? "declaration"}:${entry.source ?? ""}`,
      ),
      details: {
        runtime: entry.runtime,
        kind: entry.kind ?? null,
        version: entry.version ?? null,
        source: entry.source ?? null,
      },
      sourceKind: runtimeSourceKind(entry.kind),
    });
  }
  for (const [label, display, value] of [
    ["nodejs", "Node.js", findings.nodeVersion],
    ["rust", "Rust", findings.rustVersion],
    ["python", "Python", findings.requiresPython],
  ]) {
    if (value == null) continue;
    observations.push({
      category: "runtime",
      path: null,
      matchedKey: `runtime-pin:${label}`,
      details: { name: display, version: String(value) },
      sourceKind: "version_file",
    });
  }
  if (stringValue(findings.packageManager) && findings.packageManager !== "unknown") {
    observations.push({
      category: "package_manager",
      path: null,
      matchedKey: keyFor("package-manager", findings.packageManager),
      details: { name: findings.packageManager },
      sourceKind: "repository_metadata",
    });
  }
  for (const name of plainList(findings.frameworks)) {
    if (!stringValue(name)) continue;
    observations.push({
      category: "framework",
      path: null,
      matchedKey: keyFor("framework", name),
      details: { name },
      sourceKind: "repository_metadata",
    });
  }
  return observations;
}

/**
 * Build an immutable DIM-stack-v1 provider result from stack findings.
 * @param {object} findings - stack scanner findings.
 * @returns {object|null} deep-frozen provider result, or null when no
 *   observations can be derived.
 */
export function stackCatalogResult(findings) {
  const observations = stackCatalogObservations(findings);
  if (observations.length === 0) return null;
  return createProviderResult({
    providerId: STACK_CATALOG_PROVIDER_ID,
    dimensionId: STACK_DIMENSION_ID,
    observations,
  });
}

// ---------------------------------------------------------------------------
// Config adapter (DIM-config-v1)
// ---------------------------------------------------------------------------

function toolObservations(category, prefix, tools) {
  const observations = [];
  for (const tool of plainList(tools)) {
    if (tool === null || typeof tool !== "object" || !stringValue(tool.name)) continue;
    observations.push({
      category,
      path: null,
      matchedKey: keyFor(prefix, tool.name),
      details: { name: tool.name, config: tool.config ?? null },
      sourceKind: "config",
    });
  }
  return observations;
}

/**
 * Derive DIM-config-v1 observations from config scanner findings. Pure and
 * deterministic; never throws for foreign input. Only allowlisted categories
 * (configuration, editor, environment, format, lint) are emitted.
 * @param {object} findings - the `findings` object from `config.mjs:scan`.
 * @returns {object[]} provider observations (unsorted).
 */
export function configCatalogObservations(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return [];
  const observations = [];

  observations.push(...toolObservations("lint", "lint", findings.linters));
  observations.push(...toolObservations("format", "format", findings.formatters));
  observations.push(...toolObservations("configuration", "type-checker", findings.typeCheckers));
  observations.push(...toolObservations("configuration", "build-tool", findings.buildTools));
  observations.push(...toolObservations("configuration", "runtime", findings.runtimes));

  for (const hook of plainList(findings.hooks)) {
    if (hook === null || typeof hook !== "object" || !stringValue(hook.tool)) continue;
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: keyFor("hook", hook.tool),
      details: { tool: hook.tool, file: hook.file ?? null },
      sourceKind: "config",
    });
  }
  for (const marker of plainList(findings.markers)) {
    if (!stringValue(marker)) continue;
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: keyFor("marker", marker),
      details: { name: marker },
      sourceKind: "config",
    });
  }
  if (findings.lint !== null && typeof findings.lint === "object") {
    observations.push({
      category: "lint",
      path: null,
      matchedKey: "lint:summary",
      details: { style: findings.lint.style ?? null, config: findings.lint.config ?? null },
      sourceKind: "config",
    });
  }
  if (typeof findings.format === "string" && findings.format.length > 0) {
    observations.push({
      category: "format",
      path: null,
      matchedKey: "format:summary",
      details: { name: findings.format },
      sourceKind: "config",
    });
  }
  if (findings.typescript !== null && typeof findings.typescript === "object") {
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: "typescript:summary",
      details: {
        config: findings.typescript.config ?? null,
        strict: findings.typescript.strict ?? false,
        target: findings.typescript.target ?? null,
        moduleResolution: findings.typescript.moduleResolution ?? null,
        module: findings.typescript.module ?? null,
        noImplicitAny: findings.typescript.noImplicitAny ?? false,
        composite: findings.typescript.composite ?? false,
        declaration: findings.typescript.declaration ?? false,
      },
      sourceKind: "config",
    });
  }
  if (findings.ci !== null && typeof findings.ci === "object") {
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: "ci:github-actions",
      details: {
        platform: findings.ci.platform ?? null,
        workflowCount: findings.ci.workflowCount ?? 0,
        jobs: plainList(findings.ci.jobs),
      },
      sourceKind: "workflow",
    });
  }
  for (const file of plainList(findings.docker)) {
    if (!stringValue(file)) continue;
    observations.push({
      category: "environment",
      path: file,
      matchedKey: keyFor("docker", file),
      details: { name: file },
      sourceKind: "container",
    });
  }
  for (const entry of plainList(findings.envVars)) {
    if (entry === null || typeof entry !== "object" || !stringValue(entry.file)) continue;
    observations.push({
      category: "environment",
      path: entry.file,
      matchedKey: keyFor("env", entry.file),
      details: { file: entry.file, varCount: entry.varCount ?? 0 },
      sourceKind: "config",
    });
  }
  return observations;
}

/**
 * Build an immutable DIM-config-v1 provider result from config findings.
 * @param {object} findings - config scanner findings.
 * @returns {object|null} deep-frozen provider result, or null when no
 *   observations can be derived.
 */
export function configCatalogResult(findings) {
  const observations = configCatalogObservations(findings);
  if (observations.length === 0) return null;
  return createProviderResult({
    providerId: CONFIG_CATALOG_PROVIDER_ID,
    dimensionId: CONFIG_DIMENSION_ID,
    observations,
  });
}

// ---------------------------------------------------------------------------
// Testing adapter (DIM-testing-v1)
// ---------------------------------------------------------------------------

/**
 * Derive DIM-testing-v1 observations from testing scanner findings. Pure and
 * deterministic; never throws for foreign input. Only allowlisted categories
 * (configuration, coverage, fixture, framework, test_directory, test_file) are
 * emitted. The `unknown` framework placeholder is never claimed.
 * @param {object} findings - the `findings` object from `testing.mjs:scan`.
 * @returns {object[]} provider observations (unsorted).
 */
export function testingCatalogObservations(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return [];
  const observations = [];

  for (const name of plainList(findings.framework)) {
    if (!stringValue(name) || name === "unknown") continue;
    observations.push({
      category: "framework",
      path: null,
      matchedKey: keyFor("test-framework", name),
      details: { name },
      sourceKind: "repository_metadata",
    });
  }
  for (const dir of plainList(findings.testDirs)) {
    if (!stringValue(dir)) continue;
    observations.push({
      category: "test_directory",
      path: dir,
      matchedKey: keyFor("test-directory", dir),
      details: { path: dir },
      sourceKind: "repository_metadata",
    });
  }
  for (const file of plainList(findings.sampleFiles)) {
    if (!stringValue(file)) continue;
    observations.push({
      category: "test_file",
      path: file,
      matchedKey: keyFor("test-file", file),
      details: { path: file },
      sourceKind: "source",
    });
  }
  if (Number.isSafeInteger(findings.fileCount) && findings.fileCount >= 0) {
    observations.push({
      category: "test_file",
      path: null,
      matchedKey: "test-file-count",
      details: { fileCount: findings.fileCount },
      sourceKind: "repository_metadata",
    });
  }
  const naming = plainList(findings.naming);
  naming.forEach((glob, index) => {
    if (!stringValue(glob)) return;
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: keyFor("test-naming", `${index}:${glob}`),
      details: { name: glob },
      sourceKind: "repository_metadata",
    });
  });
  const configFiles = plainList(findings.configFiles);
  configFiles.forEach((entry, index) => {
    if (!stringValue(entry)) return;
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: keyFor("test-config", `${index}:${entry}`),
      details: { name: entry },
      sourceKind: "config",
    });
  });
  const coverage = plainList(findings.coverage);
  coverage.forEach((name, index) => {
    if (!stringValue(name)) return;
    observations.push({
      category: "coverage",
      path: null,
      matchedKey: keyFor("coverage", `${index}:${name}`),
      details: { name },
      sourceKind: "config",
    });
  });
  if (typeof findings.script === "string" && findings.script.length > 0) {
    observations.push({
      category: "configuration",
      path: null,
      matchedKey: "test-script",
      details: { script: findings.script },
      sourceKind: "config",
    });
  }
  return observations;
}

/**
 * Build an immutable DIM-testing-v1 provider result from testing findings.
 * @param {object} findings - testing scanner findings.
 * @returns {object|null} deep-frozen provider result, or null when no
 *   observations can be derived.
 */
export function testingCatalogResult(findings) {
  const observations = testingCatalogObservations(findings);
  if (observations.length === 0) return null;
  return createProviderResult({
    providerId: TESTING_CATALOG_PROVIDER_ID,
    dimensionId: TESTING_DIMENSION_ID,
    observations,
  });
}

// ---------------------------------------------------------------------------
// Plugin declarative observations (T210)
// ---------------------------------------------------------------------------

/**
 * Convert `rules.mjs` rule matches into provider observations. Matches carry
 * only rule identity and the normalized artifact path (never matched content),
 * so the observations inherit the same privacy guarantee. Deterministic.
 * @param {object[]} matches - matches from `evaluateRules`.
 * @returns {object[]} provider observations (unsorted).
 */
export function pluginObservationsFromMatches(matches) {
  const observations = [];
  for (const match of plainList(matches)) {
    if (match === null || typeof match !== "object") continue;
    if (
      !stringValue(match.ruleId) ||
      !stringValue(match.category) ||
      !stringValue(match.dimensionId)
    ) {
      continue;
    }
    observations.push({
      category: match.category,
      path: stringValue(match.path) ? match.path : null,
      matchedKey: keyFor("plugin-rule", match.ruleId),
      details: { ruleId: match.ruleId, label: match.label ?? null },
      sourceKind: "artifact_metadata",
    });
  }
  return observations;
}

/**
 * Build an immutable plugin provider result for one dimension. The catalog
 * carrier provider id is used; the merged result keeps the built-in id.
 * @param {string} dimensionId - a provider dimension id.
 * @param {object[]} observations - plugin observations for that dimension.
 * @returns {object} deep-frozen provider result.
 */
export function pluginResultFromObservations(dimensionId, observations) {
  return createProviderResult({
    providerId: RUNTIME_PLUGIN_PROVIDER_ID,
    dimensionId,
    observations,
  });
}

/**
 * Deterministic merge of a built-in result with plugin observations for the
 * same dimension (T210 rules). Built-in observations always come first; plugin
 * observations are appended and exact duplicates are dropped. Delegates to
 * `mergeProviderResults` unchanged.
 * @param {object} input - `{ builtin, plugin }` provider results.
 * @returns {object} deep-frozen merged provider result.
 */
export function mergeRuntimePlugin({ builtin, plugin }) {
  return mergeProviderResults({ builtin, plugin });
}

// ---------------------------------------------------------------------------
// Runtime catalog orchestration
// ---------------------------------------------------------------------------

/**
 * Build the inert runtime catalog result envelope for a repository. Pure and
 * deterministic; never performs filesystem or network access.
 *
 * @param {object} input
 *   - `stack`, `config`, `testing`: the scanner `findings` objects.
 *   - `languages`, `ecosystems`, `manifestEcosystems`, `files`: the generic
 *     fallback inputs (see `genericProviderResults`).
 *   - `pluginObservations`: optional `{ [dimensionId]: observations[] }` map
 *     contributed by T210 declarative plugin rules. Plugin observations are
 *     merged per built-in dimension and can never replace built-in findings;
 *     when a built-in adapter yields no observations for a dimension, a
 *     plugin-only provider result is emitted for that dimension.
 * @returns {{ results: object[], capped: boolean, mode: string }} A deep-frozen
 *   envelope. `mode` is `'builtin'` when the three built-in adapters produced
 *   the results and `'generic'` when an unknown language triggered the
 *   artifact-only generic fallback; `capped` is true only in generic mode when
 *   the generic provider truncated file_metric observations at its limit.
 */
export function runtimeCatalogResults({
  stack,
  config,
  testing,
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
  const dimensions = [
    [STACK_DIMENSION_ID, stackCatalogResult(stack)],
    [CONFIG_DIMENSION_ID, configCatalogResult(config)],
    [TESTING_DIMENSION_ID, testingCatalogResult(testing)],
  ];
  for (const [dimensionId, builtin] of dimensions) {
    const pluginEntries = pluginEntriesFor(dimensionId);
    const hasPlugin = Array.isArray(pluginEntries) && pluginEntries.length > 0;
    if (builtin === null) {
      if (hasPlugin) results.push(pluginResultFromObservations(dimensionId, pluginEntries));
      continue;
    }
    if (hasPlugin) {
      const plugin = pluginResultFromObservations(dimensionId, pluginEntries);
      results.push(mergeProviderResults({ builtin, plugin }));
      continue;
    }
    results.push(builtin);
  }
  results.sort((left, right) => compareAscii(left.dimensionId, right.dimensionId));
  return deepFreeze({ results, capped: false, mode: "builtin" });
}
