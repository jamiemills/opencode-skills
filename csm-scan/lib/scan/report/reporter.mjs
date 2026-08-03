// Sanitized reporter and error boundary — T224.
//
// Owned by T224. Provides the privacy-safe diagnostic surface for the CLI and
// the canonical pipeline: every line written to stdout/stderr passes the T206
// privacy redaction policy before it reaches a sink, and errors are formatted
// without raw paths, identities, or secret values.
//
// Guarantees:
//   - `sanitizeText` redacts absolute paths (POSIX/Windows/UNC), emails, URL
//     credentials, secret assignments, private keys, owner handles, and known
//     token shapes. The result is validated against the T206 `assertPrivacySafe`
//     gate and any residual hazard is collapsed to `[redacted]`.
//   - `createReporter` writes only sanitized lines; its `error` method is the
//     only stderr surface and never echoes raw exception text.
//   - `installSanitizedStdio` wraps `process.stdout.write` / `process.stderr.write`
//     so even third-party writes (for example the survey banner) are sanitized
//     before reaching a terminal or a captured pipe. It returns a restore
//     function and is a no-op when the target streams are already guarded.
//   - `formatError` renders a typed failure without a stack trace and without
//     sensitive values.
//
// ESM only. Zero npm deps. node: builtins only. The module never performs
// filesystem, network, or child-process access itself.

import { assertPrivacySafe } from '../shared/privacy.mjs';

export const REDACTED = '[redacted]';

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const POSIX_ABSOLUTE = /(^|[\s"'=(])\/(?!\/)[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%+-]+)*/g;
const POSIX_DOUBLE_SLASH = /(^|[\s"'=(])\/\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%+-]+)*/g;
const WINDOWS_ABSOLUTE = /(^|[\s"'=(])[A-Za-z]:[\\/][^\s"'<>]*/g;
const UNC_PATH = /(^|[\s"'=(])(?:\\\\|\\\\\\\\)[^\\\s]+(?:\\|\\\\)[^\s"'<>]+/g;
const SECRET = /(?:-----BEGIN[ ](?:RSA |EC |OPENSSH )?PRIVATE[ ]KEY-----|\b(?:bearer|password|passwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|session)\s*[:=]\s*\S+|\b[a-z][a-z0-9_-]*_token\s*[:=]\s*\S+|\b(?:gh[opusr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b)/gi;
const URL_CREDENTIAL = /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/gi;
const OWNER_IDENTITY = /(^|[\s"'])@[A-Za-z0-9][A-Za-z0-9_-]{1,38}\b/g;
const COMMIT_SUBJECT = /^(?:commit subject|subject):\s*\S/gi;

// Redactions run in a fixed order; each returns the literal replacement so a
// match is never re-processed into another sensitive form.
const REDACTIONS = Object.freeze([
  (text) => text.replace(URL_CREDENTIAL, REDACTED),
  (text) => text.replace(EMAIL, REDACTED),
  (text) => text.replace(SECRET, REDACTED),
  (text) => text.replace(COMMIT_SUBJECT, REDACTED),
  (text) => text.replace(POSIX_DOUBLE_SLASH, (_match, boundary) => `${boundary}${REDACTED}`),
  (text) => text.replace(UNC_PATH, (_match, boundary) => `${boundary}${REDACTED}`),
  (text) => text.replace(WINDOWS_ABSOLUTE, (_match, boundary) => `${boundary}${REDACTED}`),
  (text) => text.replace(POSIX_ABSOLUTE, (_match, boundary) => `${boundary}${REDACTED}`),
  (text) => text.replace(OWNER_IDENTITY, (_match, boundary) => `${boundary}${REDACTED}`),
]);

export function sanitizeText(value) {
  const text = String(value);
  if (text.length === 0) return text;
  let result = text;
  for (const redact of REDACTIONS) {
    result = redact(result);
  }
  try {
    assertPrivacySafe(result);
    return result;
  } catch {
    return REDACTED;
  }
}

export function formatError(error) {
  if (error === null || error === undefined) return 'Scan failed: unknown error';
  const name = typeof error?.name === 'string' && error.name.length > 0 ? error.name : 'Error';
  const message = typeof error?.message === 'string' ? error.message : String(error);
  return `${name}: ${sanitizeText(message)}`;
}

function isGuarded(stream, guard) {
  return typeof stream?.write === 'function' && stream.write === guard;
}

function guardWrite(stream, sanitize) {
  if (stream === null || stream === undefined || typeof stream.write !== 'function') return null;
  const originalWrite = stream.write.bind(stream);
  const guarded = function guardedWrite(chunk, encoding, callback) {
    let enc = encoding;
    let cb = callback;
    if (typeof enc === 'function') {
      cb = enc;
      enc = undefined;
    }
    const text = Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
    return originalWrite(sanitize(text), enc, cb);
  };
  return { guarded, restore: () => { stream.write = originalWrite; } };
}

/**
 * Wrap `process.stdout.write` and `process.stderr.write` so every write is
 * privacy-sanitized. Returns a `restore()` function. Idempotent per stream.
 */
export function installSanitizedStdio({ out = process.stdout, err = process.stderr, sanitize = sanitizeText } = {}) {
  const restored = [];
  const install = (stream) => {
    if (!isGuarded(stream, sanitize)) {
      const wrapped = guardWrite(stream, sanitize);
      if (wrapped !== null) {
        stream.write = wrapped.guarded;
        restored.push(wrapped.restore);
      }
    }
  };
  install(out);
  install(err);
  return Object.freeze({
    restore() {
      for (const restore of restored.splice(0)) restore();
    },
  });
}

/**
 * Create a privacy-safe diagnostic reporter bound to the given streams.
 * Every method writes a single sanitized line; `error` writes to stderr.
 */
export function createReporter({
  out = process.stdout,
  err = process.stderr,
  sanitize = sanitizeText,
} = {}) {
  const writeOut = (line) => {
    out.write(`${sanitize(String(line))}\n`);
  };
  const writeErr = (line) => {
    err.write(`${sanitize(String(line))}\n`);
  };
  return Object.freeze({
    info(line) { writeOut(line); },
    phase(line) { writeOut(line); },
    progress(line) { writeOut(line); },
    observation(line) { writeOut(line); },
    note(line) { writeOut(line); },
    inferred(line) { writeOut(line); },
    coverage(line) { writeOut(line); },
    error(line) { writeErr(line); },
    warning(line) { writeErr(line); },
  });
}

export const DEFAULT_REPORTER = createReporter();
