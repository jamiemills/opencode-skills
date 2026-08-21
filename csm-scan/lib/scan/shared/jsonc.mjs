// JSONC (JSON with comments and trailing commas) scrubbers plus a tolerant
// file reader. Lifted verbatim from the architecture deep scanner so every
// consumer (tsconfig/jsconfig aliases, opencode plugin configs, ...) shares a
// single home. Pure, deterministic, and read-only.

import { readFileSync } from "node:fs";

/**
 * Strip `//` and `/* *\/` comments while preserving string contents and
 * newline positions (a comment line keeps its newline).
 * @param {string} content - raw JSONC source.
 * @returns {string} the source with comments removed.
 */
export function stripJsonComments(content) {
  let out = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      if (i < content.length) out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        if (content[i] === "\n") out += "\n";
        i++;
      }
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Remove trailing commas before `}` and `]` outside string contents.
 * @param {string} content - JSONC source (comments already stripped).
 * @returns {string} the source with trailing commas removed.
 */
export function removeJsonTrailingCommas(content) {
  let out = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (/\s/.test(content[j] || "")) j++;
      if (content[j] === "}" || content[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Read and parse a JSONC file, returning null on any read or parse failure.
 * @param {string} path - absolute file path.
 * @returns {object|null} the parsed document, or null when unreadable.
 */
export function readJsonc(path) {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(removeJsonTrailingCommas(stripJsonComments(content)));
  } catch {
    return null;
  }
}
