// Maintainability dimension — T210-compatible provider.
//
// T214 owns this module. It maps the maintainability model
// (`lib/scan/deep/maintainability/model.mjs`) into immutable provider results
// through the provider foundation (`lib/scan/providers/base.mjs`), using ONLY
// the DIM-maintainability-v1 category allowlist (branch_point, duplicate_span,
// file_metric, generated_boundary, measurement_universe, tool_result). It is
// inert: exported as factory functions for tests and future provider catalogs
// (T218-T220), never wired into the pipeline, CLI, enrich, validate, write, or
// renderer.
//
// Guarantees:
//   - Every observation references admissible evidence: `path` is the
//     repo-relative declaration file (or null for repository-level records)
//     and `matchedKey` is a deterministic category-prefixed canonical key.
//   - Observations are deterministic and deep-frozen via `createProviderResult`;
//     unknown or cross-dimension categories are rejected by the foundation.
//   - Observations exceeding the provider bound are truncated
//     deterministically and the truncation is disclosed through `capped`.
//   - `maintainabilityProviderResults` never throws for a valid model and
//     produces an empty result list for empty or foreign input.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the provider foundation
// and the maintainability model; it never touches node:fs /
// node:child_process / node:process / node:vm / node:module, so the recurring
// capability gate remains closed.

import { deepFreeze } from "../contracts/evidence.mjs";
import { createProviderResult, PROVIDER_RESULT_LIMITS } from "./base.mjs";
import { MAINTAINABILITY_DIMENSION_ID } from "../deep/maintainability/model.mjs";

export const MAINTAINABILITY_PROVIDER_ID = "PRV-maintainability-v1";

export class MaintainabilityProviderError extends TypeError {
  constructor(code, message) {
    super(`Maintainability provider failed: ${message}`);
    this.name = "MaintainabilityProviderError";
    this.code = code;
  }
}

function boundedKey(value) {
  return value.length > 96 ? value.slice(0, 96) : value;
}

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). Segment-wise boundedKey alone cannot
// guarantee this for multi-segment keys such as tool or duplicate entries, so
// the full assembled key is deterministically final-truncated. Full values
// stay available in observation details, so truncation is disclosed without
// data loss and never aborts activation on realistic inputs.
function boundedAssembledKey(value) {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function observation(identity, value) {
  return { identity, value };
}

/**
 * Derive provider observations from a maintainability model. Pure and
 * deterministic.
 * @param {object} model - the deep-frozen maintainability model from
 *   `buildMaintainabilityModel`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen); empty for
 *   empty or foreign input.
 */
export function maintainabilityObservations(model) {
  if (model === null || typeof model !== "object" || Array.isArray(model)) return [];
  const observations = [];
  const seen = new Set();

  const push = (entry) => {
    if (seen.has(entry.identity)) return;
    seen.add(entry.identity);
    observations.push(entry.value);
  };

  for (const file of Array.isArray(model.files) ? model.files : []) {
    push(
      observation(`file:${file.path}`, {
        category: "file_metric",
        path: file.path,
        matchedKey: boundedAssembledKey(`file-metric:${boundedKey(file.path)}`),
        details: {
          dialect: file.dialect,
          bytes: file.bytes,
          lines: file.lines,
          tokens: file.tokens,
          sizeBucket: file.sizeBucket,
        },
        sourceKind: "source",
      }),
    );
  }
  for (const branch of Array.isArray(model.branchPoints) ? model.branchPoints : []) {
    push(
      observation(`branch:${branch.path}`, {
        category: "branch_point",
        path: branch.path,
        matchedKey: boundedAssembledKey(`branch-point:${boundedKey(branch.path)}`),
        details: {
          dialect: branch.dialect,
          tokens: branch.tokens,
          counts: branch.counts,
          capped: branch.capped,
        },
        sourceKind: "source",
      }),
    );
  }
  for (const group of Array.isArray(model.duplicateGroups) ? model.duplicateGroups : []) {
    for (const span of group.spans) {
      push(
        observation(`duplicate:${group.id}:${span.path}:${span.startLine}`, {
          category: "duplicate_span",
          path: span.path,
          matchedKey: boundedAssembledKey(`duplicate:${group.id}:${span.startLine}`),
          details: {
            groupId: group.id,
            tokenCount: span.tokenCount,
            startLine: span.startLine,
            endLine: span.endLine,
          },
          sourceKind: "source",
        }),
      );
    }
  }
  for (const boundary of Array.isArray(model.generatedBoundaries)
    ? model.generatedBoundaries
    : []) {
    push(
      observation(`generated:${boundary.path}:${boundary.reason}`, {
        category: "generated_boundary",
        path: boundary.path,
        matchedKey: boundedAssembledKey(
          `generated:${boundedKey(boundary.path)}:${boundary.reason}`,
        ),
        details: {
          reason: boundary.reason,
          marker: boundary.marker,
          source: boundary.source,
          line: boundary.line,
        },
        sourceKind: "source",
      }),
    );
  }
  for (const tool of Array.isArray(model.toolEvidence) ? model.toolEvidence : []) {
    push(
      observation(`tool:${tool.tool}:${tool.file}`, {
        category: "tool_result",
        path: tool.file,
        matchedKey: boundedAssembledKey(`tool:${boundedKey(tool.tool)}:${boundedKey(tool.file)}`),
        details: {
          tool: tool.tool,
          kind: tool.kind,
          line: tool.line,
          source: tool.source,
        },
        sourceKind: "config",
      }),
    );
  }

  const universe = model.measurementUniverse;
  if (universe !== null && typeof universe === "object") {
    push(
      observation("universe:measurement", {
        category: "measurement_universe",
        path: null,
        matchedKey: "universe:measurement",
        details: {
          filesInspected: universe.filesInspected,
          bytesInspected: universe.bytesInspected,
          recordsInspected: universe.recordsInspected,
          measuredFiles: universe.measuredFiles,
          eligibleFiles: universe.eligibleFiles,
          omittedCount: universe.omittedCount,
          configFilesInspected: universe.configFilesInspected,
          supportedDialects: universe.supportedDialects,
          excludedLanguages: Object.fromEntries(
            (Array.isArray(universe.excludedLanguages) ? universe.excludedLanguages : []).map(
              (entry) => [entry.extension, entry.count],
            ),
          ),
          excludedFiles: universe.excludedFiles,
          capped: universe.capped,
          partialCoverage: universe.partialCoverage,
          sizeDistribution: Object.fromEntries(
            (Array.isArray(universe.sizeDistribution) ? universe.sizeDistribution : []).map(
              (entry) => [entry.bucket, entry.count],
            ),
          ),
        },
        sourceKind: "repository_metadata",
      }),
    );
  }

  return deepFreeze([{ dimensionId: MAINTAINABILITY_DIMENSION_ID, observations }]);
}

/**
 * Build immutable provider results from a maintainability model. Inert.
 * @param {object} model - the deep-frozen maintainability model.
 * @returns {object} `{ results, capped }` (deep-frozen) where `results` holds
 *   zero or one deep-frozen provider result for `DIM-maintainability-v1` and
 *   `capped` discloses truncation at the provider observation bound.
 */
export function maintainabilityProviderResults(model) {
  const groups = maintainabilityObservations(model);
  if (groups.length === 0) return deepFreeze({ results: [], capped: false });
  const observations = groups[0].observations;
  let capped = false;
  const maximum = PROVIDER_RESULT_LIMITS.observations;
  if (observations.length > maximum) {
    observations.length = maximum;
    capped = true;
  }
  const results =
    observations.length > 0
      ? [
          createProviderResult({
            providerId: MAINTAINABILITY_PROVIDER_ID,
            dimensionId: MAINTAINABILITY_DIMENSION_ID,
            observations,
          }),
        ]
      : [];
  return deepFreeze({ results, capped });
}
