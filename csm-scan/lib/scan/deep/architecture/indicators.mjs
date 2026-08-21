// Static dynamic-architecture indicator detection.
//
// T217 owns this module. It detects literal dynamic import / reflection /
// plugin-loading / codegen / macro constructs across the five built-in
// ecosystems and records them as INDICATORS. It never invents edges:
//
//   - A literal construct (`import('./x')`, `__import__('pkg')`, `include_str!`)
//     is recorded with its bounded literal specifier when the specifier is
//     privacy-safe, otherwise with `specifier: null`.
//   - An unsupported / non-literal construct (`import(someVar)`, `source $DIR`)
//     is still recorded as an indicator with `specifier: null`. It never
//     produces a speculative import edge.
//   - Strings and comments are masked before scanning, so prose that merely
//     mentions a construct is not counted.
//
// Guarantees:
//   - Results are deep-frozen plain data; identical inputs produce
//     byte-identical output.
//   - Only raw facts are emitted: no runtime-behavior claim, no resolution,
//     no quality verdict.
//   - Specifiers are bounded and filtered; absolute paths, whitespace, and
//     control characters are dropped.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports no node:fs /
// node:child_process / node:process / node:vm / node:module.

import { compareAscii, deepFreeze } from "../../contracts/evidence.mjs";

export const INDICATOR_KINDS = deepFreeze([
  "dynamic-import",
  "reflection",
  "plugin-loading",
  "codegen",
  "macro",
]);

export const INDICATOR_LIMITS = deepFreeze({
  specifierLength: 256,
});

const SAFE_SPECIFIER_LENGTH = INDICATOR_LIMITS.specifierLength;

// ---------------------------------------------------------------------------
// Specifier hygiene
// ---------------------------------------------------------------------------

function safeSpecifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > SAFE_SPECIFIER_LENGTH) {
    return null;
  }
  if (value[0] === "/" || /\s/.test(value) || /[\x00-\x1f\x7f]/.test(value)) return null;
  return value;
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

function literalArgument(content, parenIndex) {
  let i = parenIndex;
  while (i < content.length && /\s/.test(content[i])) i++;
  const quote = content[i];
  if (quote !== "'" && quote !== '"') return null;
  i += 1;
  let out = "";
  while (i < content.length) {
    const ch = content[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return safeSpecifier(out);
    if (ch === "\n" || ch === "\r") return null;
    out += ch;
    if (out.length > SAFE_SPECIFIER_LENGTH) return null;
    i += 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Masking helpers (keep code and string delimiters; blank interiors/comments)
// ---------------------------------------------------------------------------

function maskJavaScriptCode(content) {
  const chars = Array.from(content);
  let state = "code";
  let escaped = false;
  const n = chars.length;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (state === "line-comment") {
      if (ch === "\n" || ch === "\r") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (
        (state === "single" && ch === "'") ||
        (state === "double" && ch === '"') ||
        (state === "template" && ch === "`")
      )
        state = "code";
      else if (state === "template" && ch === "$" && next === "{") escaped = false;
      if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    if (ch === '"') {
      state = "double";
      continue;
    }
    if (ch === "`") {
      state = "template";
      continue;
    }
    if (ch === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "block-comment";
      continue;
    }
  }
  return chars.join("");
}

function maskPythonCode(content) {
  const chars = Array.from(content);
  let state = "code";
  const n = chars.length;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    if (state === "line-comment") {
      if (ch === "\n" || ch === "\r") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "triple-double") {
      if (ch === '"' && chars[i + 1] === '"' && chars[i + 2] === '"') {
        chars[i] = " ";
        chars[i + 1] = " ";
        chars[i + 2] = " ";
        i += 2;
        state = "code";
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "triple-single") {
      if (ch === "'" && chars[i + 1] === "'" && chars[i + 2] === "'") {
        chars[i] = " ";
        chars[i + 1] = " ";
        chars[i + 2] = " ";
        i += 2;
        state = "code";
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "double") {
      if (ch === '"') state = "code";
      else if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (state === "single") {
      if (ch === "'") state = "code";
      else if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (ch === "#") {
      chars[i] = " ";
      state = "line-comment";
      continue;
    }
    if (ch === '"') {
      if (chars[i + 1] === '"' && chars[i + 2] === '"') {
        chars[i] = " ";
        chars[i + 1] = " ";
        chars[i + 2] = " ";
        i += 2;
        state = "triple-double";
      } else {
        state = "double";
      }
      continue;
    }
    if (ch === "'") {
      if (chars[i + 1] === "'" && chars[i + 2] === "'") {
        chars[i] = " ";
        chars[i + 1] = " ";
        chars[i + 2] = " ";
        i += 2;
        state = "triple-single";
      } else {
        state = "single";
      }
      continue;
    }
  }
  return chars.join("");
}

function maskRustCode(content) {
  const chars = Array.from(content);
  let state = "code";
  let escaped = false;
  const n = chars.length;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (state === "line-comment") {
      if (ch === "\n" || ch === "\r") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 1;
        state = "code";
      } else if (ch !== "\n" && ch !== "\r") {
        chars[i] = " ";
      }
      continue;
    }
    if (state === "string") {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') state = "code";
      if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (ch === '"') {
      state = "string";
      continue;
    }
    if (ch === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "line-comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 1;
      state = "block-comment";
      continue;
    }
  }
  return chars.join("");
}

function maskShellCode(content) {
  const chars = Array.from(content);
  let state = "code";
  const n = chars.length;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    if (state === "line-comment") {
      if (ch === "\n" || ch === "\r") state = "code";
      else chars[i] = " ";
      continue;
    }
    if (state === "single") {
      if (ch === "'") state = "code";
      else if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (state === "double") {
      if (ch === '"') state = "code";
      else if (ch !== "\n" && ch !== "\r") chars[i] = " ";
      continue;
    }
    if (ch === "#") {
      chars[i] = " ";
      state = "line-comment";
      continue;
    }
    if (ch === "'") {
      state = "single";
      continue;
    }
    if (ch === '"') {
      state = "double";
      continue;
    }
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Per-ecosystem detection
// ---------------------------------------------------------------------------

function collectMatches(source, pattern) {
  const matches = [];
  let match;
  const re = new RegExp(pattern.source, "g");
  while ((match = re.exec(source))) {
    const hasGroup = match[1] !== undefined;
    matches.push({
      index: match.index,
      text: match[0],
      offset: hasGroup ? match.index + match[0].indexOf(match[1]) : match.index,
    });
  }
  return matches;
}

function afterParen(entry) {
  return entry.index + entry.text.length;
}

function detectJavaScriptIndicators(content) {
  const masked = maskJavaScriptCode(content);
  const indicators = [];

  const dynamicImport = collectMatches(masked, /\bimport\s*\(/g);
  for (const entry of dynamicImport) {
    indicators.push({
      kind: "dynamic-import",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const requireResolve = collectMatches(masked, /\brequire\s*\.\s*resolve\s*\(/g);
  for (const entry of requireResolve) {
    indicators.push({
      kind: "reflection",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const requireCall = collectMatches(masked, /\brequire\s*\(/g);
  for (const entry of requireCall) {
    if (requireResolve.some((candidate) => candidate.index === entry.index)) continue;
    indicators.push({
      kind: "dynamic-import",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const importMeta = collectMatches(masked, /\bimport\s*\.\s*meta\b/g);
  for (const entry of importMeta) {
    indicators.push({ kind: "reflection", specifier: null, line: lineOf(content, entry.index) });
  }

  const reflect = collectMatches(masked, /\bReflect\s*\./g);
  for (const entry of reflect) {
    indicators.push({ kind: "reflection", specifier: null, line: lineOf(content, entry.index) });
  }

  const dynamicRequireFactory = collectMatches(masked, /\bcreateRequire\s*\(/g);
  for (const entry of dynamicRequireFactory) {
    indicators.push({
      kind: "plugin-loading",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const evalCall = collectMatches(masked, /\beval\s*\(/g);
  for (const entry of evalCall) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  const functionCall = collectMatches(masked, /\bFunction\s*\(/g);
  for (const entry of functionCall) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  return indicators;
}

function detectPythonIndicators(content) {
  const masked = maskPythonCode(content);
  const indicators = [];

  const importModule = collectMatches(masked, /\b(?:importlib\s*\.\s*)?import_module\s*\(/g);
  for (const entry of importModule) {
    indicators.push({
      kind: "dynamic-import",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const dunderImport = collectMatches(masked, /__import__\s*\(/g);
  for (const entry of dunderImport) {
    indicators.push({
      kind: "dynamic-import",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const machinery = collectMatches(
    masked,
    /importlib\s*\.\s*machinery\b|spec_from_file_location\s*\(|SourceFileLoader\b/g,
  );
  for (const entry of machinery) {
    indicators.push({
      kind: "plugin-loading",
      specifier: entry.text.endsWith("(") ? literalArgument(content, afterParen(entry)) : null,
      line: lineOf(content, entry.index),
    });
  }

  const entryPoints = collectMatches(
    masked,
    /(?:importlib\s*\.\s*(?:metadata\s*\.\s*)?entry_points|pkg_resources\s*\.\s*iter_entry_points)\s*\(/g,
  );
  for (const entry of entryPoints) {
    indicators.push({
      kind: "plugin-loading",
      specifier: null,
      line: lineOf(content, entry.index),
    });
  }

  const findSpec = collectMatches(masked, /importlib\s*\.\s*util\s*\.\s*find_spec\s*\(/g);
  for (const entry of findSpec) {
    indicators.push({
      kind: "plugin-loading",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const getAttr = collectMatches(masked, /\bgetattr\s*\(/g);
  for (const entry of getAttr) {
    indicators.push({ kind: "reflection", specifier: null, line: lineOf(content, entry.index) });
  }

  const evalCall = collectMatches(masked, /\beval\s*\(/g);
  for (const entry of evalCall) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  const execCall = collectMatches(masked, /\bexec\s*\(/g);
  for (const entry of execCall) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  const compileCall = collectMatches(masked, /\bcompile\s*\(/g);
  for (const entry of compileCall) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  return indicators;
}

function detectRustIndicators(content) {
  const masked = maskRustCode(content);
  const indicators = [];

  const include = collectMatches(masked, /include(?:_str|_bytes)?!\s*\(/g);
  for (const entry of include) {
    indicators.push({
      kind: "macro",
      specifier: literalArgument(content, afterParen(entry)),
      line: lineOf(content, entry.index),
    });
  }

  const macroRules = collectMatches(masked, /macro_rules!\s*/g);
  for (const entry of macroRules) {
    indicators.push({ kind: "macro", specifier: null, line: lineOf(content, entry.index) });
  }

  const cfgAttr = collectMatches(masked, /#\[\s*cfg\s*\(/g);
  for (const entry of cfgAttr) {
    indicators.push({ kind: "macro", specifier: null, line: lineOf(content, entry.index) });
  }

  const procMacro = collectMatches(masked, /#\[\s*proc_macro(?:_attribute|_derive)?\b/g);
  for (const entry of procMacro) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  return indicators;
}

function detectShellIndicators(content) {
  const masked = maskShellCode(content);
  const indicators = [];

  const evalCommand = collectMatches(masked, /\beval\s+/g);
  for (const entry of evalCommand) {
    indicators.push({ kind: "codegen", specifier: null, line: lineOf(content, entry.index) });
  }

  const dynamicSource = collectMatches(masked, /(?:^|[\s;&|(])(source|\.)\s+(?=[$"'`]|\$\()/g);
  for (const entry of dynamicSource) {
    indicators.push({
      kind: "dynamic-import",
      specifier: null,
      line: lineOf(content, entry.offset),
    });
  }

  return indicators;
}

/**
 * Detect static dynamic-architecture indicators in one file's content.
 *
 * @param {string} content - File text.
 * @param {string} ecosystem - One of python/javascript/typescript/rust/shell.
 * @returns {object[]} Deep-frozen `{ kind, specifier, line }` records in
 *   deterministic order. Unsupported / non-literal constructs are recorded
 *   with `specifier: null`; they never produce edges.
 */
export function detectDynamicIndicators(content, ecosystem) {
  let indicators;
  if (ecosystem === "javascript" || ecosystem === "typescript") {
    indicators = detectJavaScriptIndicators(String(content));
  } else if (ecosystem === "python") {
    indicators = detectPythonIndicators(String(content));
  } else if (ecosystem === "rust") {
    indicators = detectRustIndicators(String(content));
  } else if (ecosystem === "shell") {
    indicators = detectShellIndicators(String(content));
  } else {
    indicators = [];
  }
  indicators.sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line;
    return compareAscii(left.kind, right.kind);
  });
  const deduped = [];
  for (const indicator of indicators) {
    const prior = deduped[deduped.length - 1];
    if (
      prior &&
      prior.line === indicator.line &&
      prior.kind === indicator.kind &&
      prior.specifier === indicator.specifier
    )
      continue;
    deduped.push(indicator);
  }
  return deepFreeze(deduped);
}
