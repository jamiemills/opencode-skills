// Deployment Topology data model.
//
// T213 owns this module. It defines the bounded, deterministic, deep-frozen
// model shared by the deployment extractors, the scanner, the provider, and
// the inert renderer. It is pure DATA: no filesystem, network, child-process,
// or executable access.
//
// Model invariants:
//   - Every topology edge cites a declaration: `from` and `to` are canonical
//     ids that resolve to a declared resource or service in the same scan.
//   - Unresolved references are recorded as stubs, never fabricated as
//     resources and never turned into edges.
//   - Every per-artifact record is deep-frozen; the aggregate topology is
//     deep-frozen and deterministically sorted.
//   - Bounded caps apply per artifact (enforced by the extractors through
//     `DeploymentModelError`) and at repository level (mergeTopology
//     truncates deterministically and discloses the truncation).
//   - Field names avoid the privacy-sensitive vocabulary (e.g. `name`,
//     `owner`, `token`, `email`) so records survive the T206 privacy gate.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only shared primitives and
// never touches node:fs / node:child_process / node:process / node:vm /
// node:module.

import { compareAscii, deepFreeze } from '../../contracts/evidence.mjs';
import { ARTIFACT_LIMITS } from '../../shared/artifacts.mjs';

export const DEPLOYMENT_LIMITS = deepFreeze({
  maxArtifacts: 128,
  maxBytes: ARTIFACT_LIMITS.maxBytes,
  maxDepth: 12,
  maxDiagnostics: 128,
  maxEdges: 1024,
  maxFiles: ARTIFACT_LIMITS.maxFiles,
  maxImages: 256,
  maxIndicators: 1024,
  maxLabel: 128,
  maxRecords: ARTIFACT_LIMITS.maxRecords,
  maxResources: 512,
  maxServices: 256,
  maxStubs: 512,
  maxValues: 8,
});

export const DEPLOYMENT_ARTIFACT_KINDS = Object.freeze([
  'cloudformation',
  'compose',
  'dockerfile',
  'helm_chart',
  'helm_template',
  'kubernetes',
  'serverless',
  'terraform',
]);

export const RESOURCE_KINDS = Object.freeze([
  'api',
  'bucket',
  'certificate',
  'chart',
  'cluster_role',
  'cluster_role_binding',
  'cloud_resource',
  'configmap',
  'container',
  'cronjob',
  'daemonset',
  'data_source',
  'database',
  'deployment',
  'dns_record',
  'ec2_instance',
  'endpoints',
  'function',
  'gateway',
  'horizontal_pod_autoscaler',
  'hosted_zone',
  'ingress',
  'job',
  'key',
  'load_balancer',
  'local',
  'log_group',
  'module',
  'namespace',
  'network',
  'network_policy',
  'output',
  'parameter',
  'persistent_volume',
  'pod',
  'policy',
  'provider',
  'pvc',
  'queue',
  'replicaset',
  'replication_controller',
  'repository',
  'role',
  'role_binding',
  'secret',
  'security_group',
  'service',
  'service_account',
  'stage',
  'statefulset',
  'storage',
  'storage_class',
  'subnet',
  'table',
  'target_group',
  'task',
  'terraform',
  'topic',
  'trigger',
  'variable',
  'volume',
  'vpc',
]);

export const EDGE_KINDS = Object.freeze([
  'backend',
  'build_from',
  'configmap',
  'copy_from',
  'data',
  'depends_on',
  'env_from',
  'export',
  'invokes',
  'local',
  'network',
  'output',
  'pvc',
  'reference',
  'resolver',
  'secret',
  'service',
  'value_from',
  'variable',
  'volume',
  'volume_from',
]);

export const INDICATOR_KINDS = Object.freeze([
  'count',
  'dynamic',
  'for_each',
  'heredoc',
  'interpolation',
  'intrinsic',
  'loop',
  'macro',
  'pseudo_parameter',
  'remote_module',
  'resolver',
  'template_function',
  'template_marker',
  'transform',
]);

export const ARTIFACT_STATUSES = Object.freeze([
  'capped',
  'malformed',
  'parsed',
  'unreadable',
  'unsupported',
  'unverified',
]);

export class DeploymentModelError extends TypeError {
  constructor(code, message) {
    super(`Deployment model failed: ${message}`);
    this.name = 'DeploymentModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeploymentModelError(code, message);
}

// The id separator is '@' rather than ':' so that ids such as
// `secret@api-secrets` never resemble secret assignments (which the T206
// privacy gate rejects, e.g. `secret: value` or `token: value`).
export function resourceId(kind, label) {
  return `${kind}@${label}`;
}

export function boundedLabel(value, field = 'label') {
  if (typeof value !== 'string' || value.length === 0 || value.length > DEPLOYMENT_LIMITS.maxLabel
      || /[^\x20-\x7e]/.test(value) || value !== value.trim()) {
    fail('INVALID_LABEL', `${field} must be a bounded trimmed ASCII token`);
  }
  return value;
}

// Inverse of `resourceId`: recover the kind and label of a declared id. Kinds
// are enumerated ASCII tokens that never contain '@', so the first '@' is
// always the separator even when the label itself contains one.
function splitResourceId(id) {
  const separator = id.indexOf('@');
  const kind = separator < 1 ? '' : id.slice(0, separator);
  if (!RESOURCE_KINDS.includes(kind)) {
    fail('INVALID_RECORD', 'resource id must reference a known kind');
  }
  return { kind, label: id.slice(separator + 1) };
}

function boundedInteger(value, maximum, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail('INVALID_LINE', `${field} is outside the explicit bound`);
  }
  return value;
}

function optionalLine(value) {
  if (value === null) return null;
  return boundedInteger(value, 1_000_000, 'line');
}

function optionalBoolean(value, field) {
  if (typeof value !== 'boolean') fail('INVALID_RECORD', `${field} must be boolean`);
  return value;
}

function token(value, maximum, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || /[^\x20-\x7e]/.test(value)) {
    fail('INVALID_RECORD', `${field} must be bounded ASCII`);
  }
  return value;
}

function assertMembers(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('INVALID_RECORD', `${field} is not allowlisted`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function attributes(value) {
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ATTRIBUTES', 'attributes must be a plain object or null');
  }
  const entries = Object.entries(value);
  if (entries.length > DEPLOYMENT_LIMITS.maxValues) {
    fail('ATTRIBUTE_LIMIT', 'attribute count exceeds the bound');
  }
  const result = {};
  for (const [key, entry] of entries) {
    const boundedKey = token(key, 64, 'attribute key');
    if (Array.isArray(entry)) {
      if (entry.length > DEPLOYMENT_LIMITS.maxValues) {
        fail('ATTRIBUTE_LIMIT', 'attribute list exceeds the bound');
      }
      result[boundedKey] = entry.map((item) => scalar(item, 'attribute value'));
    } else {
      result[boundedKey] = scalar(entry, 'attribute value');
    }
  }
  return result;
}

function scalar(value, field) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000) {
      fail('INVALID_ATTRIBUTES', `${field} must be a bounded scalar`);
    }
    return value;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > DEPLOYMENT_LIMITS.maxLabel
      || /[^\x20-\x7e]/.test(value)) {
    fail('INVALID_ATTRIBUTES', `${field} must be a bounded ASCII scalar`);
  }
  return value;
}

function resourceRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'resource must be an object');
  }
  exactKeys(value, ['attributes', 'id', 'kind', 'label', 'line', 'path'], 'resource');
  const kind = assertMembers(value.kind, RESOURCE_KINDS, 'resource kind');
  const label = boundedLabel(value.label);
  const id = value.id;
  if (id !== resourceId(kind, label)) fail('INVALID_RECORD', 'resource id must match kind and label');
  return deepFreeze({
    id,
    kind,
    label,
    path: token(value.path, 255, 'resource path'),
    line: optionalLine(value.line),
    attributes: attributes(value.attributes),
  });
}

function imageRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'image must be an object');
  }
  exactKeys(value, ['line', 'path', 'reference', 'scope'], 'image');
  return deepFreeze({
    reference: boundedLabel(value.reference, 'image reference'),
    scope: assertMembers(value.scope, ['config', 'container', 'from', 'image', 'value'], 'image scope'),
    path: token(value.path, 255, 'image path'),
    line: optionalLine(value.line),
  });
}

function serviceRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'service must be an object');
  }
  exactKeys(value, ['attributes', 'id', 'image', 'kind', 'label', 'line', 'path'], 'service');
  const kind = assertMembers(value.kind, RESOURCE_KINDS, 'service kind');
  const label = boundedLabel(value.label);
  const id = value.id;
  if (id !== resourceId(kind, label)) fail('INVALID_RECORD', 'service id must match kind and label');
  return deepFreeze({
    id,
    kind,
    label,
    image: value.image === null ? null : boundedLabel(value.image, 'service image'),
    path: token(value.path, 255, 'service path'),
    line: optionalLine(value.line),
    attributes: attributes(value.attributes),
  });
}

function edgeRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'edge must be an object');
  }
  exactKeys(value, ['crossArtifact', 'from', 'kind', 'line', 'path', 'to'], 'edge');
  return deepFreeze({
    from: token(value.from, 512, 'edge from'),
    to: token(value.to, 512, 'edge to'),
    kind: assertMembers(value.kind, EDGE_KINDS, 'edge kind'),
    path: token(value.path, 255, 'edge path'),
    line: optionalLine(value.line),
    crossArtifact: optionalBoolean(value.crossArtifact, 'crossArtifact'),
  });
}

function stubRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'stub must be an object');
  }
  exactKeys(value, ['from', 'kind', 'label', 'line', 'path', 'source'], 'stub');
  return deepFreeze({
    kind: assertMembers(value.kind, RESOURCE_KINDS, 'stub kind'),
    label: boundedLabel(value.label),
    from: value.from === null ? null : token(value.from, 512, 'stub from'),
    source: assertMembers(value.source, EDGE_KINDS, 'stub source'),
    path: token(value.path, 255, 'stub path'),
    line: optionalLine(value.line),
  });
}

function indicatorRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'indicator must be an object');
  }
  exactKeys(value, ['kind', 'line', 'path'], 'indicator');
  return deepFreeze({
    kind: assertMembers(value.kind, INDICATOR_KINDS, 'indicator kind'),
    path: token(value.path, 255, 'indicator path'),
    line: optionalLine(value.line),
  });
}

function diagnosticRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', 'diagnostic must be an object');
  }
  exactKeys(value, ['doc', 'path', 'reason', 'status'], 'diagnostic');
  return deepFreeze({
    path: token(value.path, 255, 'diagnostic path'),
    status: assertMembers(value.status, ARTIFACT_STATUSES, 'diagnostic status'),
    reason: token(value.reason, 64, 'diagnostic reason'),
    doc: value.doc === null ? null : boundedInteger(value.doc, 4096, 'diagnostic doc'),
  });
}

function boundedList(value, maximum, field) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('BOUND_EXCEEDED', `${field} exceeds the declared cap`);
  }
  return value;
}

export function createArtifactResult(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('INVALID_RECORD', 'artifact result must be an object');
  }
  exactKeys(raw, [
    'diagnostics', 'edges', 'images', 'indicators', 'kind', 'lineCount', 'path',
    'reason', 'resources', 'services', 'status', 'stubs',
  ], 'artifact result');
  const kind = raw.kind === 'unsupported'
    ? 'unsupported'
    : assertMembers(raw.kind, DEPLOYMENT_ARTIFACT_KINDS, 'artifact kind');
  const status = assertMembers(raw.status, ARTIFACT_STATUSES, 'artifact status');
  return deepFreeze({
    path: token(raw.path, 255, 'artifact path'),
    kind,
    status,
    reason: raw.reason === null ? null : token(raw.reason, 64, 'artifact reason'),
    lineCount: boundedInteger(raw.lineCount, 1_000_000, 'lineCount'),
    resources: boundedList(raw.resources, DEPLOYMENT_LIMITS.maxResources, 'resources').map(resourceRecord),
    images: boundedList(raw.images, DEPLOYMENT_LIMITS.maxImages, 'images').map(imageRecord),
    services: boundedList(raw.services, DEPLOYMENT_LIMITS.maxServices, 'services').map(serviceRecord),
    edges: boundedList(raw.edges, DEPLOYMENT_LIMITS.maxEdges, 'edges').map(edgeRecord),
    stubs: boundedList(raw.stubs, DEPLOYMENT_LIMITS.maxStubs, 'stubs').map(stubRecord),
    indicators: boundedList(raw.indicators, DEPLOYMENT_LIMITS.maxIndicators, 'indicators').map(indicatorRecord),
    diagnostics: boundedList(raw.diagnostics, DEPLOYMENT_LIMITS.maxDiagnostics, 'diagnostics').map(diagnosticRecord),
  });
}

function capList(records, maximum) {
  const capped = records.length > maximum;
  const result = records.slice(0, maximum);
  return { result, capped };
}

/**
 * Aggregate per-artifact results into one repository-level topology.
 *
 * Cross-artifact resolution: a stub whose target id is declared by any parsed
 * artifact in the same scan becomes a topology edge (the reference is explicit
 * and the declaration exists); stubs that still have no declaration remain
 * unresolved references and never become edges.
 *
 * @param {object[]} artifacts - deep-frozen per-artifact results.
 * @param {object} [options] - `DEPLOYMENT_LIMITS` shaped bounds.
 * @returns {object} A deep-frozen repository topology.
 */
export function mergeTopology(artifacts, options = DEPLOYMENT_LIMITS) {
  const declared = new Map();
  const declaredCount = new Map();
  const resources = [];
  const images = [];
  const services = [];
  const artifactEdges = [];
  const stubs = [];
  const indicators = [];
  const diagnostics = [];
  const artifactsByPath = {};
  let artifactsParsed = 0;

  const bump = (id) => {
    declaredCount.set(id, (declaredCount.get(id) ?? 0) + 1);
  };

  for (const artifact of artifacts) {
    for (const diagnostic of artifact.diagnostics) diagnostics.push(diagnostic);
    if (artifact.status !== 'parsed') {
      diagnostics.push({
        path: artifact.path,
        status: artifact.status,
        reason: artifact.reason ?? artifact.status,
        doc: null,
      });
      continue;
    }
    artifactsParsed++;
    artifactsByPath[artifact.path] = artifact.kind;
    for (const record of artifact.resources) {
      if (!declared.has(record.id)) declared.set(record.id, record);
      bump(record.id);
      resources.push(record);
    }
    for (const record of artifact.services) {
      if (!declared.has(record.id)) declared.set(record.id, record);
      bump(record.id);
      services.push(record);
    }
    for (const record of artifact.images) images.push(record);
    for (const record of artifact.edges) artifactEdges.push(record);
    for (const record of artifact.stubs) stubs.push(record);
    for (const record of artifact.indicators) indicators.push(record);
  }

  const edges = [];
  const unresolved = [];
  for (const record of artifactEdges) {
    if (declaredCount.get(record.from) === 1 && declaredCount.get(record.to) === 1) {
      edges.push(record);
    } else {
      const target = splitResourceId(record.to);
      unresolved.push({
        kind: target.kind,
        label: target.label,
        from: record.from,
        source: record.kind,
        path: record.path,
        line: record.line,
      });
    }
  }
  for (const record of stubs) {
    if (record.from === null || declaredCount.get(record.from) !== 1) {
      unresolved.push(record);
      continue;
    }
    let targetId = null;
    if (record.kind === 'cloud_resource') {
      const matches = [...declared.keys()].filter((id) => declared.get(id).label === record.label);
      if (matches.length === 1) targetId = matches[0];
    } else {
      const exactId = resourceId(record.kind, record.label);
      if (declaredCount.get(exactId) === 1) targetId = exactId;
    }
    if (targetId !== null) {
      edges.push({
        from: record.from,
        to: targetId,
        kind: record.source,
        path: record.path,
        line: record.line,
        crossArtifact: true,
      });
    } else {
      unresolved.push(record);
    }
  }

  resources.sort((left, right) => compareAscii(left.id, right.id));
  services.sort((left, right) => compareAscii(left.id, right.id));
  images.sort((left, right) => compareAscii(left.reference, right.reference)
    || compareAscii(left.path, right.path));
  unresolved.sort((left, right) => compareAscii(left.kind, right.kind)
    || compareAscii(left.label, right.label) || compareAscii(left.path, right.path));
  indicators.sort((left, right) => compareAscii(left.kind, right.kind)
    || compareAscii(left.path, right.path) || (left.line ?? 0) - (right.line ?? 0));
  diagnostics.sort((left, right) => compareAscii(left.path, right.path)
    || compareAscii(left.status, right.status) || compareAscii(left.reason, right.reason));

  const seenEdges = new Set();
  const dedupedEdges = [];
  for (const edge of edges) {
    const identity = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.path}`;
    if (seenEdges.has(identity)) continue;
    seenEdges.add(identity);
    dedupedEdges.push(edge);
  }
  dedupedEdges.sort((left, right) => compareAscii(left.from, right.from)
    || compareAscii(left.to, right.to) || compareAscii(left.kind, right.kind)
    || compareAscii(left.path, right.path));
  const crossArtifactEdges = dedupedEdges.filter((edge) => edge.crossArtifact).length;

  const cappedKinds = [];
  let capped = false;
  const apply = (name, list, records, kindLabel) => {
    const { result, capped: hit } = capList(records, list);
    if (hit) {
      capped = true;
      cappedKinds.push(kindLabel);
    }
    return result;
  };

  const bounded = {
    artifacts: artifactsParsed,
    resources: apply('resources', options.maxResources, resources, 'resources'),
    images: apply('images', options.maxImages, images, 'images'),
    services: apply('services', options.maxServices, services, 'services'),
    edges: apply('edges', options.maxEdges, dedupedEdges, 'edges'),
    stubs: apply('stubs', options.maxStubs, unresolved, 'stubs'),
    indicators: apply('indicators', options.maxIndicators, indicators, 'indicators'),
    diagnostics: apply('diagnostics', options.maxDiagnostics, diagnostics, 'diagnostics'),
    crossArtifactEdges,
  };

  return deepFreeze({
    ...bounded,
    artifactsByPath: deepFreeze({ ...artifactsByPath }),
    counts: deepFreeze({
      artifacts: bounded.artifacts,
      resources: bounded.resources.length,
      images: bounded.images.length,
      services: bounded.services.length,
      edges: bounded.edges.length,
      stubs: bounded.stubs.length,
      indicators: bounded.indicators.length,
      diagnostics: bounded.diagnostics.length,
      crossArtifactEdges,
    }),
    capped,
    cappedKinds: cappedKinds.toSorted(compareAscii),
  });
}
