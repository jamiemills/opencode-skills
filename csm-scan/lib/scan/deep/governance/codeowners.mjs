// CODEOWNERS parser — supported dialect subset with last-match semantics.
//
// T215 owns this module. It parses CODEOWNERS documents into a bounded,
// deterministic, data-only rule list. Raw owner identities are returned only
// for the model builder to convert into opaque report-local labels; they are
// never persisted, rendered, or exposed through any output surface.
//
// Supported pattern subset (GitHub-compatible closed subset):
//   - `*`        matches any path (the default rule)
//   - `*.ext`    matches any file whose name ends in `.ext` at any depth
//   - `dir/`     matches any directory named `dir` and everything beneath it
//   - `/dir/`    matches the `dir` directory anchored at the repository root
//   - `dir`      matches a file or directory named `dir`
//   - `/path`    matches the path anchored at the repository root
//   - `docs/*`   matches entries directly inside any directory named `docs`
//   - `**/x`     matches `x` in zero or more directories
//   - `?`        matches one path-segment character
//   - `\ ` and `\#` escape a space and a hash inside a path
//   - owner tokens are `@user`, `@org/team`, or `user@example.com`
//
// Unsupported forms become per-line diagnostics, never whole-file failures:
// negation (`!`), character classes, `..` segments, empty patterns, patterns
// without owners, and unrecognized owner tokens.
//
// Last-match semantics: for a given path the LAST matching rule in file order
// wins; duplicate patterns are shadowed by their last occurrence. Patterns are
// normalized to a privacy-safe repo-relative display form (the leading root
// anchor slash is stripped and retained as an `anchored` boolean) so records
// survive the T206 privacy gate.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none).
//
// Source-policy note (T201): this module imports only the evidence contracts;
// it never touches node:fs / node:child_process / node:process / node:vm /
// node:module.

import { compareAscii, deepFreeze } from "../../contracts/evidence.mjs";

export const CODEOWNERS_DIALECT = "codeowners";
export const CODEOWNERS_MAX_LINE = 512;
export const CODEOWNERS_MAX_PATTERN = 200;

const OWNER_INDIVIDUAL = /^@[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})$/;
const OWNER_TEAM = /^@[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})\/[A-Za-z0-9-]{1,39}$/;
const OWNER_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const COMPILED_CACHE = new Map();
const COMPILED_CACHE_MAX = 512;

export function isOwnerToken(token) {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    token.length <= 128 &&
    (OWNER_INDIVIDUAL.test(token) || OWNER_TEAM.test(token) || OWNER_EMAIL.test(token))
  );
}

function escapeRegex(ch) {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function translateBody(body) {
  let out = "";
  for (let index = 0; index < body.length; index++) {
    const ch = body[index];
    if (ch === "\\") {
      const next = body[index + 1];
      if (next === undefined) return null;
      out += escapeRegex(next);
      index++;
    } else if (ch === "*") {
      if (body[index + 1] === "*") {
        index++;
        if (body[index + 1] === "/") {
          index++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "!") {
      return null;
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

/**
 * Compile a raw CODEOWNERS pattern into a matching RegExp, or null when the
 * pattern is outside the supported subset.
 * @param {string} raw - the raw pattern token as authored.
 * @returns {RegExp | null}
 */
export function compilePattern(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > CODEOWNERS_MAX_PATTERN)
    return null;
  const cached = COMPILED_CACHE.get(raw);
  if (cached !== undefined) return cached;
  let compiled = null;
  if (raw[0] !== "!" && !raw.includes("\n") && !raw.includes("\t")) {
    const anchored = raw[0] === "/";
    let body = anchored ? raw.slice(1) : raw;
    const dirOnly = body.endsWith("/");
    if (dirOnly) body = body.slice(0, -1);
    if (body.length > 0 && !body.split("/").includes("..")) {
      const translated = translateBody(body);
      if (translated !== null) {
        try {
          const prefix = anchored ? "^" : "^(?:.*/)?";
          const suffix = dirOnly ? "(?:/.*)?$" : "$";
          compiled = new RegExp(`${prefix}${translated}${suffix}`);
        } catch {
          compiled = null;
        }
      }
    }
  }
  if (compiled !== null && COMPILED_CACHE.size >= COMPILED_CACHE_MAX) COMPILED_CACHE.clear();
  if (compiled !== null) COMPILED_CACHE.set(raw, compiled);
  return compiled;
}

/**
 * Test a raw pattern against a repository-relative path.
 * @param {string} pattern - the raw pattern token.
 * @param {string} path - a normalized repository-relative path.
 * @returns {boolean}
 */
export function patternMatches(pattern, path) {
  if (typeof path !== "string" || path.length === 0) return false;
  const compiled = compilePattern(pattern);
  return compiled !== null && compiled.test(path);
}

function splitCodeownersTokens(raw) {
  const tokens = [];
  let current = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const ch = raw[index];
    if (escaped) {
      current += `\\${ch}`;
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (escaped) return [];
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function normalizedRule(pattern, owners, line) {
  const anchored = pattern.startsWith("/");
  const display = anchored ? pattern.slice(1) : pattern;
  return { pattern: display, anchored, owners, line };
}

/**
 * Parse a CODEOWNERS document.
 *
 * Malformed lines produce diagnostics while valid rules are retained; a
 * malformed document never erases the valid evidence it contains.
 *
 * @param {string} text - the CODEOWNERS document text.
 * @param {string} filePath - the repository-relative file path.
 * @returns {object} `{ dialect, rules, diagnostics, malformedLines, patterns }`
 *   where `rules` are data-only `{ pattern, anchored, owners, line }` records.
 *   `owners` holds raw identities for the model builder only.
 */
export function parseCodeowners(text, filePath) {
  if (typeof text !== "string") throw new TypeError("parseCodeowners requires text");
  if (typeof filePath !== "string" || filePath.length === 0)
    throw new TypeError("parseCodeowners requires a path");
  const lines = text.split(/\r?\n/);
  const rules = [];
  const diagnostics = [];
  let malformedLines = 0;

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const raw = lines[index];
    if (raw.length > CODEOWNERS_MAX_LINE) {
      malformedLines++;
      diagnostics.push({
        path: filePath,
        line: lineNo,
        status: "unverified",
        reason: "MALFORMED_LINE",
      });
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tokens = splitCodeownersTokens(raw);
    if (tokens.length === 0) {
      malformedLines++;
      diagnostics.push({
        path: filePath,
        line: lineNo,
        status: "unverified",
        reason: "MALFORMED_LINE",
      });
      continue;
    }
    const pattern = tokens[0];
    const ownerTokens = tokens.slice(1);
    if (compilePattern(pattern) === null) {
      malformedLines++;
      diagnostics.push({
        path: filePath,
        line: lineNo,
        status: "unsupported",
        reason: "PATTERN_UNSUPPORTED",
      });
      continue;
    }
    if (ownerTokens.length === 0) {
      malformedLines++;
      diagnostics.push({ path: filePath, line: lineNo, status: "unverified", reason: "NO_OWNERS" });
      continue;
    }
    const owners = [];
    let ownerMalformed = false;
    for (const token of ownerTokens) {
      if (isOwnerToken(token)) owners.push(token);
      else ownerMalformed = true;
    }
    if (owners.length === 0) {
      malformedLines++;
      diagnostics.push({
        path: filePath,
        line: lineNo,
        status: "unverified",
        reason: "OWNER_UNSUPPORTED",
      });
      continue;
    }
    if (ownerMalformed) {
      malformedLines++;
      diagnostics.push({
        path: filePath,
        line: lineNo,
        status: "unverified",
        reason: "PARTIAL_OWNERS",
      });
    }
    rules.push(normalizedRule(pattern, owners, lineNo));
  }

  const seen = new Set();
  const finalRules = [];
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    const key = `${rule.anchored ? "/" : ""}${rule.pattern}`;
    if (!seen.has(key)) {
      seen.add(key);
      finalRules.push(rule);
    }
  }
  finalRules.reverse();

  diagnostics.sort(
    (left, right) =>
      compareAscii(left.path, right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareAscii(left.reason, right.reason),
  );

  return deepFreeze({
    dialect: CODEOWNERS_DIALECT,
    rules: deepFreeze(finalRules),
    diagnostics: deepFreeze(diagnostics),
    malformedLines,
    patterns: finalRules.length,
  });
}

/**
 * Resolve the owners for a path using last-match semantics.
 * @param {string} path - a repository-relative path.
 * @param {object[]} rules - parsed rules (`{ pattern, anchored, owners, line }`).
 * @returns {string[]} the raw owner identities of the last matching rule.
 */
export function resolveOwners(path, rules) {
  let winner = null;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const raw = `${rule.anchored ? "/" : ""}${rule.pattern}`;
    if (patternMatches(raw, path)) winner = rule;
  }
  return winner === null ? [] : winner.owners;
}

/**
 * Owners of the last default (`*`) rule, if any.
 * @param {object[]} rules - parsed rules.
 * @returns {string[]} raw owner identities of the default rule.
 */
export function defaultOwners(rules) {
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if (rule && !rule.anchored && rule.pattern === "*") return rule.owners;
  }
  return [];
}
