import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  assertDataOnly,
  compareAscii,
  deepFreeze,
  normalizeEvidencePath,
  normalizeSearchSpace,
} from '../contracts/evidence.mjs';

export const ARTIFACT_SENSITIVITY = Object.freeze(['public', 'internal', 'restricted']);
export const ARTIFACT_FORMATS = Object.freeze(['json', 'text']);
export const ARTIFACT_LIMITS = deepFreeze({
  maxFiles: 256,
  maxBytes: 4 * 1024 * 1024,
  maxRecords: 10_000,
  maxDepth: 12,
});

const REFERENCE_KEYS = Object.freeze(['path', 'sensitivity']);
const REQUEST_KEYS = Object.freeze(['format', 'path', 'sensitivity']);
const OPTION_KEYS = Object.freeze(['maxBytes', 'maxDepth', 'maxFiles', 'maxRecords']);
const MAX_REQUESTS = 4096;

export class ArtifactError extends TypeError {
  constructor(code, message) {
    super(`Artifact operation failed: ${message}`);
    this.name = 'ArtifactError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArtifactError(code, message);
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).toSorted(compareAscii);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('UNKNOWN_FIELD', `${label} fields do not match the schema`);
  }
}

function plainObject(value, expected, label) {
  try {
    assertDataOnly(value, ArtifactError, {
      maxArray: ARTIFACT_LIMITS.maxFiles,
      maxDepth: ARTIFACT_LIMITS.maxDepth,
      maxNodes: ARTIFACT_LIMITS.maxFiles * 8,
      maxObjectKeys: 8,
      maxString: 512,
    });
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    fail('INVALID_DATA', `${label} must contain plain bounded data`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', `${label} must be an object`);
  }
  exactKeys(value, expected, label);
}

function sensitivity(value) {
  if (!ARTIFACT_SENSITIVITY.includes(value)) {
    fail('INVALID_SENSITIVITY', 'sensitivity is not registered');
  }
  return value;
}

function reference(value, request = false) {
  plainObject(value, request ? REQUEST_KEYS : REFERENCE_KEYS, request ? 'artifact request' : 'artifact reference');
  let path;
  try {
    path = normalizeEvidencePath(value.path);
  } catch {
    fail('INVALID_PATH', 'artifact path is not a normalized repository-relative POSIX path');
  }
  if (path === '.') fail('INVALID_PATH', 'artifact path must identify a file');
  const result = { path, sensitivity: sensitivity(value.sensitivity) };
  if (request) {
    if (typeof value.format !== 'string' || value.format.length === 0 || value.format.length > 32
        || /[^a-z0-9_-]/.test(value.format)) {
      fail('INVALID_FORMAT', 'artifact format must be a bounded ASCII identifier');
    }
    result.format = value.format;
  }
  return result;
}

function repositoryRoot(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    fail('INVALID_ROOT', 'repository root must be an absolute local path');
  }
  return value;
}

function contained(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
}

async function safeLstat(path, code = 'UNREADABLE') {
  try {
    return await lstat(path);
  } catch {
    fail(code, code === 'INVALID_ROOT' ? 'repository root is unavailable' : 'artifact is unreadable');
  }
}

export async function resolveArtifactReference(root, input) {
  const base = repositoryRoot(root);
  const normalized = reference(input);
  const rootInfo = await safeLstat(base, 'INVALID_ROOT');
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail('INVALID_ROOT', 'repository root must be a real directory');
  }

  let realRoot;
  try {
    realRoot = await realpath(base);
  } catch {
    fail('INVALID_ROOT', 'repository root is unavailable');
  }
  let cursor = base;
  let info;
  for (const part of normalized.path.split('/')) {
    cursor = join(cursor, part);
    info = await safeLstat(cursor);
    if (info.isSymbolicLink()) fail('SYMLINK', 'artifact paths must not contain symbolic links');
  }
  if (!info?.isFile()) fail('NOT_REGULAR_FILE', 'artifact must be a regular file');

  let realCandidate;
  try {
    realCandidate = await realpath(cursor);
  } catch {
    fail('UNREADABLE', 'artifact is unreadable');
  }
  if (!contained(realRoot, realCandidate)) fail('PATH_ESCAPE', 'artifact resolves outside the repository');
  const result = { ...normalized, size: info.size };
  Object.defineProperties(result, {
    dev: { value: info.dev, enumerable: false },
    ino: { value: info.ino, enumerable: false },
    realRoot: { value: realRoot, enumerable: false },
  });
  return deepFreeze(result);
}

function limits(value) {
  const source = value ?? ARTIFACT_LIMITS;
  plainObject(source, OPTION_KEYS, 'read limits');
  const result = {};
  for (const key of OPTION_KEYS) {
    const maximum = key === 'maxBytes' ? 1024 * 1024 * 1024 : 1_000_000;
    if (!Number.isSafeInteger(source[key]) || source[key] < 1 || source[key] > maximum) {
      fail('INVALID_LIMIT', 'read limits must be positive bounded integers');
    }
    result[key] = source[key];
  }
  return result;
}

export async function boundedBytes(path, maximum, resolved) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) fail('NOT_REGULAR_FILE', 'artifact must be a regular file');
    if (resolved !== undefined && (info.dev !== resolved.dev || info.ino !== resolved.ino)) {
      fail('UNREADABLE', 'artifact changed between resolution and read');
    }
    if (resolved !== undefined) {
      let realCandidate;
      try {
        realCandidate = await realpath(path);
      } catch {
        fail('UNREADABLE', 'artifact is unreadable');
      }
      if (!contained(resolved.realRoot, realCandidate)) {
        fail('PATH_ESCAPE', 'artifact resolves outside the repository');
      }
    }
    const buffer = Buffer.alloc(Math.min(maximum + 1, info.size + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { bytes: buffer.subarray(0, Math.min(bytesRead, maximum)), capped: bytesRead > maximum || info.size > maximum };
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    fail('UNREADABLE', 'artifact is unreadable');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('MALFORMED', 'artifact is not valid UTF-8');
  }
}

function parsedValue(text, format, maxDepth) {
  if (format === 'text') return text;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('MALFORMED', 'artifact content is malformed');
  }
  try {
    assertDataOnly(value, ArtifactError, {
      maxArray: 1_000_000,
      maxDepth,
      maxNodes: 1_000_000,
      maxObjectKeys: 100_000,
      maxString: 1024 * 1024,
    });
  } catch {
    fail('MALFORMED', 'artifact content is malformed or exceeds structural bounds');
  }
  return value;
}

function recordCount(value, format) {
  if (format === 'json') return Array.isArray(value) ? value.length : 1;
  if (value.length === 0) return 0;
  return value.split(/\r?\n/).length - (value.endsWith('\n') ? 1 : 0);
}

function outcome(request, status, bytes, records, value = null) {
  return deepFreeze({
    path: request.path,
    sensitivity: request.sensitivity,
    format: request.format,
    status,
    bytes,
    records,
    value,
  });
}

export async function readArtifacts(root, inputs, options = ARTIFACT_LIMITS) {
  repositoryRoot(root);
  if (!Array.isArray(inputs)) fail('INVALID_TYPE', 'artifact requests must be an array');
  if (inputs.length > MAX_REQUESTS) fail('BOUND_EXCEEDED', 'artifact request count exceeds the hard bound');
  const bound = limits(options);
  let requests;
  try {
    assertDataOnly(inputs, ArtifactError, {
      maxArray: MAX_REQUESTS,
      maxDepth: 2,
      maxNodes: MAX_REQUESTS * 4 + 1,
      maxObjectKeys: 3,
      maxString: 512,
    });
    requests = inputs.map((input) => reference(input, true)).toSorted((left, right) => compareAscii(left.path, right.path));
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    fail('INVALID_DATA', 'artifact requests must contain plain bounded data');
  }
  if (new Set(requests.map(({ path }) => path)).size !== requests.length) {
    fail('DUPLICATE_PATH', 'artifact request paths must be unique');
  }

  const results = [];
  let filesInspected = 0;
  let bytesInspected = 0;
  let recordsInspected = 0;
  let omittedCount = 0;
  for (const request of requests) {
    if (!ARTIFACT_FORMATS.includes(request.format)) {
      results.push(outcome(request, 'unsupported', 0, 0));
      continue;
    }
    if (filesInspected >= bound.maxFiles || bytesInspected >= bound.maxBytes
        || recordsInspected >= bound.maxRecords) {
      omittedCount++;
      results.push(outcome(request, 'capped', 0, 0));
      continue;
    }

    let resolved;
    try {
      resolved = await resolveArtifactReference(root, {
        path: request.path,
        sensitivity: request.sensitivity,
      });
    } catch (error) {
      if (error instanceof ArtifactError && error.code === 'UNREADABLE') {
        filesInspected++;
        results.push(outcome(request, 'unreadable', 0, 0));
        continue;
      }
      throw error;
    }
    filesInspected++;
    const remainingBytes = bound.maxBytes - bytesInspected;
    let read;
    try {
      read = await boundedBytes(join(root, resolved.path), remainingBytes, resolved);
    } catch (error) {
      if (error instanceof ArtifactError && error.code === 'UNREADABLE') {
        results.push(outcome(request, 'unreadable', 0, 0));
        continue;
      }
      throw error;
    }
    bytesInspected += read.bytes.length;
    if (read.capped) {
      omittedCount++;
      results.push(outcome(request, 'capped', read.bytes.length, 0));
      continue;
    }

    let value;
    try {
      value = parsedValue(decodeUtf8(read.bytes), request.format, bound.maxDepth);
    } catch (error) {
      if (error instanceof ArtifactError && error.code === 'MALFORMED') {
        results.push(outcome(request, 'malformed', read.bytes.length, 0));
        continue;
      }
      throw error;
    }
    const records = recordCount(value, request.format);
    const remainingRecords = bound.maxRecords - recordsInspected;
    if (records > remainingRecords) {
      recordsInspected += remainingRecords;
      omittedCount += records - remainingRecords;
      results.push(outcome(request, 'capped', read.bytes.length, remainingRecords));
      continue;
    }
    recordsInspected += records;
    results.push(outcome(request, 'read', read.bytes.length, records, value));
  }

  const statuses = new Set(results.map(({ status }) => status));
  const complete = results.length === requests.length && statuses.size <= 1 && (statuses.size === 0 || statuses.has('read'));
  const searchSpace = normalizeSearchSpace({
    supported: !statuses.has('unsupported'),
    readable: !statuses.has('unreadable'),
    complete,
    capped: statuses.has('capped'),
    error: statuses.has('unreadable'),
    malformed: statuses.has('malformed'),
    ambiguous: false,
    filesInspected,
    fileLimit: bound.maxFiles,
    bytesInspected,
    byteLimit: bound.maxBytes,
    recordsInspected,
    recordLimit: bound.maxRecords,
    omittedCount,
  });
  return deepFreeze({ results, searchSpace });
}
