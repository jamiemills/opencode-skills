// Cross-repository edge synthesis — exact reference resolution and global stage.
//
// T221 owns this module. It resolves exact path/VCS/workspace/IaC/contract/
// event references against the T221 identity table into edges ONLY when
// exactly one candidate matches. Zero candidates remain external records;
// multiple candidates remain ambiguous records that are excluded from graph
// metrics. Duplicate identities (already unresolved at identity time) are never
// candidates. It is INERT: exported as deep-frozen data plus pure factory
// functions for tests and the future global synthesis stage (T222-T224), never
// wired into the pipeline, CLI, enrich, validate, write, or renderer.
//
// Guarantees:
//   - A reference resolves to an edge only when exactly one distinct identity
//     candidate matches its normalized coordinate; ambiguity is retained but
//     excluded from graph metrics.
//   - Zero-candidate references become external records; unparseable or
//     owner-unknown references also remain external with a disclosure reason.
//   - Self references resolve to self-edges and are counted separately from
//     cross-repository edges.
//   - Candidate, edge, external, ambiguous, and reference lists are capped and
//     deterministically sorted; truncation is disclosed through `capped`.
//   - Edge identities are deterministic SHA-256 hashes of canonical content,
//     so identical duplicate references collapse to a single edge.
//   - Every emitted record passes the T206 privacy gate (`assertPrivacySafe`).
//   - All outputs are deep-frozen; identical inputs (including reversed input
//     order) produce byte-identical snapshots.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the T202 evidence
// contract, the T206 privacy primitive, and the T221 identity module and never
// touches node:fs / node:child_process / node:process / node:vm / node:module,
// so the recurring capability gate remains closed.

import { createHash } from 'node:crypto';

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  EVIDENCE_SOURCE_KINDS,
} from '../contracts/evidence.mjs';
import { assertPrivacySafe } from '../shared/privacy.mjs';
import {
  CROSS_REPO_SCHEMA_VERSION,
  CrossRepoError,
  IDENTITY_LIMITS,
  normalizeIacCoordinate,
  normalizePath,
  normalizeVcsCoordinates,
  REFERENCE_KINDS,
  safeToken,
  synthesizeRepositoryIdentities,
  vcsCoordinate,
} from './identity.mjs';

export const EDGE_LIMITS = deepFreeze({
  ambiguous: 1024,
  candidates: 16,
  edges: 1024,
  external: 1024,
  references: 4096,
});

const REFERENCE_KEYS = Object.freeze(['kind', 'path', 'scanId', 'sourceKind', 'value']);

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

function boundedArray(value) {
  return Array.isArray(value) ? value : [];
}

function referenceCoordinate(kind, value) {
  let coordinate = null;
  if (kind === 'vcs') {
    const vcs = normalizeVcsCoordinates(value);
    coordinate = vcs === null ? null : vcsCoordinate(vcs);
  } else if (kind === 'path') {
    const path = normalizePath(value);
    coordinate = path === null ? null : `path:${path}`;
  } else if (kind === 'workspace' || kind === 'contract' || kind === 'event') {
    coordinate = safeToken(value) ? `${kind}:${value}` : null;
  } else if (kind === 'iac') {
    coordinate = normalizeIacCoordinate(value);
  }
  return coordinate !== null && privacySafe(coordinate) ? coordinate : null;
}

function normalizeReference(input) {
  try {
    assertDataOnly(input, CrossRepoError, {
      maxArray: 16,
      maxDepth: 3,
      maxNodes: 128,
      maxObjectKeys: 8,
      maxString: IDENTITY_LIMITS.value,
    });
  } catch (error) {
    if (error instanceof CrossRepoError) throw error;
    fail('INVALID_DATA', 'reference must contain plain bounded data');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_TYPE', 'reference must be an object');
  }
  const keys = Object.keys(input).toSorted(compareAscii);
  if (keys.length !== REFERENCE_KEYS.length || keys.some((key, index) => key !== REFERENCE_KEYS[index])) {
    fail('UNKNOWN_FIELD', 'reference fields do not match the schema');
  }
  if (!REFERENCE_KINDS.includes(input.kind)) {
    fail('UNKNOWN_KIND', 'reference kind is not allowlisted');
  }
  if (typeof input.value !== 'string' || input.value.length === 0 || input.value.length > IDENTITY_LIMITS.value) {
    fail('INVALID_VALUE', 'reference value must be a bounded string');
  }
  if (!safeToken(input.scanId)) {
    fail('INVALID_SCAN_ID', 'reference scanId is not a safe token');
  }
  const sourceKind = typeof input.sourceKind === 'string' && EVIDENCE_SOURCE_KINDS.includes(input.sourceKind)
    ? input.sourceKind
    : 'repository_metadata';
  const path = input.path === null || input.path === undefined ? null : normalizePath(input.path);
  return {
    scanId: input.scanId,
    kind: input.kind,
    value: input.value,
    path,
    sourceKind,
    coordinate: referenceCoordinate(input.kind, input.value),
  };
}

function buildCoordinateIndex(repositories, components) {
  const index = new Map();
  const add = (coordinate, candidate) => {
    const list = index.get(coordinate);
    if (list === undefined) {
      index.set(coordinate, [candidate]);
    } else {
      list.push(candidate);
    }
  };
  for (const repo of repositories) {
    const candidate = {
      kind: 'repository',
      id: `repository:${repo.repositoryId}`,
      scanId: repo.scanId,
      repositoryId: repo.repositoryId,
    };
    for (const dimension of REFERENCE_KINDS) {
      for (const coordinate of repo.coordinates[dimension]) add(coordinate, candidate);
    }
  }
  for (const component of components) {
    const candidate = {
      kind: 'component',
      id: component.id,
      scanId: component.scanId,
      repositoryId: component.repositoryId,
    };
    for (const dimension of REFERENCE_KINDS) {
      for (const coordinate of component.coordinates[dimension]) add(coordinate, candidate);
    }
  }
  for (const coordinate of index.keys()) {
    index.set(coordinate, index.get(coordinate).toSorted((left, right) => compareAscii(left.id, right.id)));
  }
  return index;
}

function edgeIdentity(content) {
  const framed = Object.keys(content).toSorted().map((key) => `${key}=${content[key]}`).join('\0');
  return `EDG-v1-${createHash('sha256').update(framed).digest('hex')}`;
}

function referenceSortKey(record) {
  return `${record.scanId ?? ''}\0${record.kind}\0${record.coordinate ?? ''}\0${record.path ?? ''}\0${record.sourceKind ?? ''}`;
}

function compareReference(left, right) {
  return compareAscii(referenceSortKey(left), referenceSortKey(right));
}

/**
 * Resolve declared references against a synthesized identity table into edges,
 * external records, and ambiguous records.
 * @param {object} input - `{ identities, references }`.
 * @returns {{ edges: object[], external: object[], ambiguous: object[], capped: object }}
 *   A deep-frozen resolution result. Ambiguous and unresolved references never
 *   enter `edges` (the graph metric source).
 */
export function resolveReferences({ identities, references } = {}) {
  if (identities === null || typeof identities !== 'object' || Array.isArray(identities)) {
    fail('INVALID_TYPE', 'identities must be an object');
  }
  const repositories = boundedArray(identities.repositories);
  const components = boundedArray(identities.components);
  const byScan = new Map(repositories.map((repo) => [repo.scanId, repo]));
  const index = buildCoordinateIndex(repositories, components);

  const allReferences = boundedArray(references);
  const referencesCapped = allReferences.length > EDGE_LIMITS.references;
  const referenceList = allReferences.slice(0, EDGE_LIMITS.references);

  const edgesByContent = new Map();
  const external = [];
  const ambiguous = [];
  let candidatesCapped = false;

  for (const rawReference of referenceList) {
    const reference = normalizeReference(rawReference);
    const source = byScan.get(reference.scanId);
    if (source === undefined) {
      const record = deepFreeze({
        kind: reference.kind,
        coordinate: reference.coordinate,
        scanId: reference.scanId,
        sourceRepository: null,
        path: reference.path,
        sourceKind: reference.sourceKind,
        reason: 'unknown_owner',
      });
      assertPrivacySafe(record);
      external.push(record);
      continue;
    }
    if (reference.coordinate === null) {
      const record = deepFreeze({
        kind: reference.kind,
        coordinate: null,
        scanId: reference.scanId,
        sourceRepository: source.repositoryId,
        path: reference.path,
        sourceKind: reference.sourceKind,
        reason: 'unparseable',
      });
      assertPrivacySafe(record);
      external.push(record);
      continue;
    }
    const candidates = index.get(reference.coordinate);
    if (candidates === undefined || candidates.length === 0) {
      const record = deepFreeze({
        kind: reference.kind,
        coordinate: reference.coordinate,
        scanId: reference.scanId,
        sourceRepository: source.repositoryId,
        path: reference.path,
        sourceKind: reference.sourceKind,
        reason: 'no_candidates',
      });
      assertPrivacySafe(record);
      external.push(record);
      continue;
    }
    const candidateTotal = candidates.length;
    let selected = candidates;
    if (candidateTotal > EDGE_LIMITS.candidates) {
      candidatesCapped = true;
      selected = candidates.slice(0, EDGE_LIMITS.candidates);
    }
    if (selected.length === 1) {
      const target = selected[0];
      const content = {
        kind: reference.kind,
        coordinate: reference.coordinate,
        sourceScan: reference.scanId,
        sourceRepository: source.repositoryId,
        targetRepository: target.repositoryId,
        targetKind: target.kind,
        targetId: target.id,
        targetScan: target.scanId,
        self: source.repositoryId === target.repositoryId,
      };
      const record = deepFreeze({ id: edgeIdentity(content), ...content });
      assertPrivacySafe(record);
      edgesByContent.set(JSON.stringify(content), record);
    } else {
      const record = deepFreeze({
        kind: reference.kind,
        coordinate: reference.coordinate,
        scanId: reference.scanId,
        sourceRepository: source.repositoryId,
        path: reference.path,
        sourceKind: reference.sourceKind,
        candidates: selected.map((candidate) => candidate.id),
        candidateCount: candidateTotal,
        candidatesCapped: candidateTotal > EDGE_LIMITS.candidates,
      });
      assertPrivacySafe(record);
      ambiguous.push(record);
    }
  }

  const edges = [...edgesByContent.values()].toSorted((left, right) => compareAscii(left.id, right.id));
  const externalSorted = external.toSorted(compareReference);
  const ambiguousSorted = ambiguous.toSorted(compareReference);

  const capped = deepFreeze({
    references: referencesCapped,
    edges: edges.length > EDGE_LIMITS.edges,
    external: externalSorted.length > EDGE_LIMITS.external,
    ambiguous: ambiguousSorted.length > EDGE_LIMITS.ambiguous,
    candidates: candidatesCapped,
  });
  if (capped.edges) edges.length = EDGE_LIMITS.edges;
  if (capped.external) externalSorted.length = EDGE_LIMITS.external;
  if (capped.ambiguous) ambiguousSorted.length = EDGE_LIMITS.ambiguous;

  return deepFreeze({
    edges: deepFreeze(edges),
    external: deepFreeze(externalSorted),
    ambiguous: deepFreeze(ambiguousSorted),
    capped,
  });
}

/**
 * Synthesize the deterministic global cross-repository snapshot from identity
 * declarations and references. Ambiguity and unresolved references never enter
 * the graph metrics.
 * @param {object} input - `{ repositories, references }`.
 * @returns {object} A deep-frozen snapshot
 *   `{ schemaVersion, identityTable, edges, capped, metrics }`.
 */
export function synthesizeCrossRepository(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_TYPE', 'synthesis input must be an object');
  }
  const identities = synthesizeRepositoryIdentities(input.repositories);
  const resolved = resolveReferences({ identities, references: input.references });
  const selfEdges = resolved.edges.filter((edge) => edge.self).length;
  const metrics = deepFreeze({
    repositories: identities.repositories.length,
    components: identities.components.length,
    edges: resolved.edges.length,
    selfEdges,
    crossRepositoryEdges: resolved.edges.length - selfEdges,
    external: resolved.external.length,
    ambiguous: resolved.ambiguous.length,
    unresolved: identities.unresolved.length,
  });
  assertPrivacySafe(metrics);
  return deepFreeze({
    schemaVersion: CROSS_REPO_SCHEMA_VERSION,
    identityTable: identities,
    edges: deepFreeze({
      edges: resolved.edges,
      external: resolved.external,
      ambiguous: resolved.ambiguous,
    }),
    capped: resolved.capped,
    metrics,
  });
}
