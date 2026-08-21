// Shared comment counter — the single source of truth for comment density.
//
// Used by conventions.mjs (T108) and documentation.mjs (T111) so the two deep
// scanners agree exactly on comment-line counts for the same source sample.
//
// Ecosystem-aware:
//   python     -> `#` line comments + triple-quoted `"""`/`'''` docstring blocks
//   rust       -> `//`/`///`/`//!` line comments + (nested) `/* */` blocks
//   javascript -> `//` line comments + `/* */` blocks (incl. JSDoc `/**`)
//   typescript -> same as javascript
//   shell      -> `#` line comments
//
// ESM only. Zero npm deps. node: builtins only. Pure function (no FS access).

import { deepFreeze } from "../contracts/evidence.mjs";
import { createProviderResult } from "../providers/base.mjs";

/**
 * Count comment lines in a source text for a given ecosystem.
 *
 * @param {string} text - full source text of a single file.
 * @param {'python'|'javascript'|'typescript'|'rust'|'shell'} ecosystem
 * @returns {{ commentLines: number, totalLines: number, blankLines: number }}
 *   - `commentLines`: non-blank lines that are comments (blank lines are never
 *     counted as comments).
 *   - `totalLines`: NON-BLANK line count (the denominator documentation.mjs
 *     uses; blanks excluded from numerator AND denominator).
 *   - `blankLines`: blank line count.
 */
export function countComments(text, ecosystem) {
  const src = text == null ? "" : String(text);
  const lines = src.split("\n");
  switch (ecosystem) {
    case "python":
      return countPython(lines);
    case "rust":
      return countSlashStyle(lines, true);
    case "javascript":
    case "typescript":
      return countSlashStyle(lines, false);
    case "shell":
      return countHash(lines);
    default:
      return { commentLines: 0, totalLines: 0, blankLines: 0 };
  }
}

// ---------------------------------------------------------------------------
// Shell — `#` line comments
// ---------------------------------------------------------------------------

function countHash(lines) {
  let commentLines = 0;
  let totalLines = 0;
  let blankLines = 0;
  for (const raw of lines) {
    if (raw.trim() === "") {
      blankLines++;
      continue;
    }
    totalLines++;
    if (raw.trim().startsWith("#")) commentLines++;
  }
  return { commentLines, totalLines, blankLines };
}

// ---------------------------------------------------------------------------
// Python — `#` line comments + triple-quoted `"""`/`'''` blocks
// ---------------------------------------------------------------------------

// Ported from documentation.mjs countPythonComments (T108 extraction target).
// Tracks open/close across lines so multi-line docstrings are fully counted.
function countPython(lines) {
  let commentLines = 0;
  let totalLines = 0;
  let blankLines = 0;
  let inDoc = null;

  for (const line of lines) {
    if (line.trim() === "") {
      blankLines++;
      continue;
    }
    totalLines++;

    if (inDoc) {
      commentLines++;
      if (line.includes(inDoc)) inDoc = null;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      commentLines++;
      continue;
    }

    const dq = line.indexOf('"""');
    const sq = line.indexOf("'''");
    if (dq !== -1 && (sq === -1 || dq < sq)) {
      commentLines++;
      if (!line.slice(dq + 3).includes('"""')) inDoc = '"""';
    } else if (sq !== -1) {
      commentLines++;
      if (!line.slice(sq + 3).includes("'''")) inDoc = "'''";
    }
  }

  return { commentLines, totalLines, blankLines };
}

// ---------------------------------------------------------------------------
// JS/TS/Rust — `//` line comments + `/* */` block comments (nestable for Rust)
// ---------------------------------------------------------------------------

// `nest` true => Rust (block comments nest); false => JS/TS (do not nest).
// A line counts as a comment line when, after leading whitespace, it begins
// with a comment marker (`//`, `/*`, `*/`, `*`) OR it is wholly inside an
// open block comment. This matches the line-level heuristic documentation.mjs
// already used for JS/TS while adding proper multi-line block awareness.
function countSlashStyle(lines, nest) {
  let commentLines = 0;
  let totalLines = 0;
  let blankLines = 0;
  let depth = 0;

  for (const raw of lines) {
    if (raw.trim() === "") {
      blankLines++;
      continue;
    }
    totalLines++;

    const startedInBlock = depth > 0;
    const trimmed = raw.trim();
    if (
      startedInBlock ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*/") ||
      trimmed.startsWith("*")
    ) {
      commentLines++;
    }

    // Update block-comment depth by scanning the raw line for `/*` and `*/`.
    // For non-nesting languages depth never exceeds 1, but clamping to >= 0
    // keeps a stray `*/` from going negative.
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "/" && raw[i + 1] === "*") {
        depth++;
        i++;
      } else if (raw[i] === "*" && raw[i + 1] === "/") {
        depth = Math.max(0, depth - 1);
        i++;
      }
    }
    // For non-nesting languages, a single `/* */` pair on one line opens then
    // closes (depth returns to 0) — correct. A second `/*` before a close on
    // the same line in JS/TS is invalid anyway, so clamping is safe.
    if (!nest && depth > 1) depth = 1;
  }

  return { commentLines, totalLines, blankLines };
}

// ---------------------------------------------------------------------------
// T210 provider contribution point
// ---------------------------------------------------------------------------
// `commentObservations` / `commentProviderResult` expose the shared comment
// counter as inert provider observations. They are ADDITIVE: `countComments`
// is unchanged, so the focused comments tests stay byte-identical. The
// observation details carry exactly the counts `countComments` returns.

function commentObservation(counted, path) {
  return {
    category: "comment",
    path,
    matchedKey: `comment:${path ?? "repository"}`,
    details: {
      commentLines: counted.commentLines,
      totalLines: counted.totalLines,
      blankLines: counted.blankLines,
    },
    sourceKind: "source",
  };
}

/**
 * Derive a provider observation from the shared comment counter. Pure and
 * deterministic; never throws.
 * @param {object} input - `{ ecosystem, text, path? }`.
 * @returns {object[]} `[{ dimensionId, observations }]` (frozen).
 */
export function commentObservations({ ecosystem, text, path = null } = {}) {
  const counted = countComments(text, ecosystem);
  return deepFreeze([
    {
      dimensionId: "DIM-conventions-v1",
      observations: [commentObservation(counted, path)],
    },
  ]);
}

/**
 * Build an immutable provider result from the comment counter. Inert:
 * consumed only by tests and future provider catalogs.
 * @param {object} input - `{ ecosystem, text, path? }`.
 * @returns {object[]} Deep-frozen provider results.
 */
export function commentProviderResult({ ecosystem, text, path = null } = {}) {
  const provider = `PRV-comments-${ecosystem}-v1`;
  return commentObservations({ ecosystem, text, path }).map(({ dimensionId, observations }) =>
    createProviderResult({ providerId: provider, dimensionId, observations }),
  );
}
