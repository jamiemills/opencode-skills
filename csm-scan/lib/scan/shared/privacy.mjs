import { isDeepStrictEqual } from 'node:util';

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  EVIDENCE_LIMITS,
  validateEvidenceList,
} from '../contracts/evidence.mjs';

export const PRIVACY_LIMITS = deepFreeze({
  maxDepth: 16,
  maxItems: 4096,
  maxNodes: 20_000,
  maxString: 2048,
});

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const POSIX_ABSOLUTE = /(?:^|[\s"'=(])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%+-]+)*/;
const POSIX_DOUBLE_SLASH = /(?:^|[\s"'=(])\/\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%+-]+)*/;
const WINDOWS_ABSOLUTE = /(?:^|[\s"'=(])[A-Za-z]:[\\/][^\s"'<>]*/;
const UNC_PATH = /(?:^|[\s"'=(])(?:\\\\|\\\\\\\\)[^\\\s]+(?:\\|\\\\)[^\s"'<>]+/;
const SECRET = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:bearer|password|passwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|session)\s*[:=]\s*\S+|\b[a-z][a-z0-9_-]*_token\s*[:=]\s*\S+|\b(?:gh[opusr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b)/i;
const URL_CREDENTIAL = /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/i;
const OWNER_IDENTITY = /(?:^|[\s"'])@[A-Za-z0-9][A-Za-z0-9_-]{1,38}\b/;
const PERSONAL_NAME = /\b[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\b/;
const COMMIT_SUBJECT = /^(?:commit subject|subject):\s*\S/i;
const SENSITIVE_FIELD = /^(?:author|authors|codeowners?|codeFlows?|contact|contacts|credential|credentials|downloadUrl|email|emails|hash|hashes|identity|identities|message|name|owner|rawResult|serialNumber|snippet|subject|token|vcsUrl)$/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+%-]{0,255}$/;
const SAFE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;

export class PrivacyError extends TypeError {
  constructor(code, message) {
    super(`Privacy validation failed: ${message}`);
    this.name = 'PrivacyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PrivacyError(code, message);
}

function boundedData(value, overrides = {}) {
  try {
    assertDataOnly(value, PrivacyError, {
      maxArray: overrides.maxArray ?? PRIVACY_LIMITS.maxItems,
      maxDepth: overrides.maxDepth ?? PRIVACY_LIMITS.maxDepth,
      maxNodes: overrides.maxNodes ?? PRIVACY_LIMITS.maxNodes,
      maxObjectKeys: overrides.maxObjectKeys ?? 256,
      maxString: overrides.maxString ?? PRIVACY_LIMITS.maxString,
    });
  } catch (error) {
    if (error instanceof PrivacyError) throw error;
    fail('INVALID_DATA', 'input must contain plain bounded data');
  }
}

function sensitiveText(value) {
  return EMAIL.test(value) || POSIX_ABSOLUTE.test(value) || POSIX_DOUBLE_SLASH.test(value)
    || WINDOWS_ABSOLUTE.test(value) || UNC_PATH.test(value) || SECRET.test(value) || URL_CREDENTIAL.test(value)
    || OWNER_IDENTITY.test(value) || PERSONAL_NAME.test(value) || COMMIT_SUBJECT.test(value);
}

function sensitiveNonPathText(value) {
  return EMAIL.test(value) || POSIX_DOUBLE_SLASH.test(value) || WINDOWS_ABSOLUTE.test(value)
    || UNC_PATH.test(value) || SECRET.test(value) || URL_CREDENTIAL.test(value) || OWNER_IDENTITY.test(value)
    || PERSONAL_NAME.test(value) || COMMIT_SUBJECT.test(value);
}

function walkStrings(value, visit) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') visit(current);
    else if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (SENSITIVE_FIELD.test(key)) fail('SENSITIVE_FIELD', 'input contains a prohibited sensitive field');
        stack.push(child);
      }
    }
  }
}

export function assertPrivacySafe(value, limits) {
  boundedData(value, limits);
  walkStrings(value, (text) => {
    if (sensitiveText(text)) fail('SENSITIVE_VALUE', 'input contains prohibited sensitive data');
  });
  return value;
}

export function redactText(value) {
  if (typeof value !== 'string' || value.length > PRIVACY_LIMITS.maxString) {
    fail('INVALID_TEXT', 'text must be a bounded string');
  }
  if (!sensitiveText(value)) return value;
  return '[redacted]';
}

export function sanitizeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PRIVACY_LIMITS.maxString) {
    fail('INVALID_URL', 'URL must be a bounded string');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('INVALID_URL', 'URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !SAFE_HOST.test(parsed.hostname)) {
    fail('UNSAFE_URL', 'URL is not safe for output');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const decodedSegments = segments.map((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      fail('UNSAFE_URL', 'URL is not safe for output');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('?') || decoded.includes('#')
        || !SAFE_PATH_SEGMENT.test(segment)) {
      fail('UNSAFE_URL', 'URL is not safe for output');
    }
    return decoded;
  });
  if (sensitiveNonPathText(`/${decodedSegments.join('/')}`)) {
    fail('UNSAFE_URL', 'URL is not safe for output');
  }
  const port = (parsed.protocol === 'http:' && parsed.port === '80')
    || (parsed.protocol === 'https:' && parsed.port === '443') ? '' : parsed.port;
  const authority = `${parsed.hostname.toLowerCase()}${port ? `:${port}` : ''}`;
  return `${parsed.protocol}//${authority}${segments.length ? `/${segments.join('/')}` : '/'}`;
}

function evidencePrivacy(record) {
  for (const field of ['locator', 'matchedKey', 'path']) {
    if (sensitiveText(record[field])) fail('UNSAFE_EVIDENCE', 'evidence contains prohibited sensitive data');
  }
  if (record.details !== null) assertPrivacySafe(record.details);
  return record;
}

export function prepareEvidenceForPersistence(records) {
  let validated;
  try {
    validated = validateEvidenceList(records);
  } catch {
    fail('INVALID_EVIDENCE', 'evidence failed canonical validation');
  }
  for (const record of validated) evidencePrivacy(record);
  return deepFreeze(validated.map((record) => ({ ...record })));
}

export function serializeEvidenceForOutput(records) {
  const safe = prepareEvidenceForPersistence(records);
  const serialized = `${JSON.stringify(safe)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > EVIDENCE_LIMITS.count * 4096) {
    fail('BOUND_EXCEEDED', 'serialized evidence exceeds the output length bound');
  }
  let roundTripped;
  try {
    roundTripped = JSON.parse(serialized);
  } catch {
    fail('MALFORMED', 'serialized evidence is not valid JSON');
  }
  if (!isDeepStrictEqual(roundTripped, safe)) {
    fail('INVALID_SERIALIZATION', 'serialized evidence does not round-trip to the persisted value');
  }
  return serialized;
}

export function createOpaqueOwnerSummary(identities) {
  boundedData(identities, { maxArray: PRIVACY_LIMITS.maxItems, maxDepth: 1, maxNodes: PRIVACY_LIMITS.maxItems + 1 });
  if (!Array.isArray(identities)) fail('INVALID_IDENTITIES', 'identities must be a bounded array');
  const counts = new Map();
  for (const identity of identities) {
    if (typeof identity !== 'string' || identity.length === 0 || identity.length > PRIVACY_LIMITS.maxString) {
      fail('INVALID_IDENTITIES', 'identities must be bounded strings');
    }
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const owners = [...counts.entries()].sort(([left], [right]) => compareAscii(left, right))
    .map(([, count], index) => ({ label: `Owner-${String(index + 1).padStart(3, '0')}`, count }));
  return deepFreeze({ owners, totalIdentities: owners.length, totalAssignments: identities.length });
}

function safeIdentifier(value, label) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value) || sensitiveText(value)) {
    fail('INVALID_IDENTIFIER', `${label} is not a safe identifier`);
  }
  return value;
}

export function projectSarif(value) {
  boundedData(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.runs)) {
    fail('INVALID_SARIF', 'SARIF must contain a bounded runs array');
  }
  if (value.runs.length > PRIVACY_LIMITS.maxItems) fail('BOUND_EXCEEDED', 'SARIF run count exceeds the bound');
  const tools = new Set();
  const rules = new Set();
  let resultCount = 0;
  for (const run of value.runs) {
    if (run === null || typeof run !== 'object' || Array.isArray(run)) fail('INVALID_SARIF', 'SARIF run is invalid');
    const driver = run.tool?.driver;
    if (driver?.name !== undefined) tools.add(safeIdentifier(driver.name, 'SARIF tool'));
    for (const rule of Array.isArray(driver?.rules) ? driver.rules : []) {
      if (rule?.id !== undefined) rules.add(safeIdentifier(rule.id, 'SARIF rule'));
    }
    const results = Array.isArray(run.results) ? run.results : [];
    resultCount += results.length;
    if (resultCount > PRIVACY_LIMITS.maxItems) fail('BOUND_EXCEEDED', 'SARIF result count exceeds the bound');
    for (const result of results) {
      if (result?.ruleId !== undefined) rules.add(safeIdentifier(result.ruleId, 'SARIF rule'));
    }
  }
  const projection = {
    format: 'sarif',
    schemaVersion: value.version === undefined ? null : safeIdentifier(value.version, 'SARIF version'),
    runCount: value.runs.length,
    resultCount,
    tools: [...tools].sort(compareAscii),
    rules: [...rules].sort(compareAscii),
  };
  assertPrivacySafe(projection);
  return deepFreeze(projection);
}

function licenseValues(component) {
  const values = [];
  for (const item of Array.isArray(component?.licenses) ? component.licenses : []) {
    const value = item?.license?.id ?? item?.expression;
    if (value !== undefined) values.push(safeIdentifier(value, 'license'));
  }
  if (typeof component?.licenseConcluded === 'string') values.push(safeIdentifier(component.licenseConcluded, 'license'));
  if (typeof component?.licenseDeclared === 'string') values.push(safeIdentifier(component.licenseDeclared, 'license'));
  return values;
}

function packageCoordinate(component) {
  if (typeof component?.purl === 'string') {
    if (!/^pkg:[A-Za-z0-9.+-]+\/[A-Za-z0-9._~@+%/-]+(?:@[A-Za-z0-9._~+%-]+)?$/.test(component.purl)) {
      fail('INVALID_COORDINATE', 'package coordinate is unsafe');
    }
    return safeIdentifier(component.purl, 'package coordinate');
  }
  if (typeof component?.name !== 'string') return null;
  const name = safeIdentifier(component.name, 'package name');
  const version = component.version ?? component.versionInfo;
  return version === undefined ? name : `${name}@${safeIdentifier(version, 'package version')}`;
}

export function projectSbom(value) {
  boundedData(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SBOM', 'SBOM must be an object');
  const roots = Array.isArray(value.components) ? value.components
    : Array.isArray(value.packages) ? value.packages : [];
  const components = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const component = stack.pop();
    components.push(component);
    if (components.length > PRIVACY_LIMITS.maxItems) fail('BOUND_EXCEEDED', 'SBOM component count exceeds the bound');
    if (Array.isArray(component?.components)) stack.push(...component.components);
  }
  const coordinates = new Set();
  const licenses = new Set();
  for (const component of components) {
    const coordinate = packageCoordinate(component);
    if (coordinate !== null) coordinates.add(coordinate);
    for (const license of licenseValues(component)) licenses.add(license);
  }
  const format = value.bomFormat ?? (Array.isArray(value.packages) ? 'SPDX' : 'CycloneDX');
  const specVersion = value.specVersion ?? value.spdxVersion ?? null;
  const projection = {
    format: safeIdentifier(format, 'SBOM format'),
    specVersion: specVersion === null ? null : safeIdentifier(specVersion, 'SBOM specification version'),
    componentCount: components.length,
    licenses: [...licenses].sort(compareAscii),
    packageCoordinates: [...coordinates].sort(compareAscii),
  };
  assertPrivacySafe(projection);
  return deepFreeze(projection);
}
