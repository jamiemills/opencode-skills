// Maintainability dimension — lexical tokenizer.
//
// T214 owns this module. It is a pure, bounded, dialect-aware lexical
// tokenizer for the five built-in languages (python, javascript, typescript,
// rust, shell). It strips comments and string/heredoc/template regions, emits
// deterministic normalized tokens (string literals become `STR`, numeric
// literals `NUM`), and derives a disclosed lexical branch-point approximation
// from keyword tokens. It also provides disclosed per-function scope tracking
// (brace/indent nesting) and per-function cyclomatic counting for all five
// dialects (`detectFunctionScopes`/`countFunctionComplexity`). It never parses
// semantics and never emits literal content, so it is privacy-safe by
// construction.
//
// Guarantees:
//   - Deterministic: identical `text` + `dialect` produce identical tokens.
//   - Bounded: emission stops at `MAX_TOKENS_PER_FILE` and reports
//     `truncated`; truncated files are flagged so their counts are never
//     treated as complete.
//   - Approximate by design (disclosed): regex literals, template-literal
//     `${...}` regions, shell `${...}` expansions and heredoc bodies are not
//     parsed semantically; the branch counts are keyword-token counts, not
//     semantic branch counts. Multi-char operators (`?.`, `??`, `??=`) keep
//     ternary counting limited to standalone `?` tokens.
//
// ESM only. Zero npm deps. node: builtins only (imported here: none). Pure
// DATA; no filesystem, network, child-process, or executable access.
//
// Source-policy note (T201): this module imports nothing beyond shared
// constants and never touches node:fs / node:child_process / node:process /
// node:vm / node:module, so the recurring capability gate remains closed.

export const DIALECTS = Object.freeze([
  'python',
  'javascript',
  'typescript',
  'rust',
  'shell',
]);

export const BRANCH_CATEGORIES = Object.freeze([
  'if',
  'else',
  'switch',
  'case',
  'match',
  'ternary',
  'loop',
  'guard',
]);

export const DIALECT_EXTENSIONS = Object.freeze({
  python: ['.py', '.pyi'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  rust: ['.rs'],
  shell: ['.sh', '.bash', '.zsh'],
});

export const MAX_TOKENS_PER_FILE = 16_000;

export const DIALECT_BRANCH_KEYWORDS = Object.freeze({
  python: {
    if: ['if'],
    else: ['else', 'elif'],
    switch: [],
    case: ['case'],
    match: ['match'],
    ternary: [],
    loop: ['for', 'while'],
    guard: [],
  },
  javascript: {
    if: ['if'],
    else: ['else'],
    switch: ['switch'],
    case: ['case'],
    match: [],
    ternary: ['?'],
    loop: ['for', 'while', 'do'],
    guard: [],
  },
  typescript: {
    if: ['if'],
    else: ['else'],
    switch: ['switch'],
    case: ['case'],
    match: [],
    ternary: ['?'],
    loop: ['for', 'while', 'do'],
    guard: [],
  },
  rust: {
    if: ['if'],
    else: ['else'],
    switch: [],
    case: [],
    match: ['match'],
    ternary: ['?'],
    loop: ['for', 'while', 'loop'],
    guard: [],
  },
  shell: {
    if: ['if'],
    else: ['else', 'elif'],
    switch: [],
    case: ['case'],
    match: [],
    ternary: [],
    loop: ['for', 'while', 'until'],
    guard: [],
  },
});

export const DIALECT_BOOLEAN_OPERATORS = Object.freeze({
  python: Object.freeze(['and', 'or']),
  javascript: Object.freeze(['&&', '||']),
  typescript: Object.freeze(['&&', '||']),
  rust: Object.freeze(['&&', '||']),
  shell: Object.freeze(['&&', '||']),
});

// Control-structure keywords whose `(` ... `)` is a control guard rather than
// a function parameter list, so the method heuristic never treats `if (x) {`,
// `for (...) {`, `switch (...) {`, or `catch (...) {` as a function body.
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
  'new', 'delete', 'void', 'in', 'of', 'instanceof', 'throw', 'do', 'else',
  'case', 'default', 'await', 'yield', 'class', 'extends', 'export', 'import',
]);

const MAX_FUNCTION_NAME_LENGTH = 64;
const ANONYMOUS_FUNCTION_LABEL = 'anonymous';

// Identifier-ish pseudo-names that can never open a function body are rejected
// by the method heuristic (a `(` is not a name; a digit cannot start a name).
const NAME_TOKEN_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A bounded, disclosed function-name label: repository identifiers that exceed
// the ASCII/width bounds are disclosed as the fixed `anonymous` sentinel so the
// model gate can never abort on an unusual function name.
function disclosedFunctionName(value) {
  if (typeof value !== 'string' || value.length === 0
      || value.length > MAX_FUNCTION_NAME_LENGTH || /[^\x20-\x7e]/.test(value)) {
    return ANONYMOUS_FUNCTION_LABEL;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-function scope tracking and cyclomatic counting
//
// The existing file-level branch counts (`countBranchPoints`) stay byte
// identical. These helpers add a disclosed per-function approximation on top:
// a function scope is opened by `function`/arrows/methods (javascript,
// typescript), `fn`/closures (rust), `def` blocks (python, by indentation),
// and `name() {` / `function name {` (shell). Cyclomatic complexity for a
// scope is the count of branch-keyword tokens plus boolean operators
// (`&&`, `||`, `and`, `or`) inside it. Each token is assigned to the deepest
// enclosing scope so nested functions never double-count.
// ---------------------------------------------------------------------------

function isBlankOrCommentLine(line) {
  const stripped = line.trim();
  return stripped.length === 0 || stripped.startsWith('#');
}

function leadingWhitespace(line) {
  let index = 0;
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index++;
  return index;
}

// Per-line indentation of code lines only (blank and comment-only lines never
// terminate a python block, so they are omitted from the block-boundary scan).
function pythonCodeIndents(text) {
  const lines = String(text).split(/\r?\n/);
  const indents = new Map();
  for (let index = 0; index < lines.length; index++) {
    if (isBlankOrCommentLine(lines[index])) continue;
    indents.set(index + 1, leadingWhitespace(lines[index]));
  }
  return indents;
}

function previousTokenValue(tokens, index) {
  return index > 0 ? tokens[index - 1].value : undefined;
}

// Detect function scopes from a token stream. Returns
// `[{ functionName, startLine, endLine }]` sorted by `startLine`.
export function detectFunctionScopes(tokens, text, dialect) {
  const stream = Array.isArray(tokens) ? tokens : [];
  const source = String(text ?? '');

  // Python: `def` statements plus the following indented block.
  if (dialect === 'python') {
    const indents = pythonCodeIndents(source);
    const definitions = new Map();
    for (let index = 0; index < stream.length; index++) {
      if (stream[index].value !== 'def') continue;
      const nameToken = stream[index + 1];
      const functionName = nameToken !== undefined && nameToken.line === stream[index].line
        ? disclosedFunctionName(nameToken.value) : ANONYMOUS_FUNCTION_LABEL;
      definitions.set(stream[index].line, functionName);
    }
    const lines = source.split(/\r?\n/);
    const scopes = [];
    const entries = [...definitions.entries()].sort((left, right) => left[0] - right[0]);
    for (const [defLine, functionName] of entries) {
      const defIndent = indents.get(defLine) ?? 0;
      let endLine = defLine;
      for (let line = defLine + 1; line <= lines.length; line++) {
        if (!indents.has(line)) continue;
        if (indents.get(line) > defIndent) endLine = line;
        else break;
      }
      scopes.push({ functionName, startLine: defLine, endLine });
    }
    return scopes;
  }

  // Brace-based dialects (javascript, typescript, rust, shell).
  const scopes = [];
  const opens = [];
  let braceDepth = 0;
  let parenDepth = 0;
  const parenStack = [];
  let lastParenInfo = null;
  let pendingFunction = false;
  let pendingFunctionLine = 0;
  let pendingFunctionName = undefined;
  let pendingArrow = false;
  let pendingArrowLine = 0;
  let arrowDepth = 0;
  let arrowParenDepth = 0;
  let barOpen = false;
  let barOpenLine = 0;
  let pendingBarBody = false;
  let pendingBarLine = 0;

  const openScope = (functionName, headerLine, depth) => {
    opens.push({
      braceDepth: depth,
      functionName,
      startLine: headerLine,
      endLine: headerLine,
    });
  };

  const closeScopeAt = (tokenLine) => {
    for (let index = opens.length - 1; index >= 0; index--) {
      if (opens[index].braceDepth === braceDepth) {
        scopes.push({ ...opens[index], endLine: tokenLine });
        opens.splice(index, 1);
        return;
      }
    }
  };

  // Look back from a `{` for the nearest `)` closing a parameter list, skipping
  // return-type annotation tokens so `area(): number {` and `get value() {`
  // are recognised as method bodies. Returns -1 when no parameter list precedes
  // the brace.
  const paramCloseBeforeBrace = (index) => {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const value = stream[cursor].value;
      if (value === ')') return cursor;
      if (value === ';' || value === '{' || value === '}' || value === '\n') return -1;
      if (value === ':' || value === '?' || value === ',' || value === '>' || value === '<'
          || value === '[' || value === ']' || value === '&' || value === '|'
          || value === '=>' || value === 'function') continue;
      if (NAME_TOKEN_PATTERN.test(value) && !CONTROL_KEYWORDS.has(value)) continue;
      return -1;
    }
    return -1;
  };

  for (let index = 0; index < stream.length; index++) {
    const token = stream[index];
    const value = token.value;

    // Shell `name() {` or `function name {`.
    if (dialect === 'shell' && value === ')') {
      if (previousTokenValue(stream, index) === '(') {
        let name = undefined;
        for (let cursor = index - 1; cursor >= 0; cursor--) {
          const candidate = stream[cursor].value;
          if (candidate === '(' || candidate === ')' || candidate === ';') continue;
          name = candidate;
          break;
        }
        if (name !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          pendingFunction = true;
          pendingFunctionLine = token.line;
          pendingFunctionName = disclosedFunctionName(name);
        }
      }
      continue;
    }

    if (value === '(') {
      parenDepth++;
      parenStack.push({ previous: previousTokenValue(stream, index) });
      continue;
    }
    if (value === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      lastParenInfo = parenStack.pop() ?? { previous: undefined };
      continue;
    }
    if (value === '{') {
      braceDepth++;
      if (dialect === 'shell' && pendingFunction) {
        openScope(pendingFunctionName ?? ANONYMOUS_FUNCTION_LABEL, pendingFunctionLine, braceDepth);
        pendingFunction = false;
        pendingFunctionName = undefined;
        continue;
      }
      if (dialect === 'javascript' || dialect === 'typescript') {
        if (pendingFunction) {
          openScope(pendingFunctionName ?? ANONYMOUS_FUNCTION_LABEL, pendingFunctionLine, braceDepth);
          pendingFunction = false;
          pendingFunctionName = undefined;
          continue;
        }
        if (pendingArrow) {
          // A `{` directly after `=>` is the arrow block body. A `{` after `(`
          // is an object literal inside an expression-bodied arrow (kept); a
          // JSX container after `>`/`=` is part of the arrow expression
          // (kept). A `{` opening a fresh statement's control block clears the
          // pending arrow so a semicolon-less arrow cannot leak a false scope.
          const previous = previousTokenValue(stream, index);
          if (previous === '=>') {
            openScope(ANONYMOUS_FUNCTION_LABEL, pendingArrowLine, braceDepth);
            pendingArrow = false;
            continue;
          }
          if (previous === ')' || previous === 'else' || previous === 'do'
              || previous === 'try' || previous === 'finally' || previous === ';') {
            pendingArrow = false;
          }
          continue;
        }
        const closeIndex = paramCloseBeforeBrace(index);
        if (closeIndex !== -1 && lastParenInfo !== null
            && lastParenInfo.previous !== undefined
            && NAME_TOKEN_PATTERN.test(lastParenInfo.previous)
            && !CONTROL_KEYWORDS.has(lastParenInfo.previous)) {
          openScope(
            disclosedFunctionName(lastParenInfo.previous),
            stream[closeIndex].line,
            braceDepth,
          );
          continue;
        }
        continue;
      }
      if (dialect === 'rust') {
        if (pendingFunction) {
          openScope(pendingFunctionName ?? ANONYMOUS_FUNCTION_LABEL, pendingFunctionLine, braceDepth);
          pendingFunction = false;
          pendingFunctionName = undefined;
          continue;
        }
        if (pendingBarBody) {
          openScope(ANONYMOUS_FUNCTION_LABEL, pendingBarLine, braceDepth);
          pendingBarBody = false;
          continue;
        }
        continue;
      }
      continue;
    }
    if (value === '}') {
      closeScopeAt(token.line);
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (dialect === 'javascript' || dialect === 'typescript') {
      if (value === 'function') {
        pendingFunction = true;
        pendingFunctionLine = token.line;
        pendingFunctionName = undefined;
        const nameToken = stream[index + 1];
        if (nameToken !== undefined && nameToken.line === token.line
            && nameToken.value !== '*' && nameToken.value !== '(') {
          pendingFunctionName = disclosedFunctionName(nameToken.value);
        }
        continue;
      }
      if (value === '=>') {
        pendingArrow = true;
        pendingArrowLine = token.line;
        arrowDepth = braceDepth;
        arrowParenDepth = parenDepth;
        continue;
      }
      if (pendingArrow && (value === ';' || value === ',')
          && braceDepth <= arrowDepth && parenDepth <= arrowParenDepth) {
        scopes.push({
          functionName: ANONYMOUS_FUNCTION_LABEL,
          startLine: pendingArrowLine,
          endLine: token.line,
        });
        pendingArrow = false;
      }
      if (pendingFunction && value === ';') {
        pendingFunction = false;
        pendingFunctionName = undefined;
      }
      continue;
    }

    if (dialect === 'rust') {
      if (value === 'fn') {
        pendingFunction = true;
        pendingFunctionLine = token.line;
        const nameToken = stream[index + 1];
        pendingFunctionName = nameToken !== undefined && nameToken.line === token.line
          ? disclosedFunctionName(nameToken.value) : ANONYMOUS_FUNCTION_LABEL;
        continue;
      }
      if (value === '|') {
        if (barOpen) {
          pendingBarBody = true;
          pendingBarLine = barOpenLine;
          barOpen = false;
        } else {
          barOpen = true;
          barOpenLine = token.line;
        }
        continue;
      }
    }

    if (dialect === 'shell' && value === 'function') {
      pendingFunction = true;
      pendingFunctionLine = token.line;
      const nameToken = stream[index + 1];
      pendingFunctionName = nameToken !== undefined && nameToken.line === token.line
        ? disclosedFunctionName(nameToken.value) : ANONYMOUS_FUNCTION_LABEL;
      continue;
    }
  }

  // Flush any scopes left open by truncated or malformed input, bounded by the
  // last emitted token so an unclosed brace cannot swallow the rest of a file.
  const lastLine = stream.length > 0 ? stream[stream.length - 1].line : 0;
  for (const open of opens) {
    scopes.push({ ...open, endLine: open.endLine > lastLine ? lastLine : open.endLine });
  }

  return scopes.sort((left, right) => left.startLine - right.startLine
    || left.endLine - right.endLine
    || (left.functionName < right.functionName ? -1 : left.functionName > right.functionName ? 1 : 0));
}

// Index of the deepest scope (smallest line span) containing `line`, or -1.
function deepestScopeIndex(line, scopes) {
  let best = -1;
  let bestSpan = Infinity;
  for (let index = 0; index < scopes.length; index++) {
    const scope = scopes[index];
    if (line < scope.startLine || line > scope.endLine) continue;
    const span = scope.endLine - scope.startLine;
    if (span < bestSpan) {
      best = index;
      bestSpan = span;
    }
  }
  return best;
}

/**
 * Count per-function cyclomatic complexity for one source text.
 *
 * @param {string} text - source content.
 * @param {string} dialect - one of `DIALECTS`.
 * @param {object[]} [tokens] - optional pre-tokenized stream from `tokenize`
 *   (used so the scanner counts the identical stream it tokenizes for branch
 *   points); when omitted the text is tokenized internally.
 * @returns {{ functions: object[] }} `{ functions }` where each function is
 *   `{ functionName, startLine, endLine, complexity }` sorted by `startLine`.
 *   Complexity is a disclosed lexical count of branch-keyword tokens plus
 *   boolean operators inside the function scope.
 */
export function countFunctionComplexity(text, dialect, tokens = null) {
  const stream = Array.isArray(tokens) ? tokens : tokenize(String(text ?? ''), dialect).tokens;
  const scopes = detectFunctionScopes(stream, String(text ?? ''), dialect);
  const branch = DIALECT_BRANCH_KEYWORDS[dialect] ?? {};
  const branchWords = new Set(Object.values(branch).flat());
  const booleanWords = new Set(DIALECT_BOOLEAN_OPERATORS[dialect] ?? []);
  const counts = new Array(scopes.length).fill(0);
  for (const token of stream) {
    const scopeIndex = deepestScopeIndex(token.line, scopes);
    if (scopeIndex === -1) continue;
    if (branchWords.has(token.value) || booleanWords.has(token.value)) counts[scopeIndex]++;
  }
  const functions = scopes.map((scope, index) => ({
    functionName: scope.functionName,
    startLine: scope.startLine,
    endLine: scope.endLine,
    complexity: counts[index],
  }));
  return { functions };
}

const IDENT = Object.freeze({
  python: { start: /[A-Za-z_]/, cont: /[A-Za-z0-9_\u0080-\uFFFF]/ },
  javascript: { start: /[A-Za-z_$]/, cont: /[A-Za-z0-9_$\u0080-\uFFFF]/ },
  typescript: { start: /[A-Za-z_$]/, cont: /[A-Za-z0-9_$\u0080-\uFFFF]/ },
  rust: { start: /[A-Za-z_]/, cont: /[A-Za-z0-9_\u0080-\uFFFF]/ },
  shell: { start: /[A-Za-z_]/, cont: /[A-Za-z0-9_\u0080-\uFFFF]/ },
});

const OPERATORS = Object.freeze({
  javascript: Object.freeze([
    '>>>=', '===', '!==', '**=', '&&=', '||=', '??=',
    '>>>', '<<=', '>>=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.',
    '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=',
    '^=', '...',
  ]),
  typescript: Object.freeze([
    '>>>=', '===', '!==', '**=', '&&=', '||=', '??=',
    '>>>', '<<=', '>>=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.',
    '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '&=', '|=',
    '^=', '...',
  ]),
  python: Object.freeze([
    '**=', '//=', '==', '!=', '<=', '>=', '->', ':=', '<<', '>>', '**', '//',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '...',
  ]),
  rust: Object.freeze([
    '...', '..=', '::', '=>', '->', '<-', '==', '!=', '<=', '>=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=', '<<', '>>', '&=', '|=', '^=', '**', '..',
  ]),
  shell: Object.freeze([
    ';;&', '<<-', '<<<', ';;', ';&', '==', '!=', '<=', '>=', '&&', '||',
    '>>', '<<', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '|&',
  ]),
});

const SHELL_COMMENT_PRECEDERS = new Set([';', '|', '&', '(', ')', '{', '}', '<', '>', ' ']);

const REGEX_PREV_ALLOWED = new Set([
  undefined,
  '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%',
  '^', '~', '&&', '||', '??', '=>', '==', '!=', '===', '!==', '&&=', '||=',
  '??=', 'return', 'case', 'in', 'of', 'typeof', 'instanceof', 'void',
  'delete', 'new', 'await', 'yield', 'throw', 'else', 'do',
]);

const MAX_REGEX_LOOKAHEAD = 1024;
const MAX_IDENTIFIER_LENGTH = 128;
const STRING_TOKEN = 'STR';
const NUMBER_TOKEN = 'NUM';

/**
 * Map a repository-relative path to a supported dialect.
 * @param {string} path
 * @returns {string|null} dialect id or null when unsupported.
 */
export function dialectForPath(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  for (const [dialect, extensions] of Object.entries(DIALECT_EXTENSIONS)) {
    if (extensions.includes(ext)) return dialect;
  }
  return null;
}

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Count branch-keyword tokens per branch category for a token stream.
 * The counts are lexical approximations and are disclosed as such.
 * @param {object[]} tokens - tokens from `tokenize`.
 * @param {string} dialect
 * @returns {object} `{ if, else, switch, case, match, ternary, loop, guard }`
 *   with bounded non-negative integer counts.
 */
export function countBranchPoints(tokens, dialect) {
  const keywords = DIALECT_BRANCH_KEYWORDS[dialect] ?? {};
  const counts = Object.fromEntries(BRANCH_CATEGORIES.map((category) => [category, 0]));
  for (const token of tokens) {
    for (const [category, words] of Object.entries(keywords)) {
      if (words.includes(token.value)) counts[category]++;
    }
  }
  return counts;
}

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v';
}

/**
 * Tokenize source text for one supported dialect.
 *
 * @param {string} text - source content.
 * @param {string} dialect - one of `DIALECTS`.
 * @returns {object} `{ tokens, truncated, dialect }` where `tokens` is a
 *   bounded array of `{ value, line }` records and `truncated` is true when
 *   emission stopped at `MAX_TOKENS_PER_FILE`.
 */
export function tokenize(text, dialect) {
  const source = String(text ?? '');
  const config = IDENT[dialect];
  const operators = OPERATORS[dialect] ?? [];
  const tokens = [];
  let truncated = false;
  let i = 0;
  let line = 1;
  let lastPunct = undefined;
  let prevToken = undefined;
  let parenDepth = 0;
  let heredoc = null;
  let heredocStripTabs = false;
  const n = source.length;

  const push = (value) => {
    if (tokens.length >= MAX_TOKENS_PER_FILE) {
      truncated = true;
      return false;
    }
    tokens.push({ value, line });
    prevToken = value;
    lastPunct = value === '' ? lastPunct : value.slice(-1);
    return true;
  };

  const countNewlines = (start, end) => {
    for (let index = start; index < end; index++) {
      if (source[index] === '\n') line++;
    }
  };

  const skipLineComment = () => {
    while (i < n && source[i] !== '\n') i++;
    if (i < n) {
      i++;
      line++;
    }
  };

  const scanString = (quote, raw) => {
    let j = i + 1;
    while (j < n) {
      if (!raw && source[j] === '\\' && j + 1 < n) {
        if (source[j + 1] === '\n') line++;
        j += 2;
        continue;
      }
      if (source[j] === quote) return j + 1;
      if (source[j] === '\n') line++;
      j++;
    }
    return n;
  };

  const scanTripleString = (quote) => {
    let j = i + 3;
    while (j < n) {
      if (source.startsWith(quote + quote + quote, j)) return j + 3;
      if (source[j] === '\\' && j + 1 < n) {
        if (source[j + 1] === '\n') line++;
        j += 2;
        continue;
      }
      if (source[j] === '\n') line++;
      j++;
    }
    return n;
  };

  const scanRawString = (hashes) => {
    let j = i + 1 + hashes + 1;
    const close = '"' + '#'.repeat(hashes);
    while (j < n) {
      if (source.startsWith(close, j)) return j + close.length;
      j++;
    }
    return n;
  };

  const scanTemplate = () => {
    let j = i + 1;
    while (j < n) {
      if (source[j] === '\\' && j + 1 < n) {
        if (source[j + 1] === '\n') line++;
        j += 2;
        continue;
      }
      if (source[j] === '`') return j + 1;
      if (source[j] === '\n') line++;
      j++;
    }
    return n;
  };

  const scanBlockComment = (nested) => {
    let depth = 1;
    let j = i + 2;
    while (j < n) {
      if (nested && source.startsWith('/*', j)) {
        depth++;
        j += 2;
        continue;
      }
      if (source.startsWith('*/', j)) {
        depth--;
        j += 2;
        if (depth === 0) return j;
        continue;
      }
      if (source[j] === '\n') line++;
      j++;
    }
    return n;
  };

  const scanBraceExpansion = () => {
    let depth = 1;
    let j = i + 2;
    while (j < n) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') {
        depth--;
        if (depth === 0) {
          countNewlines(i, j);
          return j + 1;
        }
      } else if (source[j] === '\n') line++;
      j++;
    }
    countNewlines(i, n);
    return n;
  };

  const scanHeredocBody = () => {
    while (i < n) {
      const nl = source.indexOf('\n', i);
      const lineEnd = nl === -1 ? n : nl;
      let content = source.slice(i, lineEnd);
      if (content.endsWith('\r')) content = content.slice(0, -1);
      if (heredocStripTabs) content = content.replace(/^\t+/, '');
      if (content.trimEnd() === heredoc) {
        i = nl === -1 ? n : nl + 1;
        if (nl !== -1) line++;
        heredoc = null;
        return;
      }
      i = nl === -1 ? n : nl + 1;
      if (nl !== -1) line++;
    }
  };

  const readHeredocDelimiter = (dash) => {
    let j = i + 2 + (dash ? 1 : 0);
    while (j < n && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= n) return null;
    if (source[j] === "'" || source[j] === '"') {
      const close = source.indexOf(source[j], j + 1);
      if (close === -1) return null;
      return { delimiter: source.slice(j + 1, close), dash };
    }
    let k = j;
    while (k < n && /[A-Za-z0-9_]/.test(source[k])) k++;
    if (k === j) return null;
    return { delimiter: source.slice(j, k), dash };
  };

  const tryRegexLiteral = () => {
    let j = i + 1;
    let inClass = false;
    while (j < n && j - i < MAX_REGEX_LOOKAHEAD) {
      const c = source[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '\n') return null;
      if (inClass) {
        if (c === ']') inClass = false;
      } else if (c === '[') {
        inClass = true;
      } else if (c === '/') {
        let k = j + 1;
        while (k < n && /[A-Za-z]/.test(source[k])) k++;
        return k;
      }
      j++;
    }
    return null;
  };

  const numberEnd = () => {
    let j = i;
    let hex = false;
    if (source[j] === '0' && (source[j + 1] === 'x' || source[j + 1] === 'X')) {
      hex = true;
      j += 2;
    } else if (source[j] === '0' && (source[j + 1] === 'b' || source[j + 1] === 'B'
        || source[j + 1] === 'o' || source[j + 1] === 'O')) {
      j += 2;
    }
    while (j < n && (hex ? /[0-9a-fA-F_]/.test(source[j]) : /[0-9_]/.test(source[j]))) j++;
    if (!hex && j < n && source[j] === '.' && /[0-9]/.test(source[j + 1] ?? '')) {
      j++;
      while (j < n && /[0-9_]/.test(source[j])) j++;
    }
    if (j < n && (source[j] === 'e' || source[j] === 'E')
        && /[0-9+-]/.test(source[j + 1] ?? '')) {
      j++;
      if (source[j] === '+' || source[j] === '-') j++;
      while (j < n && /[0-9]/.test(source[j])) j++;
    }
    if (dialect === 'rust') {
      while (j < n && /[a-zA-Z]/.test(source[j])) j++;
    }
    return j;
  };

  while (i < n) {
    const ch = source[i];

    if (heredoc !== null) {
      scanHeredocBody();
      continue;
    }

    if (ch === '\n') {
      line++;
      i++;
      lastPunct = undefined;
      continue;
    }
    if (isWhitespace(ch)) {
      lastPunct = ' ';
      i++;
      continue;
    }

    // Comments ---------------------------------------------------------
    if (dialect === 'python' && ch === '#') {
      skipLineComment();
      continue;
    }
    if (dialect === 'shell' && ch === '#') {
      if (lastPunct === undefined || SHELL_COMMENT_PRECEDERS.has(lastPunct)) {
        skipLineComment();
        continue;
      }
    }
    if ((dialect === 'javascript' || dialect === 'typescript' || dialect === 'rust')
        && ch === '/' && source[i + 1] === '/') {
      skipLineComment();
      continue;
    }
    if ((dialect === 'javascript' || dialect === 'typescript' || dialect === 'rust')
        && ch === '/' && source[i + 1] === '*') {
      const end = scanBlockComment(dialect === 'rust');
      i = end;
      continue;
    }

    // Rust char literals and lifetimes ---------------------------------
    if (dialect === 'rust' && ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== "'" && source[j] !== '\n'
          && !isWhitespace(source[j]) && !/[,;>()[\]:{}]/.test(source[j])) j++;
      if (j < n && source[j] === "'" && j > i + 1) {
        countNewlines(i, j + 1);
        if (push(STRING_TOKEN)) i = j + 1;
        else i = n;
        continue;
      }
      i++;
      if (!push("'")) i = n;
      continue;
    }

    // Python string prefixes -------------------------------------------
    if (dialect === 'python' && /[rRbBfFuU]/.test(ch)) {
      let j = i;
      while (j < n && /[rRbBfFuU]/.test(source[j])) j++;
      const prefixed = j - i <= 2 && (source[j] === "'" || source[j] === '"');
      if (prefixed) {
        if (source.startsWith("'''", j) || source.startsWith('"""', j)) {
          const end = scanTripleString(source[j]);
          countNewlines(j, end);
          if (push(STRING_TOKEN)) i = end;
          else i = n;
        } else {
          const end = scanString(source[j], true);
          countNewlines(j, end);
          if (push(STRING_TOKEN)) i = end;
          else i = n;
        }
        continue;
      }
    }

    // Rust raw strings -------------------------------------------------
    if (dialect === 'rust' && ch === 'r') {
      let hashes = 0;
      while (source[i + 1 + hashes] === '#') hashes++;
      if (hashes > 0 && source[i + 1 + hashes] === '"') {
        const end = scanRawString(hashes);
        countNewlines(i, end);
        if (push(STRING_TOKEN)) i = end;
        else i = n;
        continue;
      }
      if (source[i + 1] === '"') {
        const end = scanString('"', true);
        countNewlines(i, end);
        if (push(STRING_TOKEN)) i = end;
        else i = n;
        continue;
      }
    }

    // Strings ----------------------------------------------------------
    if (ch === "'" || ch === '"') {
      if (dialect === 'python' && (source.startsWith("'''", i) || source.startsWith('"""', i))) {
        const end = scanTripleString(ch);
        countNewlines(i, end);
        if (push(STRING_TOKEN)) i = end;
        else i = n;
      } else {
        const end = scanString(ch, false);
        countNewlines(i, end);
        if (push(STRING_TOKEN)) i = end;
        else i = n;
      }
      continue;
    }
    if ((dialect === 'javascript' || dialect === 'typescript') && ch === '`') {
      const end = scanTemplate();
      countNewlines(i, end);
      if (push(STRING_TOKEN)) i = end;
      else i = n;
      continue;
    }

    // Shell regions and expansions -------------------------------------
    if (dialect === 'shell' && ch === '$') {
      if (source[i + 1] === '{') {
        const end = scanBraceExpansion();
        if (push(STRING_TOKEN)) i = end;
        else i = n;
        continue;
      }
      if (source[i + 1] === '(') {
        parenDepth++;
        if (!push('$')) i = n;
        else i++;
        continue;
      }
      if (!push('$')) i = n;
      else i++;
      continue;
    }
    if (dialect === 'shell' && ch === '`') {
      if (!push('`')) i = n;
      else i++;
      continue;
    }
    if (dialect === 'shell' && (ch === '(' || ch === ')')) {
      parenDepth = Math.max(0, parenDepth + (ch === '(' ? 1 : -1));
      if (!push(ch)) i = n;
      else i++;
      continue;
    }
    if (dialect === 'shell' && ch === '<' && parenDepth === 0) {
      let info = null;
      if (source.startsWith('<<-', i)) info = readHeredocDelimiter(true);
      else if (source.startsWith('<<', i) && source[i + 2] !== '<'
          && source[i + 2] !== '=' && source[i + 2] !== '(') info = readHeredocDelimiter(false);
      if (info !== null && info.delimiter.length > 0) {
        heredoc = info.delimiter;
        heredocStripTabs = info.dash;
        const nl = source.indexOf('\n', i);
        i = nl === -1 ? n : nl + 1;
        if (nl !== -1) line++;
        continue;
      }
    }

    // Numbers ----------------------------------------------------------
    if (/[0-9]/.test(ch) || (dialect === 'python' && ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))
        || (dialect === 'shell' && ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const end = numberEnd();
      countNewlines(i, end);
      if (push(NUMBER_TOKEN)) i = end;
      else i = n;
      continue;
    }

    // Identifiers and keywords -----------------------------------------
    if (config.start.test(ch)) {
      let j = i + 1;
      while (j < n && config.cont.test(source[j])) j++;
      const word = source.slice(i, j);
      const bounded = word.length > MAX_IDENTIFIER_LENGTH ? word.slice(0, MAX_IDENTIFIER_LENGTH) : word;
      if (push(bounded)) i = j;
      else i = n;
      continue;
    }

    // Regex literals (javascript/typescript) ---------------------------
    if ((dialect === 'javascript' || dialect === 'typescript') && ch === '/'
        && REGEX_PREV_ALLOWED.has(prevToken)) {
      const end = tryRegexLiteral();
      if (end !== null) {
        i = end;
        continue;
      }
    }

    // Operators (multi-char first) -------------------------------------
    let matched = null;
    for (const operator of operators) {
      if (source.startsWith(operator, i)) {
        matched = operator;
        break;
      }
    }
    if (matched !== null) {
      countNewlines(i, i + matched.length);
      if (push(matched)) i += matched.length;
      else i = n;
      continue;
    }

    // Fallback single-character token ----------------------------------
    countNewlines(i, i + 1);
    if (push(ch)) i++;
    else i = n;
  }

  return { tokens, truncated, dialect };
}

/**
 * Convenience alias retaining the scanner-facing name.
 */
export function tokenizeText(text, dialect) {
  return tokenize(text, dialect);
}

export function sourceBasename(path) {
  return basenameOf(path);
}
