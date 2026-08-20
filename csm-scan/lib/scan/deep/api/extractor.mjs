// API Surface dimension — declaration-backed extractors.
//
// T211 owns this module. It is a pure text extractor: it consumes bounded
// artifact content (`{ path, text, value, format, ecosystem }`) and returns
// candidate operation records plus explicit diagnostics. It never probes,
// executes, or guesses endpoints.
//
// Supported literal subsets (conservative):
//   - Contracts: OpenAPI (2.0/3.x), AsyncAPI (2.x channels), GraphQL
//     Query/Mutation/Subscription fields, protobuf messages/services/rpcs,
//     WSDL portType/operation/binding/service/message declarations.
//   - Framework routes: Express/Fastify/Koa style `app.get('/path', ...)`
//     and NestJS `@Get('/path')` decorators; FastAPI `@app.get(...)` /
//     `@app.api_route(...)`; Flask `@app.route(...)`; Django `urlpatterns`
//     with `path()` literals and literal-only `re_path`/`url`; Actix attribute
//     macros and `web::resource`/`scope`/`route`; Axum `.route(...)` /
//     `.nest(...)` / `.route_service(...)`.
//   - RPC/events: protobuf `rpc` methods, WSDL `<operation>` names, GraphQL
//     operation fields, JS/TS `.emit('name')` and `CustomEvent('name')`.
//   - CLI trees: click/typer/argparse (Python), commander/yargs (JS/TS),
//     clap name/subcommands (Rust).
//   - Public exports: package.json `exports`/`main`/`module`/`types`/`bin`,
//     Python `__all__`, JS/TS `export` statements in entry files, Rust `pub`
//     items in library roots.
//
// Resolution policy: only direct literal strings and local constant aliases
// (single-file `const X = '/path'` forms) resolve to `observed`. Any other
// dynamic signature yields an `unverified` diagnostic with reason `DYNAMIC` and
// produces NO operation — name-only fixtures never create edges.
//
// False-positive guard (M1): comment/docstring strippers also track
// string/template/block-string span boundaries, and every call-syntax match
// whose start falls inside a string/comment span is rejected. Comment content
// is blanked; string content is kept (route path arguments live inside quotes)
// but its spans are tracked. GraphQL `#` comments and block strings and WSDL
// XML comments are stripped before dialect extraction, so calls embedded in
// literals or comments never become invented operations.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only shared parsers and the
// API model; it never touches node:fs / node:child_process / node:process /
// node:vm / node:module, so the recurring capability gate remains closed.

import { parseYamlShallow } from '../../shared/parse.mjs';
import {
  API_LIMITS,
  isValidDetailValue,
  isValidSignatureToken,
} from './model.mjs';

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'all']);
const ROUTER_RECEIVERS = '(?:app|router|route|server|api|express|fastify|rest)';

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function extensionOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function isSafeRoutePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  if (!value.startsWith('/')) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  if (/[\\?#@]/.test(value)) return false;
  if (value.includes('://')) return false;
  if (!/^[\x21-\x7e]+$/.test(value)) return false;
  return true;
}

function routeIdentity(method, path) {
  return `${method}:${path}`;
}

function normalizeMethod(method) {
  if (method === null || method === undefined) return 'ANY';
  const value = String(method).toUpperCase();
  return value === 'GET' || value === 'POST' || value === 'PUT' || value === 'PATCH'
    || value === 'DELETE' || value === 'HEAD' || value === 'OPTIONS' || value === 'TRACE'
    ? value
    : 'ANY';
}

function candidate({ category, dialect, signature, details, path, line, status = 'observed' }) {
  return { category, dialect, signature, details, path, line, status };
}

function diagnostic(path, status, reason, line = null) {
  return { path, status, reason, line };
}

function contractCandidate(format, signature, version, path, line) {
  return candidate({
    category: 'contract',
    dialect: format,
    signature,
    details: { format, version },
    path,
    line,
  });
}

function routeCandidate(method, pathValue, dialect, filePath, line, operationId = null) {
  return candidate({
    category: 'route',
    dialect,
    signature: routeIdentity(normalizeMethod(method), pathValue),
    details: { method: normalizeMethod(method), operationId },
    path: filePath,
    line,
  });
}

function rpcCandidate(dialect, signature, service, method, filePath, line) {
  return candidate({
    category: 'rpc',
    dialect,
    signature,
    details: { service, method },
    path: filePath,
    line,
  });
}

function eventCandidate(dialect, signature, emitter, filePath, line) {
  return candidate({
    category: 'event',
    dialect,
    signature,
    details: { emitter },
    path: filePath,
    line,
  });
}

function cliCandidate(dialect, signature, command, filePath, line) {
  return candidate({
    category: 'cli_command',
    dialect,
    signature,
    details: { command },
    path: filePath,
    line,
  });
}

function exportCandidate(dialect, signature, kind, moduleName, filePath, line) {
  return candidate({
    category: 'public_export',
    dialect,
    signature,
    details: { kind, module: moduleName },
    path: filePath,
    line,
  });
}

function quotedTokens(value) {
  const tokens = [];
  const pattern = /(['"])([^'"]+)\1/g;
  for (const match of value.matchAll(pattern)) tokens.push(match[2]);
  return tokens;
}

function lineIndexOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Comment/docstring stripping (single, block, and triple-quoted forms)
//
// Route/RPC/event/CLI calls embedded in comments or docstrings must never
// become operations. Each stripper blanks comment content while preserving
// every newline and the character offsets of remaining source, so line numbers
// and regex matches stay stable. String/template/block-string literals are
// tracked as spans: their content is preserved (route path arguments live
// inside quotes) but every call-syntax match whose start index falls inside a
// tracked span is rejected, so calls embedded in literals never become
// invented operations.
//
// JS/TS regex literals are recognized too: a `/` that follows an
// expression-introducing token (`=`, `(`, `,`, `;`, `return`, ...) opens a
// regex literal whose quote characters are literal content. Without this a
// `'` or `"` inside a regex (e.g. `/['"]/`) is misread as string-open,
// swallowing the rest of the line and dropping real routes declared later on
// the same line. Regex content is tracked as a span so call-syntax inside it
// is rejected like any other literal.
// ---------------------------------------------------------------------------

const REGEX_PRECEDING_PUNCT = new Set([
  '(', '[', '{', '=', ':', ';', ',', '!', '&', '|', '?', '<', '>', '%', '^', '~',
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'case', 'delete', 'void', 'new', 'in', 'of',
  'do', 'else', 'if', 'while', 'for', 'with', 'switch', 'await', 'yield',
  'throw', 'default',
]);

function isRegexStart(chars, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(chars[cursor])) cursor--;
  if (cursor < 0) return true;
  const prev = chars[cursor];
  if (REGEX_PRECEDING_PUNCT.has(prev)) return true;
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let start = cursor;
    while (start >= 0 && /[A-Za-z0-9_$]/.test(chars[start])) start--;
    return REGEX_PRECEDING_KEYWORDS.has(chars.slice(start + 1, cursor + 1).join(''));
  }
  return false;
}

function stripCComments(source, allowTemplates) {
  const chars = source.split('');
  const spans = [];
  let index = 0;
  let state = 'code';
  let quote = null;
  let spanStart = -1;
  while (index < chars.length) {
    const current = chars[index];
    const next = chars[index + 1];
    if (state === 'code') {
      if (current === '/' && next === '/') {
        state = 'line';
        spanStart = index;
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 2;
      } else if (current === '/' && next === '*') {
        state = 'block';
        spanStart = index;
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 2;
      } else if (current === '/' && allowTemplates && isRegexStart(chars, index)) {
        state = 'regex';
        spanStart = index;
        index += 1;
      } else if (current === '"' || current === "'" || (allowTemplates && current === '`')) {
        state = 'string';
        quote = current;
        spanStart = index;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'line') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (current === '\n') {
        spans.push({ start: spanStart, end: index });
        state = 'code';
        spanStart = -1;
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (current === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        spans.push({ start: spanStart, end: index + 2 });
        index += 2;
        state = 'code';
        spanStart = -1;
      } else {
        chars[index] = current === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (state === 'regex') {
      if (current === '\\') {
        index += 2;
      } else if (current === '/') {
        spans.push({ start: spanStart, end: index + 1 });
        state = 'code';
        spanStart = -1;
        index += 1;
      } else if (current === '\n') {
        spans.push({ start: spanStart, end: index });
        state = 'code';
        spanStart = -1;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (current === '\\') {
      index += 2;
    } else if (current === quote) {
      spans.push({ start: spanStart, end: index + 1 });
      state = 'code';
      quote = null;
      spanStart = -1;
      index += 1;
    } else if (current === '\n' && quote !== '`') {
      spans.push({ start: spanStart, end: index });
      state = 'code';
      quote = null;
      spanStart = -1;
      index += 1;
    } else {
      index += 1;
    }
  }
  if (spanStart !== -1) spans.push({ start: spanStart, end: chars.length });
  return { source: chars.join(''), spans };
}

function stripPythonComments(source) {
  const chars = source.split('');
  const spans = [];
  let index = 0;
  let state = 'code';
  let quote = null;
  let spanStart = -1;
  while (index < chars.length) {
    const current = chars[index];
    if (state === 'code') {
      if (current === '#') {
        state = 'line';
        spanStart = index;
        chars[index] = ' ';
        index += 1;
      } else if (current === '"' || current === "'") {
        if (current === chars[index + 1] && current === chars[index + 2]) {
          state = 'triple';
          quote = current;
          spanStart = index;
          chars[index] = ' ';
          chars[index + 1] = ' ';
          chars[index + 2] = ' ';
          index += 3;
        } else {
          state = 'string';
          quote = current;
          spanStart = index;
          index += 1;
        }
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'line') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (current === '\n') {
        spans.push({ start: spanStart, end: index });
        state = 'code';
        spanStart = -1;
      }
      index += 1;
      continue;
    }
    if (state === 'string') {
      if (current === '\\') {
        index += 2;
      } else if (current === quote) {
        spans.push({ start: spanStart, end: index + 1 });
        state = 'code';
        quote = null;
        spanStart = -1;
        index += 1;
      } else if (current === '\n') {
        spans.push({ start: spanStart, end: index });
        state = 'code';
        quote = null;
        spanStart = -1;
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (current === quote && chars[index + 1] === quote && chars[index + 2] === quote) {
      spans.push({ start: spanStart, end: index + 3 });
      chars[index] = ' ';
      chars[index + 1] = ' ';
      chars[index + 2] = ' ';
      index += 3;
      state = 'code';
      quote = null;
      spanStart = -1;
    } else {
      chars[index] = current === '\n' ? '\n' : ' ';
      index += 1;
    }
  }
  if (spanStart !== -1) spans.push({ start: spanStart, end: chars.length });
  return { source: chars.join(''), spans };
}

function stripComments(source, ecosystem) {
  if (ecosystem === 'python') return stripPythonComments(source);
  if (ecosystem === 'rust') return stripCComments(source, false);
  return stripCComments(source, true);
}

function isInsideSpan(index, spans) {
  for (const span of spans) {
    if (index < span.start) return false;
    if (index < span.end) return true;
  }
  return false;
}

function matchesIn(source, re, spans, offset = 0) {
  const results = [];
  for (const match of source.matchAll(re)) {
    const leading = match[0].length - match[0].trimStart().length;
    const contentIndex = match.index + leading;
    if (!isInsideSpan(contentIndex + offset, spans)) results.push(match);
  }
  return results;
}

/**
 * Classify a repository-relative path into an artifact kind.
 * @param {string} path
 * @returns {object} `{ kind, format, ecosystem }` where kind is one of
 *   `package_json`, `contract`, `source`, or `other`.
 */
const CONTRACT_DIR_PATTERN = /(?:^|\/)(?:contracts?|openapi|asyncapi|api|schema|spec|specs)\//;

export function classifyPath(path) {
  const base = basenameOf(path);
  const ext = extensionOf(path);
  if (base === 'package.json') return { kind: 'package_json', format: 'json' };
  if (/^(?:openapi|swagger|asyncapi)\.(?:ya?ml|json)$/.test(base)) {
    return { kind: 'contract', format: ext === '.json' ? 'json' : 'text', ecosystem: null };
  }
  if (ext === '.proto') return { kind: 'contract', format: 'text', ecosystem: null };
  if (ext === '.graphql' || ext === '.gql') return { kind: 'contract', format: 'text', ecosystem: null };
  if (ext === '.wsdl') return { kind: 'contract', format: 'text', ecosystem: null };
  if (['.ya', '.yaml', '.yml', '.json'].includes(ext) && CONTRACT_DIR_PATTERN.test(path)) {
    return { kind: 'contract', format: ext === '.json' ? 'json' : 'text', ecosystem: null };
  }
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return { kind: 'source', format: 'text', ecosystem: 'javascript' };
  }
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) {
    return { kind: 'source', format: 'text', ecosystem: 'typescript' };
  }
  if (['.py', '.pyi'].includes(ext)) return { kind: 'source', format: 'text', ecosystem: 'python' };
  if (ext === '.rs') return { kind: 'source', format: 'text', ecosystem: 'rust' };
  return { kind: 'other', format: 'text', ecosystem: null };
}

/**
 * Detect a contract dialect from parsed content or raw text.
 * @returns {string|null} 'openapi' | 'asyncapi' | null
 */
export function detectContractKind({ text, value, format }) {
  if (format === 'json' && value !== null && typeof value === 'object') {
    if (value.openapi !== undefined || value.swagger !== undefined) return 'openapi';
    if (value.asyncapi !== undefined) return 'asyncapi';
    return null;
  }
  const source = String(text ?? '');
  if (/^\s*openapi\s*:/m.test(source)) return 'openapi';
  if (/^\s*swagger\s*:/m.test(source)) return 'openapi';
  if (/^\s*asyncapi\s*:/m.test(source)) return 'asyncapi';
  return null;
}

function isEntrySource(path) {
  const base = basenameOf(path).toLowerCase();
  return /^(?:index|main|lib|server|app)\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|py|rs)$/.test(base);
}

// ---------------------------------------------------------------------------
// Local constant alias registry (single-file literal aliases only)
// ---------------------------------------------------------------------------

function collectConstants(text, ecosystem, spans) {
  const constants = new Map();
  const source = String(text ?? '');
  const patterns = {
    javascript: { re: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2\s*;?\s*$/gm, valueIndex: 3 },
    typescript: { re: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2\s*;?\s*$/gm, valueIndex: 3 },
    python: { re: /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"]*)\2\s*$/gm, valueIndex: 3 },
    rust: { re: /^\s*(?:const|static)\s+([A-Z_][A-Z0-9_]*)\s*:\s*&?str\s*=\s*"([^"]*)";/gm, valueIndex: 2 },
  };
  const pattern = patterns[ecosystem];
  if (!pattern) return constants;
  for (const match of matchesIn(source, pattern.re, spans)) {
    const name = match[1];
    const value = match[pattern.valueIndex];
    if (constants.size >= API_LIMITS.perFileOperations) break;
    if (!constants.has(name)) constants.set(name, value);
  }
  return constants;
}

function resolvePathArgument(raw, constants) {
  const trimmed = String(raw ?? '').trim();
  if (/^['"]/.test(trimmed)) {
    const match = trimmed.match(/^(['"])([\s\S]*?)\1$/);
    if (match) return { value: match[2], resolved: true };
    return { value: null, resolved: false };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed) && constants.has(trimmed)) {
    return { value: constants.get(trimmed), resolved: true };
  }
  if (trimmed.startsWith('/') && !/\s/.test(trimmed)) {
    return { value: trimmed, resolved: true };
  }
  return { value: null, resolved: false };
}

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

function extractOpenApi({ text, value, format, path }) {
  const operations = [];
  const diagnostics = [];
  let parsed = value;
  if (format !== 'json') {
    try {
      parsed = parseYamlShallow(text ?? '');
    } catch {
      return { operations, diagnostics: [diagnostic(path, 'unsupported', 'PARSE_UNSUPPORTED')], capped: {} };
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { operations, diagnostics: [diagnostic(path, 'unsupported', 'MALFORMED')], capped: {} };
  }
  const version = typeof parsed.openapi === 'string' ? parsed.openapi
    : typeof parsed.swagger === 'string' ? parsed.swagger : null;
  operations.push(contractCandidate('openapi', `openapi:${basenameOf(path)}`, version, path, 1));
  const pathsValue = parsed.paths;
  if (pathsValue !== null && typeof pathsValue === 'object' && !Array.isArray(pathsValue)) {
    for (const [pathName, item] of Object.entries(pathsValue)) {
      if (!isSafeRoutePath(pathName) || item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      for (const [method, operation] of Object.entries(item)) {
        if (!ROUTE_METHODS.has(method.toLowerCase())) continue;
        const operationId = operation !== null && typeof operation === 'object'
          && typeof operation.operationId === 'string' ? operation.operationId : null;
        operations.push(routeCandidate(method, pathName, 'openapi', path, 1, operationId));
      }
    }
  }
  return { operations, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// AsyncAPI (2.x channels publish/subscribe; 3.x unsupported diagnostics)
// ---------------------------------------------------------------------------

function extractAsyncApi({ text, value, format, path }) {
  const operations = [];
  const diagnostics = [];
  let parsed = value;
  if (format !== 'json') {
    try {
      parsed = parseYamlShallow(text ?? '');
    } catch {
      return { operations, diagnostics: [diagnostic(path, 'unsupported', 'PARSE_UNSUPPORTED')], capped: {} };
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { operations, diagnostics: [diagnostic(path, 'unsupported', 'MALFORMED')], capped: {} };
  }
  const version = typeof parsed.asyncapi === 'string' ? parsed.asyncapi : null;
  if (typeof version === 'string' && version.startsWith('3')) {
    return {
      operations: [contractCandidate('asyncapi', `asyncapi:${basenameOf(path)}`, version, path, 1)],
      diagnostics: [diagnostic(path, 'unverified', 'DYNAMIC')],
      capped: {},
    };
  }
  operations.push(contractCandidate('asyncapi', `asyncapi:${basenameOf(path)}`, version, path, 1));
  const channels = parsed.channels;
  if (channels !== null && typeof channels === 'object' && !Array.isArray(channels)) {
    for (const [channelName, channel] of Object.entries(channels)) {
      if (channel === null || typeof channel !== 'object' || Array.isArray(channel)) continue;
      if (!/^[\x21-\x7e]{1,128}$/.test(channelName) || /[\s\\?#@]/.test(channelName)) continue;
      if (channel.publish !== undefined) {
        operations.push(eventCandidate('asyncapi', `event:${channelName}:publish`, 'publish', path, 1));
      }
      if (channel.subscribe !== undefined) {
        operations.push(eventCandidate('asyncapi', `event:${channelName}:subscribe`, 'subscribe', path, 1));
      }
    }
  }
  if (operations.length === 1 && channels === undefined) {
    diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC'));
  }
  return { operations, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// protobuf
// ---------------------------------------------------------------------------

function braceBlocks(text, headerPattern) {
  const blocks = [];
  const source = String(text ?? '');
  for (const match of source.matchAll(headerPattern)) {
    const braceIndex = match.index + match[0].length - 1;
    if (braceIndex < match.index || source[braceIndex] !== '{') continue;
    let depth = 1;
    let cursor = braceIndex + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') depth--;
      cursor++;
    }
    if (depth !== 0) continue;
    blocks.push({
      name: match[1],
      startLine: lineIndexOf(source, match.index),
      body: source.slice(braceIndex + 1, cursor - 1),
    });
  }
  return blocks;
}

function extractProtobuf({ text, path }) {
  const operations = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const syntax = source.match(/^\s*syntax\s*=\s*"([^"]+)"/m);
  const protoVersion = syntax ? syntax[1] : null;
  operations.push(contractCandidate('protobuf', `protobuf:${basenameOf(path)}`, protoVersion, path, 1));

  const messages = braceBlocks(source, /^\s*message\s+([A-Za-z_]\w*)\s*\{/gm);
  for (const block of messages) {
    operations.push(contractCandidate('protobuf', `protobuf:message:${block.name}`, protoVersion, path, block.startLine));
  }
  const enums = braceBlocks(source, /^\s*enum\s+([A-Za-z_]\w*)\s*\{/gm);
  for (const block of enums) {
    operations.push(contractCandidate('protobuf', `protobuf:enum:${block.name}`, protoVersion, path, block.startLine));
  }
  const services = braceBlocks(source, /^\s*service\s+([A-Za-z_]\w*)\s*\{/gm);
  for (const block of services) {
    operations.push(contractCandidate('protobuf', `protobuf:service:${block.name}`, protoVersion, path, block.startLine));
    for (const match of block.body.matchAll(/^\s*rpc\s+([A-Za-z_]\w*)\s*\(/gm)) {
      operations.push(rpcCandidate(
        'protobuf',
        `protobuf:rpc:${block.name}:${match[1]}`,
        block.name,
        match[1],
        path,
        lineIndexOf(block.body, match.index + 1) + block.startLine - 1,
      ));
    }
  }
  return { operations, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

function parenDelta(line) {
  let delta = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '(') delta++;
    else if (char === ')') delta--;
  }
  return delta;
}

// Blank GraphQL `#` comments and `"""..."""` block strings (field descriptions)
// so embedded text can never be mistaken for type roots or operation fields.
// Newlines are preserved to keep line numbers stable.
function stripGraphQl(source) {
  const chars = String(source ?? '').split('');
  let index = 0;
  let state = 'code';
  while (index < chars.length) {
    const current = chars[index];
    if (state === 'code') {
      if (current === '#') {
        state = 'line';
        chars[index] = ' ';
        index += 1;
      } else if (current === '"' && chars[index + 1] === '"' && chars[index + 2] === '"') {
        state = 'block-string';
        chars[index] = ' ';
        chars[index + 1] = ' ';
        chars[index + 2] = ' ';
        index += 3;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === 'line') {
      chars[index] = current === '\n' ? '\n' : ' ';
      if (current === '\n') state = 'code';
      index += 1;
      continue;
    }
    if (current === '\\') {
      index += 2;
    } else if (current === '"' && chars[index + 1] === '"' && chars[index + 2] === '"') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      chars[index + 2] = ' ';
      index += 3;
      state = 'code';
    } else {
      chars[index] = current === '\n' ? '\n' : ' ';
      index += 1;
    }
  }
  return chars.join('');
}

function extractGraphQl({ text, path }) {
  const operations = [];
  const diagnostics = [];
  const source = stripGraphQl(text);
  operations.push(contractCandidate('graphql', `graphql:${basenameOf(path)}`, null, path, 1));
  const roots = braceBlocks(source, /^\s*(?:extend\s+)?type\s+(Query|Mutation|Subscription)\b\s*\{/gm);
  for (const block of roots) {
    const rootType = block.name;
    const bodyLines = block.body.split(/\r?\n/);
    let parenDepth = 0;
    for (let index = 0; index < bodyLines.length; index++) {
      const raw = bodyLines[index];
      if (parenDepth === 0 && /^\s*[})@#]/.test(raw)) continue;
      if (parenDepth === 0) {
        const field = raw.match(/^\s*([A-Za-z_]\w*)\s*(?:\(|\s*[:!])/);
        if (field) {
          const method = rootType === 'Query' ? 'query' : rootType === 'Mutation' ? 'mutation' : 'subscription';
          operations.push(rpcCandidate(
            'graphql',
            `graphql:${method}:${field[1]}`,
            rootType,
            field[1],
            path,
            block.startLine + index,
          ));
        }
      }
      parenDepth += parenDelta(raw);
      if (parenDepth < 0) parenDepth = 0;
    }
  }
  if (roots.length === 0) diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC'));
  return { operations, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// WSDL
// ---------------------------------------------------------------------------

// Blank XML comments so `<operation name="...">` etc. inside them can never be
// extracted. Newlines inside comments are preserved for stable line numbers.
function stripXmlComments(source) {
  return String(source ?? '').replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\r\n]/g, ' '));
}

function extractWsdl({ text, path }) {
  const operations = [];
  const diagnostics = [];
  const source = stripXmlComments(text);
  if (!/\b(?:wsdl:)?definitions\b/.test(source)) {
    return { operations, diagnostics: [diagnostic(path, 'unsupported', 'MALFORMED')], capped: {} };
  }
  const targetNamespace = source.match(/(?:targetNamespace|xmlns:tns)\s*=\s*"([^"]+)"/);
  const ns = targetNamespace ? targetNamespace[1] : null;
  operations.push(contractCandidate('wsdl', `wsdl:${basenameOf(path)}`, null, path, 1));
  for (const kind of ['types', 'message', 'portType', 'binding', 'service']) {
    const pattern = new RegExp(`<(?:(?:wsdl|xsd):)?${kind}\\b[^>]*\\bname\\s*=\\s*"([^"]+)"`, 'g');
    for (const match of source.matchAll(pattern)) {
      operations.push(contractCandidate(
        'wsdl',
        `wsdl:${kind}:${match[1]}`,
        null,
        path,
        lineIndexOf(source, match.index),
      ));
    }
  }
  const operationPattern = /<(?:(?:wsdl):)?operation\b[^>]*\bname\s*=\s*"([^"]+)"/g;
  for (const match of source.matchAll(operationPattern)) {
    operations.push(rpcCandidate('wsdl', `wsdl:operation:${match[1]}`, ns ?? 'portType', match[1], path, lineIndexOf(source, match.index)));
  }
  return { operations, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Framework routes
// ---------------------------------------------------------------------------

function extractJavaScriptRoutes(text, path, constants, spans) {
  const operations = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const patterns = [
    {
      name: 'decorator',
      re: /@\s*(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*(['"])([^'"]+)\2/g,
      methodOf: (match) => match[1],
      pathOf: (match) => match[3],
    },
    {
      name: 'method',
      re: new RegExp(`\\b${ROUTER_RECEIVERS}\\s*\\.\\s*(get|post|put|patch|delete|head|options|all)\\s*\\(\\s*([^,()]+)`, 'g'),
      methodOf: (match) => match[1],
      pathOf: (match) => match[2],
    },
    {
      name: 'use',
      re: new RegExp(`\\b(?:${ROUTER_RECEIVERS})\\s*\\.\\s*use\\s*\\(\\s*(['"])([^'"]+)\\1`, 'g'),
      methodOf: () => 'ANY',
      pathOf: (match) => match[2],
    },
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern.re, spans)) {
      const method = pattern.methodOf(match);
      const raw = pattern.pathOf(match);
      const resolved = resolvePathArgument(raw, constants);
      const line = lineIndexOf(source, match.index);
      if (!resolved.resolved || !isSafeRoutePath(resolved.value)) {
        if (!resolved.resolved) diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
        continue;
      }
      operations.push(routeCandidate(method, resolved.value, 'express', path, line));
    }
  }
  return { operations, diagnostics };
}

function flaskMethods(methodsText) {
  const tokens = quotedTokens(methodsText ?? '');
  const methods = tokens.map((token) => normalizeMethod(token));
  return methods.length === 0 ? ['GET'] : methods;
}

// Accept `methods=` only when its `[` token lies outside any string/comment
// span, so decorator arguments such as `doc="methods=['POST']"` never invent
// methods for the decorated path.
function methodsFromLine(line, spans, offset) {
  const methodsMatch = line.match(/methods\s*=\s*\[([^\]]*)\]/);
  if (!methodsMatch) return null;
  const bracketOffset = methodsMatch.index + methodsMatch[0].indexOf('[');
  if (isInsideSpan(bracketOffset + offset, spans)) return null;
  return flaskMethods(methodsMatch[1]);
}

function extractPythonRoutes(text, path, constants, spans) {
  const operations = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const patterns = [
    {
      name: 'fastapi',
      re: /@\s*(?:app|router|api)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*([^,)]+)/g,
      methodOf: (match) => match[1],
      pathOf: (match) => match[2],
    },
    {
      name: 'api_route',
      re: /@\s*(?:app|router|api)\s*\.\s*api_route\s*\(\s*([^,)]+)/g,
      methodOf: () => 'ANY',
      pathOf: (match) => match[1],
      methodsFrom: (line, routeSpans, offset) => methodsFromLine(line, routeSpans, offset),
    },
    {
      name: 'flask',
      re: /@\s*(?:app|blueprint|bp)\s*\.\s*route\s*\(\s*([^,)]+)/g,
      methodOf: () => 'GET',
      pathOf: (match) => match[1],
      methodsFrom: (line, routeSpans, offset) => methodsFromLine(line, routeSpans, offset),
    },
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern.re, spans)) {
      const line = lineIndexOf(source, match.index);
      const resolved = resolvePathArgument(pattern.pathOf(match), constants);
      if (!resolved.resolved || !isSafeRoutePath(resolved.value)) {
        if (!resolved.resolved) diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
        continue;
      }
      const lineEnd = source.indexOf('\n', match.index);
      const methods = typeof pattern.methodsFrom === 'function'
        ? pattern.methodsFrom(source.slice(match.index, lineEnd === -1 ? source.length : lineEnd), spans, match.index)
        : null;
      const base = routeCandidate(pattern.methodOf(match), resolved.value, pattern.name, path, line);
      if (methods === null || methods.length === 0 || (methods.length === 1 && methods[0] === 'ANY')) {
        operations.push(base);
        continue;
      }
      for (const method of methods) {
        if (method === 'ANY') continue;
        operations.push({ ...base, details: { method, operationId: null }, signature: routeIdentity(method, resolved.value) });
      }
    }
  }
  return { operations, diagnostics };
}

function djangoPatterns(text, path, spans) {
  const operations = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const start = source.indexOf('urlpatterns');
  if (start === -1) return { operations, diagnostics };
  const bracket = source.indexOf('[', start);
  if (bracket === -1) return { operations, diagnostics };
  let depth = 0;
  let cursor = bracket;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '[') depth++;
    else if (char === ']') depth--;
    cursor++;
    if (depth === 0) break;
  }
  if (depth !== 0) return { operations, diagnostics };
  const block = source.slice(bracket, cursor - 1);
  const baseLine = lineIndexOf(source, bracket);
  const pattern = /\b(path|re_path|url)\s*\(\s*(?:r)?(['"])([^'"]+)\2/g;
  for (const match of matchesIn(block, pattern, spans, bracket)) {
    const kind = match[1];
    let value = match[3];
    const line = lineIndexOf(block, match.index) + baseLine - 1;
    if (kind === 'path') {
      const normalized = `/${value}`.replace(/<([^>]+)>/g, '{$1}').replace(/\/+/g, '/');
      if (!isSafeRoutePath(normalized)) continue;
      operations.push(routeCandidate(null, normalized, 'django', path, line));
      continue;
    }
    if (!/^[\x21-\x7e]+$/.test(value)) {
      diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
      continue;
    }
    const withoutAnchors = value.replace(/^\^/, '').replace(/\$$/, '');
    if (/[\\[\]()|.*+?{}]/.test(withoutAnchors)) {
      diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
      continue;
    }
    if (withoutAnchors.length === 0) continue;
    const normalized = `/${withoutAnchors}`.replace(/\/+/g, '/');
    if (!isSafeRoutePath(normalized)) {
      diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
      continue;
    }
    operations.push(routeCandidate(null, normalized, 'django', path, line));
  }
  return { operations, diagnostics };
}

function extractRustRoutes(text, path, constants, spans) {
  const operations = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const patterns = [
    {
      name: 'actix-macro',
      re: /#\[(get|post|put|delete|patch|head)\s*\(\s*"([^"]+)"\s*\)\]/g,
      methodOf: (match) => match[1],
      pathOf: (match) => match[2],
    },
    {
      name: 'actix-route',
      re: /#\[route\s*\(\s*"([^"]+)"\s*(?:,\s*method\s*=\s*"([^"]+)")?\s*\)\]/g,
      methodOf: (match) => match[2] ?? 'ANY',
      pathOf: (match) => match[1],
    },
    {
      name: 'actix-resource',
      re: /web::resource\s*\(\s*"([^"]+)"\s*\)/g,
      methodOf: () => 'ANY',
      pathOf: (match) => match[1],
    },
    {
      name: 'actix-scope',
      re: /web::scope\s*\(\s*"([^"]+)"\s*\)/g,
      methodOf: () => 'ANY',
      pathOf: (match) => match[1],
    },
    {
      name: 'axum-route',
      re: /\.\s*route\s*\(\s*([^,)]+)\s*,\s*((?:[A-Za-z_][\w:]*::)*\s*(?:get|post|put|patch|delete|any))\s*\(/g,
      methodOf: (match) => match[2].split('::').pop().trim().replace(/[^a-z]/g, '') || 'any',
      pathOf: (match) => match[1],
      chainOf: (match, line, routeSpans, baseOffset) => {
        const restStart = match[0].length;
        return matchesIn(line.slice(restStart), /\.\s*(get|post|put|patch|delete|any)\s*\(/g, routeSpans, baseOffset + restStart)
          .map((chain) => chain[1]);
      },
    },
    {
      name: 'axum-nest',
      re: /\.\s*nest\s*\(\s*"([^"]+)"/g,
      methodOf: () => 'ANY',
      pathOf: (match) => match[1],
    },
    {
      name: 'axum-route-service',
      re: /\.\s*route_service\s*\(\s*"([^"]+)"\s*,/g,
      methodOf: () => 'ANY',
      pathOf: (match) => match[1],
    },
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern.re, spans)) {
      const raw = pattern.pathOf(match);
      const resolved = resolvePathArgument(raw, constants);
      const line = lineIndexOf(source, match.index);
      if (!resolved.resolved || !isSafeRoutePath(resolved.value)) {
        if (!resolved.resolved) diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', line));
        continue;
      }
      const methods = [pattern.methodOf(match)];
      if (typeof pattern.chainOf === 'function') {
        const lineEnd = source.indexOf('\n', match.index);
        const lineSlice = source.slice(match.index, lineEnd === -1 ? source.length : lineEnd);
        methods.push(...pattern.chainOf(match, lineSlice, spans, match.index));
      }
      for (const method of new Set(methods)) {
        operations.push(routeCandidate(method, resolved.value, pattern.name, path, line));
      }
    }
  }
  return { operations, diagnostics };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function extractEvents(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const patterns = [
    {
      name: 'event-emitter',
      re: /\.\s*emit\s*\(\s*(['"])([^'"]+)\1/g,
      signatureOf: (match) => `event:emit:${match[2]}`,
      emitterOf: () => 'emit',
    },
    {
      name: 'custom-event',
      re: /new\s+CustomEvent\s*\(\s*(['"])([^'"]+)\1/g,
      signatureOf: (match) => `event:custom:${match[2]}`,
      emitterOf: () => 'CustomEvent',
    },
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern.re, spans)) {
      const name = match[2];
      if (!/^[\x21-\x7e]{1,128}$/.test(name) || /[\s\\?#@]/.test(name)) continue;
      operations.push(eventCandidate(pattern.name, pattern.signatureOf(match), pattern.emitterOf(match), path, lineIndexOf(source, match.index)));
    }
  }
  return operations;
}

// ---------------------------------------------------------------------------
// CLI command trees
// ---------------------------------------------------------------------------

function extractPythonCli(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const patterns = [
    {
      name: 'click',
      re: /@\s*click\.(?:group|command)\([^)]*\)\s*\ndef\s+([A-Za-z_]\w*)/g,
      signatureOf: (match) => `cli:click:${match[1]}`,
      commandOf: (match) => match[1],
    },
    {
      name: 'click-add',
      re: /\.\s*add_command\s*\(\s*([A-Za-z_]\w*)\s*\)/g,
      signatureOf: (match) => `cli:click:add:${match[1]}`,
      commandOf: (match) => match[1],
    },
    {
      name: 'typer',
      re: /@\s*(?:app|cli|typer)\s*\.\s*command\([^)]*\)\s*\ndef\s+([A-Za-z_]\w*)/g,
      signatureOf: (match) => `cli:typer:${match[1]}`,
      commandOf: (match) => match[1],
    },
    {
      name: 'argparse',
      re: /\.\s*add_parser\s*\(\s*(['"])([^'"]+)\1/g,
      signatureOf: (match) => `cli:argparse:${match[2]}`,
      commandOf: (match) => match[2],
    },
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern.re, spans)) {
      operations.push(cliCandidate(pattern.name, pattern.signatureOf(match), pattern.commandOf(match), path, lineIndexOf(source, match.index)));
    }
  }
  return operations;
}

function extractJavaScriptCli(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const pattern = /\.\s*command\s*\(\s*(['"])([^'"]+)\1/g;
  for (const match of matchesIn(source, pattern, spans)) {
    operations.push(cliCandidate('commander-yargs', `cli:commander:${match[2]}`, match[2], path, lineIndexOf(source, match.index)));
  }
  return operations;
}

function extractRustCli(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const namePattern = /#\[command\(([^)]*)\)\]/g;
  for (const match of matchesIn(source, namePattern, spans)) {
    const name = match[1].match(/\bname\s*=\s*"([^"]+)"/);
    if (name) {
      operations.push(cliCandidate('clap', `cli:clap:${name[1]}`, name[1], path, lineIndexOf(source, match.index)));
    }
  }
  const subcommandPattern = /#\[derive\([^)]*Subcommand[^)]*\)\]\s*enum\s+[A-Za-z_]\w*\s*\{([^}]*)\}/g;
  for (const match of matchesIn(source, subcommandPattern, spans)) {
    const body = match[1];
    for (const variant of body.matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\b/gm)) {
      operations.push(cliCandidate('clap', `cli:clap:subcommand:${variant[1]}`, variant[1], path, lineIndexOf(source, match.index)));
    }
  }
  return operations;
}

function extractCliCommands(text, path, ecosystem, spans) {
  if (ecosystem === 'python') return extractPythonCli(text, path, spans);
  if (ecosystem === 'javascript' || ecosystem === 'typescript') return extractJavaScriptCli(text, path, spans);
  if (ecosystem === 'rust') return extractRustCli(text, path, spans);
  return [];
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

function extractJavaScriptExports(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const patterns = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+\{\s*([^}]+)\s*\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of matchesIn(source, pattern, spans)) {
      if (match[1] === undefined) continue;
      const names = match[1].split(',').map((entry) => entry.split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const name of names) {
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        operations.push(exportCandidate('js', `export:js:${name}`, 'export', name, path, lineIndexOf(source, match.index)));
      }
    }
  }
  return operations;
}

function extractPythonExports(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const pattern = /__all__\s*=\s*\[([\s\S]*?)\]/g;
  for (const match of matchesIn(source, pattern, spans)) {
    for (const token of quotedTokens(match[1])) {
      if (!/^[A-Za-z_][\w$]*$/.test(token)) continue;
      operations.push(exportCandidate('python-all', `export:python-all:${token}`, 'all', token, path, lineIndexOf(source, match.index)));
    }
  }
  return operations;
}

function extractRustExports(text, path, spans) {
  const operations = [];
  const source = String(text ?? '');
  const patterns = [
    { kind: 'fn', re: /pub\s+(?:async\s+)?fn\s+([a-z_]\w*)/g },
    { kind: 'struct', re: /pub\s+struct\s+([A-Z]\w*)/g },
    { kind: 'enum', re: /pub\s+enum\s+([A-Z]\w*)/g },
    { kind: 'trait', re: /pub\s+trait\s+([A-Z]\w*)/g },
    { kind: 'use', re: /pub\s+use\s+([A-Za-z0-9_:]+)/g },
  ];
  for (const { kind, re } of patterns) {
    for (const match of matchesIn(source, re, spans)) {
      operations.push(exportCandidate('rust', `export:rust:${kind}:${match[1]}`, kind, match[1], path, lineIndexOf(source, match.index)));
    }
  }
  return operations;
}

function extractPublicExports(text, path, ecosystem, spans) {
  if (ecosystem === 'javascript' || ecosystem === 'typescript') {
    return isEntrySource(path) ? extractJavaScriptExports(text, path, spans) : [];
  }
  if (ecosystem === 'python') return extractPythonExports(text, path, spans);
  if (ecosystem === 'rust') return isEntrySource(path) ? extractRustExports(text, path, spans) : [];
  return [];
}

function extractPackageExports(value, path) {
  const operations = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return operations;
  if (value.exports !== null && typeof value.exports === 'object' && !Array.isArray(value.exports)) {
    for (const key of Object.keys(value.exports)) {
      if (!/^[A-Za-z0-9._/:-]{1,128}$/.test(key)) continue;
      operations.push(exportCandidate('package-exports', `export:package:${key}`, 'exports', key, path, 1));
    }
  }
  for (const field of ['main', 'module', 'types']) {
    if (typeof value[field] === 'string' && /^[A-Za-z0-9._/:-]{1,128}$/.test(value[field])) {
      operations.push(exportCandidate('package-exports', `export:package:${field}`, field, value[field], path, 1));
    }
  }
  if (typeof value.bin === 'string') {
    const name = basenameOf(value.bin);
    if (/^[A-Za-z0-9._:-]{1,128}$/.test(name)) {
      operations.push(cliCandidate('package-bin', `cli:bin:${name}`, name, path, 1));
    }
  } else if (value.bin !== null && typeof value.bin === 'object' && !Array.isArray(value.bin)) {
    for (const name of Object.keys(value.bin)) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(name)) continue;
      operations.push(cliCandidate('package-bin', `cli:bin:${name}`, name, path, 1));
    }
  }
  return operations;
}

// ---------------------------------------------------------------------------
// Per-file dispatch
// ---------------------------------------------------------------------------

function sanitizeCandidates(operations, path) {
  const kept = [];
  const diagnostics = [];
  for (const operation of operations) {
    const detailsValid = Object.values(operation.details).every(isValidDetailValue);
    if (!isValidSignatureToken(operation.signature) || !detailsValid) {
      diagnostics.push(diagnostic(path, 'unverified', 'DYNAMIC', operation.line ?? null));
      continue;
    }
    kept.push(operation);
  }
  return { operations: kept, diagnostics };
}

function finalize(operations, diagnostics, path) {
  const clean = sanitizeCandidates(operations, path);
  return boundedCollections(clean.operations, [...diagnostics, ...clean.diagnostics], path);
}

function boundedCollections(operations, diagnostics, path) {
  let capped = { contracts: false, operations: false };
  if (operations.length > API_LIMITS.perFileOperations) {
    operations.length = API_LIMITS.perFileOperations;
    capped.operations = true;
    diagnostics.push(diagnostic(path, 'unverified', 'CAP'));
  }
  const contracts = operations.filter(({ category }) => category === 'contract').length;
  if (contracts > API_LIMITS.perFileContracts) {
    capped.contracts = true;
  }
  if (diagnostics.length > API_LIMITS.perFileDiagnostics) {
    diagnostics.length = API_LIMITS.perFileDiagnostics;
  }
  return { operations, diagnostics, capped };
}

/**
 * Extract API-surface candidate operations from one bounded artifact.
 *
 * @param {object} input - `{ path, text, value, format, ecosystem }`.
 * @returns {{ operations: object[], diagnostics: object[], capped: object }}
 *   Candidate records (not yet frozen; the model validates and freezes them),
 *   diagnostics, and per-file cap flags. Never throws on content; malformed or
 *   unsupported content produces diagnostics.
 */
export function extractApiSurface({ path, text, value, format, ecosystem }) {
  const classification = classifyPath(path);
  if (classification.kind === 'other') {
    return { operations: [], diagnostics: [diagnostic(path, 'unsupported', 'UNSUPPORTED')], capped: {} };
  }

  if (classification.kind === 'package_json') {
    return finalize(extractPackageExports(value, path), [], path);
  }

  if (classification.kind === 'contract') {
    const ext = extensionOf(path);
    if (ext === '.proto') return finalize(...splitResult(extractProtobuf({ text, path })), path);
    if (ext === '.graphql' || ext === '.gql') return finalize(...splitResult(extractGraphQl({ text, path })), path);
    if (ext === '.wsdl') return finalize(...splitResult(extractWsdl({ text, path })), path);
    const contractKind = detectContractKind({ text, value, format });
    if (contractKind === 'openapi') return finalize(...splitResult(extractOpenApi({ text, value, format, path })), path);
    if (contractKind === 'asyncapi') return finalize(...splitResult(extractAsyncApi({ text, value, format, path })), path);
    return { operations: [], diagnostics: [diagnostic(path, 'unsupported', 'UNSUPPORTED')], capped: {} };
  }

  const stripped = stripComments(String(text ?? ''), ecosystem);
  const source = stripped.source;
  const spans = stripped.spans;
  const constants = collectConstants(source, ecosystem, spans);
  const operations = [];
  const diagnostics = [];
  if (ecosystem === 'javascript' || ecosystem === 'typescript') {
    const routes = extractJavaScriptRoutes(source, path, constants, spans);
    operations.push(...routes.operations);
    diagnostics.push(...routes.diagnostics);
    operations.push(...extractEvents(source, path, spans));
    operations.push(...extractCliCommands(source, path, ecosystem, spans));
    operations.push(...extractPublicExports(source, path, ecosystem, spans));
  } else if (ecosystem === 'python') {
    const routes = extractPythonRoutes(source, path, constants, spans);
    operations.push(...routes.operations);
    diagnostics.push(...routes.diagnostics);
    const django = djangoPatterns(source, path, spans);
    operations.push(...django.operations);
    diagnostics.push(...django.diagnostics);
    operations.push(...extractCliCommands(source, path, ecosystem, spans));
    operations.push(...extractPublicExports(source, path, ecosystem, spans));
  } else if (ecosystem === 'rust') {
    const routes = extractRustRoutes(source, path, constants, spans);
    operations.push(...routes.operations);
    diagnostics.push(...routes.diagnostics);
    operations.push(...extractCliCommands(source, path, ecosystem, spans));
    operations.push(...extractPublicExports(source, path, ecosystem, spans));
  } else {
    diagnostics.push(diagnostic(path, 'unsupported', 'UNSUPPORTED'));
  }
  return finalize(operations, diagnostics, path);
}

function splitResult(result) {
  return [result.operations, result.diagnostics];
}
