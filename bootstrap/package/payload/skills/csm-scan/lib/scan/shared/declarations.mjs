import { compareAscii, deepFreeze } from '../contracts/evidence.mjs';
import { ARTIFACT_LIMITS, readArtifacts } from './artifacts.mjs';
import { parseYamlShallow } from './parse.mjs';
import { assertPrivacySafe } from './privacy.mjs';

export const DECLARATION_KINDS = Object.freeze([
  'command',
  'environment',
  'image',
  'job',
  'service',
  'target',
  'version',
]);

export const DECLARATION_LIMITS = deepFreeze({
  commands: 256,
  environments: 128,
  images: 64,
  jobs: 64,
  maxBytes: ARTIFACT_LIMITS.maxBytes,
  maxFiles: ARTIFACT_LIMITS.maxFiles,
  maxRecords: ARTIFACT_LIMITS.maxRecords,
  services: 64,
  targets: 128,
  versions: 64,
});

const VERSION_FILES = Object.freeze([
  '.node-version',
  '.nvmrc',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
  'rust-toolchain',
  'rust-toolchain.toml',
]);

const WORKFLOW_PREFIX = '.github/workflows/';

function basenameOf(path) {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

function artifactKind(path) {
  const base = basenameOf(path);
  if (path.startsWith(WORKFLOW_PREFIX) && /\.ya?ml$/i.test(base)) return 'workflow';
  if (/^(?:docker-)?compose\.ya?ml$/i.test(base)) return 'compose';
  if (base === 'package.json') return 'package_json';
  if (/^makefile$/i.test(base)) return 'makefile';
  if (VERSION_FILES.includes(base)) return 'version_file';
  if (/^dockerfile(?:\..*)?$/i.test(base)) return 'dockerfile';
  return null;
}

function bounded(value, maximum, code) {
  if (value.length > maximum) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return value;
}

function safeName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
      || /[^\x20-\x7e]/.test(value) || value !== value.trim()) {
    throw new Error('INVALID_NAME');
  }
  return value;
}

function record(kind, label, source, extra = {}) {
  return { kind, label, ...extra, source };
}

function sourceOf(path, line) {
  return line == null ? { path } : { path, line };
}

function workflowExtractor(value, path) {
  const declarations = [];
  const jobs = value && typeof value === 'object' ? value.jobs : null;
  if (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) {
    bounded(Object.keys(jobs), DECLARATION_LIMITS.jobs, 'JOBS_LIMIT');
    for (const [jobId, job] of Object.entries(jobs)) {
      if (!job || typeof job !== 'object') continue;
      if (typeof job.container === 'string') {
        declarations.push(record('image', job.container, sourceOf(path), { kindOfImage: 'container' }));
      }
      if (typeof job['runs-on'] === 'string') {
        declarations.push(record('environment', job['runs-on'], sourceOf(path), { scope: 'runs-on' }));
      }
      const commands = [];
      for (const step of Array.isArray(job.steps) ? job.steps : []) {
        if (step && typeof step === 'object' && typeof step.run === 'string') {
          if (/^[|>][+-]?\d*$/.test(step.run)) {
            const error = new Error('BLOCK_SCALAR');
            error.code = 'BLOCK_SCALAR';
            throw error;
          }
          commands.push(step.run);
        }
      }
      for (const command of bounded(commands, DECLARATION_LIMITS.commands, 'COMMANDS_LIMIT')) {
        declarations.push(record('command', command, sourceOf(path), { scope: 'workflow-step', job: jobId }));
      }
      if (commands.length > 0) {
        declarations.push(record('job', jobId, sourceOf(path)));
      }
      const environments = [];
      if (typeof job.environment === 'string') environments.push(job.environment);
      else if (job.environment && typeof job.environment === 'object' && typeof job.environment.name === 'string') {
        environments.push(job.environment.name);
      }
      if (job.env && typeof job.env === 'object') environments.push(...Object.keys(job.env));
      for (const name of bounded(environments, DECLARATION_LIMITS.environments, 'ENVIRONMENTS_LIMIT')) {
        declarations.push(record('environment', name, sourceOf(path), { scope: 'job' }));
      }
    }
  }
  return declarations;
}

function composeExtractor(value, path) {
  const declarations = [];
  const services = value && typeof value === 'object' ? value.services : null;
  if (services && typeof services === 'object' && !Array.isArray(services)) {
    bounded(Object.keys(services), DECLARATION_LIMITS.services, 'SERVICES_LIMIT');
    for (const [name, service] of Object.entries(services)) {
      if (!service || typeof service !== 'object') continue;
      const extra = {};
      if (typeof service.image === 'string') {
        declarations.push(record('image', service.image, sourceOf(path), { scope: 'service' }));
        extra.image = service.image;
      }
      if (service.environment && typeof service.environment === 'object') {
        for (const key of bounded(Object.keys(service.environment), DECLARATION_LIMITS.environments, 'ENVIRONMENTS_LIMIT')) {
          declarations.push(record('environment', key, sourceOf(path), { scope: 'service' }));
        }
      }
      if (typeof service.container_name === 'string') extra.containerName = service.container_name;
      declarations.push(record('service', name, sourceOf(path), extra));
    }
  }
  return declarations;
}

function packageJsonExtractor(value, path) {
  const declarations = [];
  const scripts = value && typeof value === 'object' ? value.scripts : null;
  if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue;
      declarations.push(record('command', safeName(name), sourceOf(path), { command, scope: 'script' }));
    }
  }
  const engines = value && typeof value === 'object' ? value.engines : null;
  if (engines && typeof engines === 'object') {
    for (const [label, version] of Object.entries(engines)) {
      if (typeof version === 'string') {
        declarations.push(record('version', label, sourceOf(path), { value: version, scope: 'engines' }));
      }
    }
  }
  return bounded(declarations, DECLARATION_LIMITS.commands, 'COMMANDS_LIMIT');
}

function makefileExtractor(text, path) {
  const declarations = [];
  const lines = text.split(/\r?\n/);
  let inDefine = false;
  let continuation = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^define\b/.test(line)) {
      inDefine = true;
      continue;
    }
    if (inDefine) {
      if (/^endef\b/.test(line)) inDefine = false;
      continue;
    }
    if (continuation) {
      if (/\\\s*$/.test(line)) continue;
      continuation = false;
      if (/^\t/.test(line)) continue;
    }
    if (!inDefine && /^[A-Za-z0-9_.%/-]+\s*:(?:[^=]|$)/.test(line)) {
      declarations.push(record('target', matchOf(line), sourceOf(path, index + 1)));
      continue;
    }
    if (line.endsWith('\\')) {
      continuation = true;
      continue;
    }
    if (/^\t/.test(line)) {
      declarations.push(record('command', line.trim(), sourceOf(path, index + 1), { scope: 'makefile' }));
    }
  }
  return bounded(declarations, DECLARATION_LIMITS.targets + DECLARATION_LIMITS.commands, 'RECORDS_LIMIT');
}

function matchOf(line) {
  return line.match(/^([A-Za-z0-9_.%/-]+)\s*:/)[1];
}

function versionFileExtractor(text, path) {
  const declarations = [];
  const base = basenameOf(path);
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (value.length === 0 || value.startsWith('#')) continue;
    if (base === '.tool-versions') {
      const parts = value.split(/\s+/);
      if (parts.length >= 2) {
        declarations.push(record('version', parts[0], sourceOf(path), { value: parts[1] }));
      }
    } else {
      declarations.push(record('version', base, sourceOf(path), { value }));
    }
  }
  return bounded(declarations, DECLARATION_LIMITS.versions, 'VERSIONS_LIMIT');
}

function dockerfileExtractor(text, path) {
  const declarations = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const from = trimmed.match(/^FROM\s+(.+)$/i);
    if (from) {
      const reference = from[1]
        .replace(/\s*--platform(?:=[^\s]+|\s+[^\s]+)/gi, '')
        .replace(/\s+AS\s+[A-Za-z0-9_.-]+$/i, '')
        .trim();
      declarations.push(record('image', reference, sourceOf(path), { scope: 'from' }));
      continue;
    }
    const env = trimmed.match(/^ENV\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s|=|$)/i);
    if (env) {
      declarations.push(record('environment', env[1], sourceOf(path), { scope: 'env' }));
    }
  }
  return bounded(declarations, DECLARATION_LIMITS.images + DECLARATION_LIMITS.environments, 'RECORDS_LIMIT');
}

function extract(kind, value, text, path) {
  switch (kind) {
    case 'workflow': return workflowExtractor(value, path);
    case 'compose': return composeExtractor(value, path);
    case 'package_json': return packageJsonExtractor(value, path);
    case 'makefile': return makefileExtractor(text, path);
    case 'version_file': return versionFileExtractor(text, path);
    case 'dockerfile': return dockerfileExtractor(text, path);
    default: throw new Error('UNSUPPORTED_ARTIFACT');
  }
}

function parseArtifact(kind, text) {
  if (kind === 'workflow' || kind === 'compose') return parseYamlShallow(text);
  return null;
}

function safeReason(error) {
  if (error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) return error.code;
  return 'PARSE_UNSUPPORTED';
}

export async function extractDeclarations({ root, requests, options = ARTIFACT_LIMITS }) {
  const artifacts = await readArtifacts(root, requests, options);
  const declarations = [];
  const diagnostics = [];
  for (const result of artifacts.results) {
    if (result.status !== 'read') {
      diagnostics.push({ path: result.path, status: result.status, reason: result.status });
      continue;
    }
    const kind = artifactKind(result.path);
    if (kind === null) {
      diagnostics.push({ path: result.path, status: 'unsupported', reason: 'no extractor' });
      continue;
    }
    try {
      const parsed = kind === 'package_json' ? result.value : parseArtifact(kind, result.value);
      const text = kind === 'package_json' || kind === 'workflow' || kind === 'compose' ? '' : result.value;
      const extracted = extract(kind, parsed, text, result.path);
      for (const entry of extracted) {
        try {
          assertPrivacySafe(entry);
          declarations.push(entry);
        } catch {
          diagnostics.push({ path: result.path, status: 'unverified', reason: 'privacy' });
        }
      }
    } catch (error) {
      diagnostics.push({ path: result.path, status: 'unsupported', reason: safeReason(error) });
    }
  }
  declarations.sort((left, right) => compareAscii(
    `${left.kind}:${left.source.path}:${left.source.line ?? 0}:${left.label}`,
    `${right.kind}:${right.source.path}:${right.source.line ?? 0}:${right.label}`,
  ));
  diagnostics.sort((left, right) => compareAscii(left.path, right.path) || compareAscii(left.status, right.status));
  return deepFreeze({ declarations, diagnostics, searchSpace: artifacts.searchSpace });
}

// ---------------------------------------------------------------------------
// INI section-block reader (import-linter style)
// ---------------------------------------------------------------------------

// Bounds for the pure INI section-block parser. The hosting scanner's read
// budget already caps raw bytes; these caps keep the structured output
// deterministic and bounded for arbitrarily large inputs.
export const INI_READER_LIMITS = deepFreeze({
  maxSections: 512,
  maxKeysPerSection: 512,
  maxKeyLength: 128,
  maxValueLength: 8192,
  maxLines: 200_000,
});

function trimEnd(value) {
  return value.replace(/[\t ]+$/g, '');
}

/**
 * Parse a bounded INI section-block document (`.importlinter`, `.quality-gates`,
 * and similar `key = value` files) into ordered section blocks. A section is
 * introduced by a `[name]` header line; indented continuation lines following
 * an empty-valued `key =` assignment extend that key's value (import-linter's
 * `source_modules =\n    pkg.a` idiom). Full-line `#`/`;` comments and blank
 * lines are ignored, and a blank line terminates a pending continuation.
 * Content beyond the declared caps is dropped with `truncated` disclosed.
 * Pure and deterministic; never throws on malformed content.
 *
 * @param {string} text - raw INI file content.
 * @param {object} limits - `INI_READER_LIMITS` or a caller-provided override.
 * @returns {object} deep-frozen `{ sections, truncated }` where each section is
 *   `{ name, line, entries }` and each entry is `{ key, value, line }`.
 */
export function parseIniSections(text, limits = INI_READER_LIMITS) {
  const source = text == null ? '' : String(text);
  const lines = source.split(/\r?\n/);
  const sections = [];
  let current = null;
  let pendingKey = null;
  let pendingValue = null;
  let pendingLine = null;
  let truncated = false;

  const flushPending = () => {
    if (current !== null && pendingKey !== null) {
      current.entries.push({ key: pendingKey, value: pendingValue, line: pendingLine });
      pendingKey = null;
      pendingValue = null;
      pendingLine = null;
    }
  };

  const appendContinuation = (addition) => {
    const combined = pendingValue ? `${pendingValue}\n${addition}` : addition;
    if (combined.length > limits.maxValueLength) truncated = true;
    pendingValue = combined.slice(0, limits.maxValueLength);
  };

  let inspected = 0;
  for (let i = 0; i < lines.length && inspected < limits.maxLines; i++) {
    inspected++;
    const raw = lines[i];
    const lineNo = i + 1;
    const header = /^\s*\[([^\]\r\n]+)\]\s*(?:[#;].*)?$/.exec(raw);
    if (header) {
      flushPending();
      if (sections.length >= limits.maxSections) {
        truncated = true;
        current = null;
        continue;
      }
      current = { name: header[1].trim(), line: lineNo, entries: [] };
      sections.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^\s*$/.test(raw) || /^\s*[#;]/.test(raw)) {
      flushPending();
      continue;
    }
    const assignment = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(raw);
    if (assignment) {
      flushPending();
      const key = assignment[1];
      if (key.length > limits.maxKeyLength) {
        truncated = true;
        continue;
      }
      if (current.entries.length >= limits.maxKeysPerSection) {
        truncated = true;
        continue;
      }
      const value = trimEnd(assignment[2]);
      if (value.length === 0) {
        pendingKey = key;
        pendingValue = '';
        pendingLine = lineNo;
      } else {
        if (value.length > limits.maxValueLength) truncated = true;
        current.entries.push({ key, value: value.slice(0, limits.maxValueLength), line: lineNo });
      }
      continue;
    }
    if (/^\s+\S/.test(raw) && pendingKey !== null) {
      appendContinuation(raw.trim());
      continue;
    }
    flushPending();
  }
  flushPending();
  if (inspected >= limits.maxLines) truncated = true;

  return deepFreeze({ sections, truncated });
}
