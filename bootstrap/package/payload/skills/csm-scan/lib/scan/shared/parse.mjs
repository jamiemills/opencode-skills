// Zero-dependency TOML subset + YAML shallow parser.
// ESM only. No external libraries. Builtins only via callers.
//
// Subset goals:
//   parseToml         -> enough for pyproject.toml / Cargo.toml / ruff.toml
//   parseYamlShallow  -> enough for .github/workflows/*.yml, lefthook.yml, .pre-commit-config.yaml
//
// Discipline: prefer THROWING on unsupported constructs over silent misparse.

// ---------------------------------------------------------------------------
// TOML
// ---------------------------------------------------------------------------

export function parseToml(text) {
  const p = new TomlParser(text);
  return p.parse();
}

class TomlParser {
  constructor(text) {
    this.s = text == null ? "" : String(text);
    this.i = 0;
    this.n = this.s.length;
    this.root = {};
    this.current = this.root;
  }

  error(msg, at = this.i) {
    let line = 1;
    for (let k = 0; k < at && k < this.n; k++) {
      if (this.s[k] === "\n") line++;
    }
    throw new Error(`TOML parse error at line ${line}: ${msg}`);
  }

  atEnd() {
    return this.i >= this.n;
  }
  peek(off = 0) {
    const j = this.i + off;
    return j >= 0 && j < this.n ? this.s[j] : "";
  }
  advance() {
    if (this.i < this.n) return this.s[this.i++];
    return "";
  }
  expect(ch) {
    if (this.peek() !== ch) {
      this.error(`expected ${JSON.stringify(ch)}, got ${JSON.stringify(this.peek())}`);
    }
    return this.advance();
  }
  startsWith(str) {
    return this.s.startsWith(str, this.i);
  }

  // ---- whitespace / comment helpers -------------------------------------

  skipInlineWs() {
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === " " || c === "\t") this.advance();
      else break;
    }
  }
  skipComment() {
    if (this.peek() === "#") {
      while (!this.atEnd() && this.peek() !== "\n" && this.peek() !== "\r") this.advance();
    }
  }
  skipInlineWsAndComments() {
    this.skipInlineWs();
    this.skipComment();
  }
  skipWsCommentsNewlines() {
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.advance();
      else if (c === "#") {
        while (!this.atEnd() && this.peek() !== "\n") this.advance();
      } else break;
    }
  }

  // ---- top level --------------------------------------------------------

  parse() {
    while (!this.atEnd()) {
      this.skipWsCommentsNewlines();
      if (this.atEnd()) break;
      if (this.peek() === "[") {
        this.parseTableHeader();
      } else {
        this.parseKeyValue(this.current);
        this.skipInlineWsAndComments();
        if (!this.atEnd() && this.peek() !== "\n" && this.peek() !== "\r") {
          this.error(`expected newline or EOF after key-value, got ${JSON.stringify(this.peek())}`);
        }
      }
    }
    return this.root;
  }

  // ---- table headers ----------------------------------------------------

  parseTableHeader() {
    this.expect("[");
    const isArray = this.peek() === "[";
    if (isArray) this.expect("[");
    this.skipInlineWs();
    const path = this.parseDottedKey();
    this.skipInlineWs();
    this.expect("]");
    if (isArray) this.expect("]");

    this.current = isArray ? this.navigateArrayTable(path) : this.navigateTable(path);

    this.skipInlineWsAndComments();
    if (!this.atEnd() && this.peek() !== "\n" && this.peek() !== "\r") {
      this.error(`expected newline after table header, got ${JSON.stringify(this.peek())}`);
    }
  }

  navigateTable(path) {
    let node = this.root;
    for (let k = 0; k < path.length; k++) {
      const key = path[k];
      const existing = node[key];
      if (existing === undefined) {
        node[key] = {};
        node = node[key];
      } else if (Array.isArray(existing)) {
        node = existing[existing.length - 1];
      } else if (typeof existing === "object" && existing !== null) {
        node = existing;
      } else {
        this.error(`key ${JSON.stringify(key)} already exists as a non-table value`);
      }
    }
    return node;
  }

  navigateArrayTable(path) {
    let node = this.root;
    for (let k = 0; k < path.length; k++) {
      const key = path[k];
      const isLast = k === path.length - 1;
      const existing = node[key];
      if (isLast) {
        if (!Array.isArray(existing)) {
          if (existing !== undefined) {
            this.error(`key ${JSON.stringify(key)} already exists as a non-array-of-tables`);
          }
          node[key] = [];
        }
        const tbl = {};
        node[key].push(tbl);
        node = tbl;
      } else {
        if (existing === undefined) {
          node[key] = {};
          node = node[key];
        } else if (Array.isArray(existing)) {
          node = existing[existing.length - 1];
        } else if (typeof existing === "object" && existing !== null) {
          node = existing;
        } else {
          this.error(`key ${JSON.stringify(key)} conflicts with non-table value`);
        }
      }
    }
    return node;
  }

  // ---- keys -------------------------------------------------------------

  parseDottedKey() {
    const path = [this.parseSingleKey()];
    while (this.peek() === ".") {
      this.advance();
      this.skipInlineWs();
      path.push(this.parseSingleKey());
      this.skipInlineWs();
    }
    return path;
  }

  parseSingleKey() {
    const c = this.peek();
    if (c === '"') return this.parseBasicString();
    if (c === "'") return this.parseLiteralString();
    if (/[A-Za-z0-9_-]/.test(c)) {
      let key = "";
      while (!this.atEnd() && /[A-Za-z0-9_-]/.test(this.peek())) key += this.advance();
      return key;
    }
    this.error(`expected a key, got ${JSON.stringify(c)}`);
  }

  // ---- key/value --------------------------------------------------------

  parseKeyValue(target) {
    const path = this.parseDottedKey();
    this.skipInlineWs();
    this.expect("=");
    this.skipInlineWs();
    const value = this.parseValue();

    let node = target;
    for (let k = 0; k < path.length - 1; k++) {
      const key = path[k];
      const existing = node[key];
      if (existing === undefined || existing === null) {
        node[key] = {};
        node = node[key];
      } else if (typeof existing === "object" && !Array.isArray(existing)) {
        node = existing;
      } else {
        this.error(
          `cannot descend into key ${JSON.stringify(key)} (already a ${Array.isArray(existing) ? "array" : "scalar"})`,
        );
      }
    }
    const finalKey = path[path.length - 1];
    if (Object.prototype.hasOwnProperty.call(node, finalKey)) {
      this.error(`duplicate key ${JSON.stringify(finalKey)}`);
    }
    node[finalKey] = value;
  }

  // ---- values -----------------------------------------------------------

  parseValue() {
    const c = this.peek();
    if (c === '"') {
      if (this.peek(1) === '"' && this.peek(2) === '"') return this.parseMultilineBasic();
      return this.parseBasicString();
    }
    if (c === "'") {
      if (this.peek(1) === "'" && this.peek(2) === "'") return this.parseMultilineLiteral();
      return this.parseLiteralString();
    }
    if (c === "[") return this.parseArray();
    if (c === "{") return this.parseInlineTable();
    if (c === "t" || c === "f") return this.parseBoolOrThrow();
    if (c === "i" || c === "n" || c === "+" || c === "-") {
      // could be inf/nan or signed number
      return this.parseNumberOrDate();
    }
    if (c >= "0" && c <= "9") return this.parseNumberOrDate();
    this.error(`unexpected value start ${JSON.stringify(c)}`);
  }

  parseBasicString() {
    this.expect('"');
    let out = "";
    while (!this.atEnd()) {
      const c = this.advance();
      if (c === '"') return out;
      if (c === "\\") {
        if (this.atEnd()) this.error("unterminated escape in basic string");
        const e = this.advance();
        out += this.applyEscape(e);
      } else if (c === "\n") {
        this.error("unescaped newline in basic string");
      } else {
        out += c;
      }
    }
    this.error("unterminated basic string");
  }

  applyEscape(e) {
    switch (e) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "/":
        return "/";
      case "u":
        return String.fromCharCode(parseInt(this.readHex(4), 16));
      case "U":
        return String.fromCodePoint(parseInt(this.readHex(8), 16));
      default:
        this.error(`unsupported escape sequence \\${e}`);
    }
  }

  readHex(n) {
    let h = "";
    for (let k = 0; k < n; k++) {
      if (this.atEnd()) this.error("unexpected EOF in hex escape");
      h += this.advance();
    }
    return h;
  }

  parseLiteralString() {
    this.expect("'");
    let out = "";
    while (!this.atEnd()) {
      const c = this.advance();
      if (c === "'") return out;
      if (c === "\n") this.error("unescaped newline in literal string");
      out += c;
    }
    this.error("unterminated literal string");
  }

  parseMultilineBasic() {
    this.expect('"');
    this.expect('"');
    this.expect('"');
    // trim a single immediate newline
    if (this.peek() === "\r") this.advance();
    if (this.peek() === "\n") this.advance();
    let out = "";
    while (!this.atEnd()) {
      if (this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.advance();
        this.advance();
        this.advance();
        // allow up to two trailing quote chars to be part of content (TOML quirk)
        while (this.peek() === '"' && out.endsWith('"')) {
          out = out.slice(0, -1);
          this.i--; // step back so we re-emit it... simpler: just allow 1-2 extra
        }
        return out;
      }
      const c = this.advance();
      if (
        c === "\\" &&
        (this.peek() === "\n" ||
          this.peek() === "\r" ||
          this.peek() === " " ||
          this.peek() === "\t")
      ) {
        // line-ending backslash trims trailing whitespace
        // lookahead: only treat as line-continuation if a newline follows whitespace
        let j = this.i;
        while (j < this.n && (this.s[j] === " " || this.s[j] === "\t")) j++;
        if (j < this.n && (this.s[j] === "\n" || this.s[j] === "\r")) {
          this.i = j;
          if (this.peek() === "\r") this.advance();
          if (this.peek() === "\n") this.advance();
          while (
            !this.atEnd() &&
            (this.peek() === " " ||
              this.peek() === "\t" ||
              this.peek() === "\n" ||
              this.peek() === "\r")
          )
            this.advance();
          continue;
        }
        out += c;
      } else if (c === "\\") {
        const e = this.advance();
        out += this.applyEscape(e);
      } else {
        out += c;
      }
    }
    this.error("unterminated multiline basic string");
  }

  parseMultilineLiteral() {
    this.expect("'");
    this.expect("'");
    this.expect("'");
    if (this.peek() === "\r") this.advance();
    if (this.peek() === "\n") this.advance();
    let out = "";
    while (!this.atEnd()) {
      if (this.peek() === "'" && this.peek(1) === "'" && this.peek(2) === "'") {
        this.advance();
        this.advance();
        this.advance();
        return out;
      }
      out += this.advance();
    }
    this.error("unterminated multiline literal string");
  }

  parseBoolOrThrow() {
    if (this.startsWith("true")) {
      this.i += 4;
      return true;
    }
    if (this.startsWith("false")) {
      this.i += 5;
      return false;
    }
    this.error(`unrecognized bare value starting with ${JSON.stringify(this.peek())}`);
  }

  parseNumberOrDate() {
    let token = "";
    while (!this.atEnd()) {
      const c = this.peek();
      if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "," ||
        c === "]" ||
        c === "}" ||
        c === "#"
      )
        break;
      token += this.advance();
    }
    if (token === "") this.error("expected a numeric/datetime value");

    // RFC3339 date or date-time (passthrough as string)
    if (/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|z|[+-]\d{2}:\d{2})?)?$/.test(token))
      return token;
    // local time
    if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(token)) return token;
    // integer (decimal, underscores allowed)
    if (/^[+-]?\d[\d_]*$/.test(token)) return parseInt(token.replace(/_/g, ""), 10);
    // hex/oct/bin integers
    if (/^[+-]?0x[0-9A-Fa-f_]+$/.test(token))
      return parseInt(token.replace(/_/g, "").replace(/^([+-]?)0x/i, "$1"), 16);
    if (/^[+-]?0o[0-7_]+$/.test(token))
      return parseInt(token.replace(/_/g, "").replace(/^([+-]?)0o/i, "$1"), 8);
    if (/^[+-]?0b[01_]+$/.test(token))
      return parseInt(token.replace(/_/g, "").replace(/^([+-]?)0b/i, "$1"), 2);
    // float
    if (/^[+-]?(\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?|\d[\d_]*[eE][+-]?\d+)$/.test(token)) {
      return parseFloat(token.replace(/_/g, ""));
    }
    // inf / nan
    if (/^[+-]?inf$/.test(token)) return token === "-inf" ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(token)) return NaN;
    this.error(`unsupported value token ${JSON.stringify(token)}`);
  }

  parseArray() {
    this.expect("[");
    const arr = [];
    while (true) {
      this.skipWsCommentsNewlines();
      if (this.atEnd()) this.error("unterminated array");
      if (this.peek() === "]") {
        this.advance();
        break;
      }
      const val = this.parseValue();
      arr.push(val);
      this.skipWsCommentsNewlines();
      if (this.peek() === ",") {
        this.advance();
        continue;
      }
      if (this.peek() === "]") {
        this.advance();
        break;
      }
      this.error(`expected ',' or ']' in array, got ${JSON.stringify(this.peek())}`);
    }
    return arr;
  }

  parseInlineTable() {
    this.expect("{");
    const obj = {};
    while (true) {
      this.skipInlineWs();
      if (this.peek() === "}") {
        this.advance();
        break;
      }
      if (this.atEnd()) this.error("unterminated inline table");
      if (this.peek() === "\n" || this.peek() === "\r") {
        this.error("multi-line inline tables are not supported in this subset");
      }
      this.parseKeyValue(obj);
      this.skipInlineWs();
      if (this.peek() === ",") {
        this.advance();
        continue;
      }
      if (this.peek() === "}") {
        this.advance();
        break;
      }
      this.error(`expected ',' or '}' in inline table, got ${JSON.stringify(this.peek())}`);
    }
    return obj;
  }
}

// ---------------------------------------------------------------------------
// YAML (shallow subset)
// ---------------------------------------------------------------------------

export function parseYamlShallow(text) {
  const src = text == null ? "" : String(text);
  const rawLines = src.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const stripped = stripYamlComment(raw);
    if (stripped.trim() === "") continue;
    // tabs are illegal for indentation in YAML; we treat a leading tab as an error
    if (stripped.startsWith("\t")) {
      throw new Error(`YAML parse error at line ${i + 1}: tab indentation is not allowed`);
    }
    const indent = stripped.match(/^[ ]*/)[0].length;
    const content = stripped.slice(indent);
    lines.push({ indent, content, line: i + 1 });
  }
  if (lines.length === 0) return {};
  // skip a leading document separator '---' if present
  if (lines[0].content === "---") lines.shift();
  if (lines.length === 0) return {};
  const parser = new YamlParser(lines);
  const node = parser.parseNode(lines[0].indent);
  if (node === null) return {};
  if (typeof node !== "object") return { value: node };
  return node;
}

class YamlParser {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }
  peek() {
    return this.lines[this.i];
  }
  next() {
    return this.lines[this.i++];
  }
  atEnd() {
    return this.i >= this.lines.length;
  }
  error(msg, line) {
    throw new Error(
      `YAML parse error at line ${line == null ? (this.peek()?.line ?? "?") : line}: ${msg}`,
    );
  }

  parseNode(indent) {
    if (this.atEnd()) return null;
    const line = this.peek();
    if (line.indent < indent) return null;
    if (line.content.startsWith("-") && (line.content === "-" || line.content[1] === " ")) {
      return this.parseSequence(indent);
    }
    if (findTopLevelColon(line.content) !== -1) {
      return this.parseMapping(indent);
    }
    // bare scalar line
    this.next();
    return parseYamlScalar(line.content, line.line);
  }

  parseMapping(indent) {
    const obj = {};
    while (!this.atEnd()) {
      const line = this.peek();
      if (line.indent !== indent) break;
      if (line.content.startsWith("-") && (line.content === "-" || line.content[1] === " ")) break;
      const colonIdx = findTopLevelColon(line.content);
      if (colonIdx === -1) {
        this.error(`expected mapping key, got ${JSON.stringify(line.content)}`, line.line);
      }
      const keyRaw = line.content.slice(0, colonIdx).trim();
      const valRaw = line.content.slice(colonIdx + 1).trim();
      const key = parseYamlScalar(keyRaw, line.line);
      this.next();

      let value;
      if (valRaw === "") {
        if (!this.atEnd() && this.peek().indent > indent) {
          value = this.parseNode(this.peek().indent);
        } else {
          value = null;
        }
      } else {
        value = this.parseInline(valRaw, line.line);
      }
      obj[key] = value;
    }
    return obj;
  }

  parseSequence(indent) {
    const arr = [];
    while (!this.atEnd()) {
      const line = this.peek();
      if (line.indent !== indent) break;
      if (!(line.content.startsWith("-") && (line.content === "-" || line.content[1] === " ")))
        break;

      const after = line.content.slice(1);
      const leadMatch = after.match(/^[ ]*/);
      const leadSpaces = leadMatch ? leadMatch[0].length : 0;
      const rest = after.slice(leadSpaces);
      const itemIndent = indent + 1 + leadSpaces;

      if (rest === "") {
        this.next();
        if (!this.atEnd() && this.peek().indent > indent) {
          arr.push(this.parseNode(this.peek().indent));
        } else {
          arr.push(null);
        }
        continue;
      }

      const colonIdx = findTopLevelColon(rest);
      if (colonIdx !== -1) {
        // sequence item is the start of a mapping; gather all lines belonging to this item
        this.next();
        const synth = [{ indent: itemIndent, content: rest, line: line.line }];
        while (!this.atEnd() && this.peek().indent > indent) {
          const nxt = this.peek();
          synth.push({ indent: nxt.indent, content: nxt.content, line: nxt.line });
          this.i++;
        }
        const sub = new YamlParser(synth);
        arr.push(sub.parseNode(itemIndent));
        continue;
      }

      this.next();
      arr.push(this.parseInline(rest, line.line));
    }
    return arr;
  }

  parseInline(s, lineNo) {
    s = s.trim();
    if (s === "") return null;
    if (s[0] === "{") return parseFlowMapping(s, lineNo);
    if (s[0] === "[") return parseFlowSequence(s, lineNo);
    return parseYamlScalar(s, lineNo);
  }
}

function stripYamlComment(line) {
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) {
      if (c === inS) inS = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inS = c;
      continue;
    }
    if (c === "#") {
      // YAML requires a whitespace or start-of-line before '#' to be a comment.
      // We honor that to avoid splitting 'http://...' style values.
      const prev = line[i - 1];
      if (prev === undefined || prev === " " || prev === "\t") {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

function findTopLevelColon(s) {
  let depth = 0;
  let inS = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) {
      if (c === inS) inS = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inS = c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      continue;
    }
    if (c === ":" && depth === 0) {
      const next = s[i + 1];
      if (next === undefined || next === " " || next === "\t") return i;
    }
  }
  return -1;
}

function parseYamlScalar(s, lineNo) {
  s = s.trim();
  if (s === "") return null;
  if (s[0] === "&" || s[0] === "*") {
    throw new Error(
      `YAML parse error at line ${lineNo ?? "?"}: anchors/aliases are not supported in this subset (${JSON.stringify(s)})`,
    );
  }
  if (s === "|" || s === ">" || s === "|-" || s === ">-" || s === "|+" || s === ">+") {
    throw new Error(
      `YAML parse error at line ${lineNo ?? "?"}: block scalars ('${s}') are not supported in this subset`,
    );
  }
  // double-quoted
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return unescapeBasic(s.slice(1, -1));
  }
  // single-quoted (YAML escapes '' -> ')
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  // nulls
  if (s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
  // bools (YAML 1.1 bools restricted to true/false casing variants we accept)
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  // int
  if (/^[-+]?[0-9]+$/.test(s)) return parseInt(s, 10);
  if (/^[-+]?0x[0-9A-Fa-f]+$/.test(s)) return parseInt(s, 16);
  if (/^[-+]?0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
  // float
  if (/^[-+]?(\.[0-9]+|[0-9]+\.[0-9]*)([eE][-+]?[0-9]+)?$/.test(s)) {
    if (s === "." || s === "-." || s === "+.") return s;
    return parseFloat(s);
  }
  if (/^[-+]?[0-9]+[eE][-+]?[0-9]+$/.test(s)) return parseFloat(s);
  if (s === ".inf" || s === ".Inf" || s === ".INF") return Infinity;
  if (s === "-.inf" || s === "-.Inf" || s === "-.INF") return -Infinity;
  if (s === ".nan" || s === ".NaN" || s === ".NAN") return NaN;
  // plain string
  return s;
}

function unescapeBasic(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const e = s[++i];
      switch (e) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        default:
          out += e;
      }
    } else out += c;
  }
  return out;
}

function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let inS = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) {
      cur += c;
      if (c === inS) inS = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inS = c;
      cur += c;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      cur += c;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      cur += c;
      continue;
    }
    if (c === sep && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseFlowMapping(s, lineNo) {
  const inner = s.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  const obj = {};
  if (inner === "") return obj;
  for (const part of splitTopLevel(inner, ",")) {
    if (part.trim() === "") continue;
    const ci = findTopLevelColon(part);
    if (ci === -1) {
      obj[parseYamlScalar(part.trim(), lineNo)] = null;
    } else {
      const k = parseYamlScalar(part.slice(0, ci).trim(), lineNo);
      const vRaw = part.slice(ci + 1).trim();
      obj[k] = vRaw === "" ? null : parseYamlScalar(vRaw, lineNo);
    }
  }
  return obj;
}

function parseFlowSequence(s, lineNo) {
  const inner = s.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner === "") return [];
  return splitTopLevel(inner, ",")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => parseYamlScalar(p, lineNo));
}
