// Deployment Topology provider.
//
// T213 owns this module. It adapts a repository-level deployment topology into
// immutable T210 provider results for `DIM-deployment-v1` using the canonical
// DIM-deployment categories: image, resource, service, template_indicator,
// and topology_edge. It is inert: exported as a pure factory for tests and the
// future provider catalog (T220); nothing in the pipeline, CLI, enrich,
// validate, write, or renderer consumes it.
//
// Guarantees:
//   - Observations are validated against `PROVIDER_CATEGORIES` (T202/T210);
//     unknown or cross-dimension categories are rejected by the foundation.
//   - Observations are deduplicated, deterministically sorted, and capped at
//     the provider observation bound; a cap is disclosed through `capped`.
//   - Results are deep-frozen and data-only.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only contracts and the
// provider foundation; it never touches node:fs / node:child_process /
// node:process / node:vm / node:module.

import { compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { createProviderResult, PROVIDER_RESULT_LIMITS } from './base.mjs';

export const DEPLOYMENT_PROVIDER_ID = 'PRV-deployment-topology-v1';

const SOURCE_KIND_BY_ARTIFACT = Object.freeze({
  cloudformation: 'infrastructure',
  compose: 'config',
  dockerfile: 'container',
  helm_chart: 'infrastructure',
  helm_template: 'infrastructure',
  kubernetes: 'infrastructure',
  serverless: 'config',
  terraform: 'infrastructure',
});

export class DeploymentProviderError extends TypeError {
  constructor(code, message) {
    super(`Deployment provider failed: ${message}`);
    this.name = 'DeploymentProviderError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeploymentProviderError(code, message);
}

function sourceKindFor(topology, path) {
  const kind = topology?.artifactsByPath?.[path];
  return SOURCE_KIND_BY_ARTIFACT[kind] ?? 'infrastructure';
}

function boundedKey(value) {
  return value.length > 96 ? value.slice(0, 96) : value;
}

// Keep every assembled matchedKey within the provider foundation's 128-char
// bound (base.mjs matchedKey validation). Segment-wise boundedKey alone cannot
// guarantee this for multi-segment keys such as topology edges, so the full
// assembled key is deterministically final-truncated. Full values stay
// available in observation details, so truncation is disclosed without data
// loss and never aborts activation on realistic inputs.
function boundedAssembledKey(value) {
  return value.length > 128 ? value.slice(0, 128) : value;
}

function observation(identity, value) {
  return { identity, value };
}

/**
 * Build immutable deployment provider results from a repository topology.
 *
 * @param {object} input - `{ topology }`, a deep-frozen model topology from
 *   the deployment scanner (or the model `mergeTopology` output).
 * @returns {{ results: object[], capped: boolean }} A deep-frozen bounded
 *   envelope. `results` holds zero or one deep-frozen provider result for
 *   `DIM-deployment-v1`; `capped` is true when observations exceeded the
 *   provider observation bound and were deterministically truncated.
 */
export function deploymentProviderResults({ topology }) {
  if (topology === null || typeof topology !== 'object' || Array.isArray(topology)) {
    fail('INVALID_INPUT', 'topology is required');
  }
  const observations = [];
  const seen = new Set();

  const push = (entry) => {
    const identity = entry.identity;
    if (seen.has(identity)) return;
    seen.add(identity);
    observations.push(entry.value);
  };

  for (const image of topology.images) {
    push(observation(`image:${image.path}:${image.reference}`, {
      category: 'image',
      path: image.path,
      matchedKey: boundedAssembledKey(`image:${boundedKey(image.reference)}`),
      details: { reference: image.reference, scope: image.scope, line: image.line },
      sourceKind: sourceKindFor(topology, image.path),
    }));
  }
  for (const resource of topology.resources) {
    push(observation(`resource:${resource.path}:${resource.id}`, {
      category: 'resource',
      path: resource.path,
      matchedKey: boundedAssembledKey(`resource:${boundedKey(resource.id)}`),
      details: { id: resource.id, kind: resource.kind, label: resource.label },
      sourceKind: sourceKindFor(topology, resource.path),
    }));
  }
  for (const service of topology.services) {
    push(observation(`service:${service.path}:${service.id}`, {
      category: 'service',
      path: service.path,
      matchedKey: boundedAssembledKey(`service:${boundedKey(service.id)}`),
      details: { id: service.id, kind: service.kind, label: service.label, image: service.image },
      sourceKind: sourceKindFor(topology, service.path),
    }));
  }
  for (const edge of topology.edges) {
    push(observation(`edge:${edge.path}:${edge.from}:${edge.to}:${edge.kind}`, {
      category: 'topology_edge',
      path: edge.path,
      matchedKey: boundedAssembledKey(`edge:${boundedKey(edge.from)}:${boundedKey(edge.to)}:${edge.kind}`),
      details: { from: edge.from, to: edge.to, kind: edge.kind, crossArtifact: edge.crossArtifact },
      sourceKind: sourceKindFor(topology, edge.path),
    }));
  }

  const indicatorCounts = new Map();
  for (const indicator of topology.indicators) {
    indicatorCounts.set(indicator.kind, (indicatorCounts.get(indicator.kind) ?? 0) + 1);
  }
  for (const [kind, count] of [...indicatorCounts.entries()].sort(([left], [right]) => compareAscii(left, right))) {
    push(observation(`indicator:${kind}`, {
      category: 'template_indicator',
      path: null,
      matchedKey: `indicator:${kind}`,
      details: { kind, count },
      sourceKind: 'infrastructure',
    }));
  }

  let capped = false;
  const maximum = PROVIDER_RESULT_LIMITS.observations;
  if (observations.length > maximum) {
    observations.length = maximum;
    capped = true;
  }

  const results = observations.length > 0
    ? [createProviderResult({
      providerId: DEPLOYMENT_PROVIDER_ID,
      dimensionId: 'DIM-deployment-v1',
      observations,
    })]
    : [];

  return deepFreeze({ results, capped });
}
