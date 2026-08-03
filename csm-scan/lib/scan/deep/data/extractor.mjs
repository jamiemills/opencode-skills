// Data Architecture dimension — declaration-backed extractors.
//
// T212 owns this module. It is a pure text extractor: it consumes bounded
// artifact content (`{ path, text, value, format, ecosystem }`) and returns
// candidate records, unresolved edge candidates, and explicit diagnostics. It
// never connects to a database, executes migrations, inspects query plans,
// classifies PII, or infers lineage.
//
// Supported literal subsets (conservative):
//   - SQL DDL: `CREATE DATABASE`/`CREATE SCHEMA`/`CREATE TABLE`/`CREATE INDEX`
//     plus inline and table-level `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, and
//     `REFERENCES` constraints. No function calls, expressions, defaults, or
//     procedural blocks are interpreted.
//   - ORM models (literal subset): SQLAlchemy `__tablename__`/`Column`/
//     `ForeignKey`/`relationship`; Django `models.Model` fields and relation
//     fields; Prisma `model` blocks and `@relation`; Sequelize
//     `define`/`init`/association calls; Diesel `table!` schemas and
//     `#[belongs_to]`; SQLx via SQL DDL migrations.
//   - Migrations: Django `dependencies`, Alembic `revision`/`down_revision`,
//     Prisma/SQLx/Diesel migration files, and Sequelize
//     `queryInterface.createTable`.
//   - Caches/queues: Django `CACHES` and `CELERY_TASK_QUEUES`/`CELERY_QUEUES`,
//     RQ `Queue('name')`, BullMQ `new Queue('name')`/`createQueue`, and
//     `new Cache('name')`/`createCache`.
//
// Resolution policy (no false edges):
//   - ER edges require explicit relation evidence (SQL FOREIGN KEY /
//     REFERENCES, ORM foreign-key-bearing declarations). Name-only relations
//     (SQLAlchemy `relationship` without an FK, Prisma relations without
//     `fields`/`references`, Sequelize `hasMany`/`hasOne`) produce an
//     `unverified NAME_ONLY` diagnostic and NO edge.
//   - Edges resolve at model build time only when both endpoints are unique
//     declared entities in the scan; ambiguity stays unresolved.
//   - Migration order uses explicit predecessor declarations only (Django
//     `dependencies`, Alembic `down_revision`); filenames never infer order.
//
// ESM only. Zero npm deps. node: builtins only. Pure DATA; no filesystem,
// network, child-process, or executable access.
//
// Source-policy note (T201): this module imports only the data model; it never
// touches node:fs / node:child_process / node:process / node:vm / node:module,
// so the recurring capability gate remains closed.

import { DATA_LIMITS } from './model.mjs';

const RECORD_LABEL = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const MIGRATION_PATTERNS = Object.freeze([
  { re: /(?:^|\/)alembic\/versions\/[^/]+\.py$/, dialect: 'alembic' },
  { re: /(?:^|\/)versions\/[^/]+\.py$/, dialect: 'alembic' },
  { re: /(?:^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/, dialect: 'prisma' },
  { re: /(?:^|\/)migrations\/[^/]+\.py$/, dialect: 'django' },
  { re: /(?:^|\/)migrations\/[^/]+\.(?:js|ts)$/, dialect: 'sequelize' },
  { re: /(?:^|\/)migrations\/[^/]+\.sql$/, dialect: 'sqlx' },
  { re: /(?:^|\/)db\/migrations\/[^/]+\.sql$/, dialect: 'sqlx' },
  { re: /(?:^|\/)migrate\/[^/]+\.sql$/, dialect: 'sqlx' },
  { re: /(?:^|\/)migrations\/[^/]+\/(?:up|down)\.sql$/, dialect: 'diesel' },
]);

function basenameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function dirnameOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function extensionOf(path) {
  const base = basenameOf(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Classify a repository-relative path for data extraction.
 * @param {string} path
 * @returns {object} `{ kind, format, ecosystem }` where kind is one of
 *   `sql`, `python`, `javascript`, `typescript`, `rust`, `prisma`, or `other`.
 */
export function classifyDataPath(path) {
  const base = basenameOf(path);
  const ext = extensionOf(path);
  if (base === 'schema.prisma' || ext === '.prisma') {
    return { kind: 'prisma', format: 'text', ecosystem: null };
  }
  if (ext === '.sql') return { kind: 'sql', format: 'text', ecosystem: null };
  if (ext === '.py') return { kind: 'python', format: 'text', ecosystem: 'python' };
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    return { kind: 'javascript', format: 'text', ecosystem: 'javascript' };
  }
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
    return { kind: 'typescript', format: 'text', ecosystem: 'typescript' };
  }
  if (ext === '.rs') return { kind: 'rust', format: 'text', ecosystem: 'rust' };
  return { kind: 'other', format: 'text', ecosystem: null };
}

/**
 * Detect whether a path is a supported migration artifact and which dialect.
 * @param {string} path
 * @returns {string|null} migration dialect or null.
 */
export function migrationKindOf(path) {
  for (const { re, dialect } of MIGRATION_PATTERNS) {
    if (re.test(path)) return dialect;
  }
  return null;
}

function lineIndexOf(text, offset) {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === '\n') line++;
  }
  return line;
}

function safeLabel(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.replace(/^["'`\[]/, '').replace(/["'`\]]$/, '');
  return RECORD_LABEL.test(candidate) && !candidate.endsWith('.') ? candidate : null;
}

function diagnostic(path, status, reason, line = null) {
  return { path, status, reason, line };
}

function recordCandidate({ category, dialect, signature, details, path, line, status = 'observed' }) {
  return { category, dialect, signature, details, path, line, status };
}

function relationEdgeCandidate({ from, to, kind, path, line, matchedKey }) {
  return { from, to, kind, path, line, matchedKey };
}

function migrationEdgeCandidate({ fromAlias, toPath, path, line, matchedKey }) {
  return { fromAlias, toPath, kind: 'migration_predecessor', path, line, matchedKey };
}

function entitySignature(label) {
  return `${label}`;
}

function fieldSignature(entity, name) {
  return `${entity}:${name}`;
}

function keySignature(entity, keyName, kind) {
  return `${entity}:${keyName}:${kind}`;
}

function relationSignature(from, to, kind) {
  return `${from}:${to}:${kind}`;
}

function migrationSignature(path) {
  return `${basenameOf(path)}`;
}

function matchedKeyForRecord(category, signature) {
  return `${category}:${signature}`;
}

function boundedCollections(result, path) {
  const { records, edges, diagnostics } = result;
  let capped = { records: false };
  if (records.length > DATA_LIMITS.perFileRecords) {
    records.length = DATA_LIMITS.perFileRecords;
    capped.records = true;
    diagnostics.push(diagnostic(path, 'unverified', 'CAP'));
  }
  if (diagnostics.length > DATA_LIMITS.perFileDiagnostics) {
    diagnostics.length = DATA_LIMITS.perFileDiagnostics;
  }
  return { records, edges, diagnostics, capped };
}

// ---------------------------------------------------------------------------
// SQL DDL
// ---------------------------------------------------------------------------

function stripSqlComments(text) {
  const source = String(text ?? '');
  let out = '';
  let inQuote = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inQuote) {
      out += c;
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inQuote = c; out += c; continue; }
    if (c === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

function splitTopLevel(text, sep, openers = '([{', closers = ')]}') {
  const parts = [];
  const stack = [];
  let cur = '';
  let inQuote = null;
  let escaped = false;
  for (const c of text) {
    if (inQuote) {
      cur += c;
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inQuote = c; cur += c; continue; }
    const opener = openers.indexOf(c);
    if (opener !== -1) { stack.push(closers[opener]); cur += c; continue; }
    if (stack.length > 0) {
      if (c === stack[stack.length - 1]) stack.pop();
      cur += c;
      continue;
    }
    if (c === sep) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function findMatching(text, open, close, startIndex) {
  let depth = 0;
  let inQuote = null;
  let escaped = false;
  for (let i = startIndex; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inQuote = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sqlStatements(text) {
  return splitTopLevel(text, ';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseColumnList(inner) {
  return splitTopLevel(inner, ',')
    .map((entry) => safeLabel(entry.trim().replace(/^["'`\[]/, '').replace(/["'`\]]$/, '')))
    .filter((entry) => entry !== null);
}

function typeToken(text) {
  const match = String(text ?? '').trim().match(/^[A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*[^)]*\))?/);
  if (!match) return null;
  const value = match[0].replace(/\s+/g, '');
  if (value.length > DATA_LIMITS.type) return null;
  return value;
}

function extractSql(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = stripSqlComments(text);
  const entities = new Map();
  const pendingIndexKeys = [];
  let pendingEntity = null;

  const emitField = (entity, name, type, nullable) => {
    const label = safeLabel(name);
    if (label === null || entity === null) return;
    records.push(recordCandidate({
      category: 'field',
      dialect: 'sql',
      signature: fieldSignature(entity, label),
      details: { type, nullable },
      path,
      line: pendingEntity?.line ?? null,
    }));
  };

  const emitKey = (entity, keyName, kind, columns) => {
    if (entity === null) return;
    const name = safeLabel(keyName);
    if (name === null) return;
    records.push(recordCandidate({
      category: 'key',
      dialect: 'sql',
      signature: keySignature(entity, name, kind),
      details: { kind, columns },
      path,
      line: pendingEntity?.line ?? null,
    }));
  };

  const emitRelation = (fromEntity, target, kind, line) => {
    if (fromEntity === null || target === null) return;
    const signature = relationSignature(fromEntity, target, kind);
    records.push(recordCandidate({
      category: 'relation',
      dialect: 'sql',
      signature,
      details: { kind, target },
      path,
      line,
    }));
    edges.push(relationEdgeCandidate({
      from: fromEntity,
      to: target,
      kind,
      path,
      line,
      matchedKey: matchedKeyForRecord('relation', signature),
    }));
  };

  for (const statement of sqlStatements(source)) {
    const upper = statement.toUpperCase();
    if (/^CREATE\s+DATABASE\b/i.test(statement)) {
      const match = statement.match(/^CREATE\s+DATABASE\s+(["'`]?)([A-Za-z0-9_.-]+)\1/i);
      if (match) {
        const store = safeLabel(match[2]);
        if (store !== null) {
          records.push(recordCandidate({
            category: 'store',
            dialect: 'sql',
            signature: store,
            details: { kind: 'database', label: store },
            path,
            line: lineIndexOf(source, statement.indexOf(match[0])),
          }));
        }
      }
      continue;
    }
    if (/^CREATE\s+SCHEMA\b/i.test(statement)) {
      const match = statement.match(/^CREATE\s+SCHEMA\s+(["'`]?)([A-Za-z0-9_.-]+)\1/i);
      if (match) {
        const schema = safeLabel(match[2]);
        if (schema !== null) {
          records.push(recordCandidate({
            category: 'schema',
            dialect: 'sql',
            signature: schema,
            details: { label: schema },
            path,
            line: lineIndexOf(source, statement.indexOf(match[0])),
          }));
        }
      }
      continue;
    }
    const indexMatch = statement.match(/^CREATE(?:\s+UNIQUE)?\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_.-]+)\s+ON\s+(["'`]?)([A-Za-z0-9_.-]+)\2\s*\(([^)]*)\)/i);
    if (indexMatch) {
      const uniqueIndex = /^CREATE\s+UNIQUE/i.test(statement);
      records.push(recordCandidate({
        category: 'key',
        dialect: 'sql',
        signature: keySignature(indexMatch[3], indexMatch[1], uniqueIndex ? 'unique' : 'index'),
        details: { kind: uniqueIndex ? 'unique' : 'index', columns: parseColumnList(indexMatch[4]) },
        path,
        line: lineIndexOf(source, statement.indexOf(indexMatch[0])),
      }));
      continue;
    }
    const tableMatch = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["'`\[]?)([A-Za-z0-9_.-]+)\1\s*\(/i);
    if (!tableMatch) {
      if (/^CREATE\s+TABLE\b/i.test(statement)) {
        diagnostics.push(diagnostic(path, 'unsupported', 'UNSUPPORTED', lineIndexOf(source, statement.indexOf('CREATE'))));
      }
      continue;
    }
    const table = safeLabel(tableMatch[2]);
    if (table === null) {
      diagnostics.push(diagnostic(path, 'unsupported', 'UNSUPPORTED', lineIndexOf(source, statement.indexOf(tableMatch[0]))));
      continue;
    }
    const openIndex = statement.indexOf('(', tableMatch.index + tableMatch[0].length - 1);
    const closeIndex = findMatching(statement, '(', ')', openIndex);
    if (closeIndex === -1) {
      diagnostics.push(diagnostic(path, 'unsupported', 'UNSUPPORTED', lineIndexOf(source, statement.indexOf(tableMatch[0]))));
      continue;
    }
    const body = statement.slice(openIndex + 1, closeIndex);
    const line = lineIndexOf(source, statement.indexOf(tableMatch[0]));
    pendingEntity = { entity: table, line };
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'sql',
      signature: entitySignature(table),
      details: { table },
      path,
      line,
    }));
    entities.set(table, line);

    for (const raw of splitTopLevel(body, ',')) {
      const definition = raw.trim();
      if (definition.length === 0) continue;
      const constraintMatch = definition.match(/^CONSTRAINT\s+[A-Za-z0-9_.-]+\s+(.*)$/i);
      const core = constraintMatch ? constraintMatch[1].trim() : definition;
      const coreUpper = core.toUpperCase();

      if (/^(PRIMARY\s+KEY|UNIQUE(?:\s+KEY)?)\b/i.test(core)) {
        const kind = /^PRIMARY/.test(core) ? 'primary' : 'unique';
        const columns = parseColumnList(core.slice(core.indexOf('(')));
        if (columns.length > 0) {
          emitKey(table, kind, kind, columns);
        }
        continue;
      }
      if (/^FOREIGN\s+KEY\b/i.test(core)) {
        const fk = core.match(/^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+(["'`]?)([A-Za-z0-9_.-]+)\2\s*\(([^)]*)\)/i);
        if (fk) {
          const target = safeLabel(fk[3]);
          const columns = parseColumnList(fk[1]);
          if (target !== null) {
            emitKey(table, 'foreign_key', 'foreign', columns);
            emitRelation(table, target, 'foreign_key', line);
          }
        }
        continue;
      }
      if (/^KEY\b/i.test(core)) {
        const columns = parseColumnList(core.slice(core.indexOf('(')));
        const keyName = core.match(/^KEY\s+(["'`]?)([A-Za-z0-9_.-]+)\1/);
        if (columns.length > 0) {
          emitKey(table, keyName ? keyName[2] : 'key', 'index', columns);
        }
        continue;
      }
      if (/^INDEX\b/i.test(core)) {
        const columns = parseColumnList(core.slice(core.indexOf('(')));
        const keyName = core.match(/^INDEX\s+(["'`]?)([A-Za-z0-9_.-]+)\1/);
        if (columns.length > 0) {
          emitKey(table, keyName ? keyName[2] : 'index', 'index', columns);
        }
        continue;
      }

      const columnMatch = core.match(/^(["'`]?)([A-Za-z0-9_.-]+)\1\s+(.+)$/);
      if (!columnMatch) continue;
      const columnName = safeLabel(columnMatch[2]);
      if (columnName === null) continue;
      const rest = columnMatch[3];
      const type = typeToken(rest);
      const nullable = !/\bNOT\s+NULL\b/i.test(rest);
      emitField(table, columnName, type, nullable);
      if (/\bPRIMARY\s+KEY\b/i.test(rest)) {
        emitKey(table, columnName, 'primary', [columnName]);
      }
      if (/\bUNIQUE\b/i.test(rest)) {
        emitKey(table, columnName, 'unique', [columnName]);
      }
      const inlineFk = rest.match(/\bREFERENCES\s+(["'`]?)([A-Za-z0-9_.-]+)\1\s*\(([^)]*)\)/i);
      if (inlineFk) {
        const target = safeLabel(inlineFk[2]);
        if (target !== null) {
          emitKey(table, `${columnName}_foreign`, 'foreign', [columnName]);
          emitRelation(table, target, 'foreign_key', line);
        }
      }
    }
    pendingEntity = null;
  }

  for (const entry of pendingIndexKeys) {
    if (!entities.has(entry.entity)) continue;
    records.push(recordCandidate({
      category: 'key',
      dialect: 'sql',
      signature: keySignature(entry.entity, entry.keyName, entry.kind),
      details: { kind: entry.kind, columns: entry.columns },
      path,
      line: entry.line,
    }));
  }

  return { records, edges, diagnostics, capped: {} };
}

function migrationRecord({ dialect, path, alias, revision = null, downRevision = null, dependencies = [], line = 1 }) {
  return recordCandidate({
    category: 'migration',
    dialect,
    signature: migrationSignature(path),
    details: { alias, revision, downRevision, dependencies },
    path,
    line,
  });
}

// ---------------------------------------------------------------------------
// Django migrations
// ---------------------------------------------------------------------------

function extractDjangoMigration(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const dirs = dirnameOf(path).split('/');
  const migrationsIndex = dirs.lastIndexOf('migrations');
  const app = migrationsIndex > 0 && dirs[migrationsIndex - 1] ? dirs[migrationsIndex - 1] : 'app';
  const name = basenameOf(path).replace(/\.py$/, '');
  if (!RECORD_LABEL.test(app) || !RECORD_LABEL.test(name)) {
    return { records, edges, diagnostics: [diagnostic(path, 'unsupported', 'UNSUPPORTED')], capped: {} };
  }
  const alias = `django:${app}:${name}`;
  const dependencies = [];
  const depsMatch = source.match(/\bdependencies\s*=\s*\[([\s\S]*?)\]/);
  let line = 1;
  if (depsMatch) {
    line = lineIndexOf(source, depsMatch.index);
    for (const entry of depsMatch[1].matchAll(/\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)) {
      const depApp = safeLabel(entry[1]);
      const depName = safeLabel(entry[2]);
      if (depApp !== null && depName !== null) {
        dependencies.push(`django:${depApp}:${depName}`);
      }
    }
  }
  records.push(migrationRecord({
    dialect: 'django',
    path,
    alias,
    dependencies,
    line,
  }));
  for (const dependency of dependencies) {
    edges.push(migrationEdgeCandidate({
      fromAlias: dependency,
      toPath: path,
      path,
      line,
      matchedKey: matchedKeyForRecord('migration', migrationSignature(path)),
    }));
  }
  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Alembic migrations
// ---------------------------------------------------------------------------

function extractAlembic(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const revisionMatch = source.match(/^\s*revision\s*=\s*['"]([^'"]+)['"]/m);
  const revision = revisionMatch ? revisionMatch[1] : null;
  const downMatch = source.match(/^\s*down_revision\s*=\s*(?:['"]([^'"]+)['"]|None)/m);
  const downRevision = downMatch ? downMatch[1] : null;
  if (revision === null) {
    return { records, edges, diagnostics: [diagnostic(path, 'unsupported', 'UNSUPPORTED')], capped: {} };
  }
  const alias = `alembic:${revision}`;
  const line = revisionMatch ? lineIndexOf(source, revisionMatch.index) : 1;
  records.push(migrationRecord({
    dialect: 'alembic',
    path,
    alias,
    revision,
    downRevision,
    dependencies: [],
    line,
  }));
  if (downRevision !== null) {
    const downLine = downMatch ? lineIndexOf(source, downMatch.index) : line;
    edges.push(migrationEdgeCandidate({
      fromAlias: `alembic:${downRevision}`,
      toPath: path,
      path,
      line: downLine,
      matchedKey: matchedKeyForRecord('migration', migrationSignature(path)),
    }));
  }
  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Sequelize migrations (queryInterface.createTable)
// ---------------------------------------------------------------------------

function attributeEntriesFromBlock(block) {
  const entries = [];
  for (const part of splitTopLevel(block, ',')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim().replace(/^["']|["']$/g, '');
    if (!RECORD_LABEL.test(key)) continue;
    entries.push({ key, value: part.slice(colon + 1) });
  }
  return entries;
}

function extractSequelizeMigration(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const alias = `path:${basenameOf(path)}`;
  records.push(migrationRecord({ dialect: 'sequelize', path, alias: `path:${path}` }));
  const pattern = /\bqueryInterface\.createTable\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const parenIndex = source.indexOf('(', match.index + match[0].length - 1);
    const closeIndex = findMatching(source, '(', ')', parenIndex);
    if (closeIndex === -1) continue;
    const call = source.slice(parenIndex + 1, closeIndex);
    const nameMatch = call.match(/^\s*['"]([^'"]+)['"]\s*,/);
    if (!nameMatch) continue;
    const table = safeLabel(nameMatch[1]);
    if (table === null) continue;
    const line = lineIndexOf(source, match.index);
    const braceIndex = call.indexOf('{');
    if (braceIndex === -1) continue;
    const braceEnd = findMatching(call, '{', '}', braceIndex);
    if (braceEnd === -1) continue;
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'sequelize',
      signature: entitySignature(table),
      details: { table },
      path,
      line,
    }));
    for (const entry of attributeEntriesFromBlock(call.slice(braceIndex + 1, braceEnd))) {
      const type = typeToken(entry.value) ?? 'Unknown';
      records.push(recordCandidate({
        category: 'field',
        dialect: 'sequelize',
        signature: fieldSignature(table, entry.key),
        details: { type, nullable: !/\ballowNull\s*:\s*false\b/.test(entry.value) },
        path,
        line,
      }));
      if (/\bprimaryKey\s*:\s*true\b/.test(entry.value)) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sequelize',
          signature: keySignature(table, entry.key, 'primary'),
          details: { kind: 'primary', columns: [entry.key] },
          path,
          line,
        }));
      }
      if (/\bunique\s*:\s*true\b/.test(entry.value)) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sequelize',
          signature: keySignature(table, entry.key, 'unique'),
          details: { kind: 'unique', columns: [entry.key] },
          path,
          line,
        }));
      }
    }
  }
  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Generic SQL migrations (Prisma / SQLx / Diesel)
// ---------------------------------------------------------------------------

function extractSqlMigration(text, path, dialect) {
  const records = [];
  const sqlResult = extractSql(text, path);
  records.push(...sqlResult.records);
  records.push(migrationRecord({
    dialect,
    path,
    alias: `path:${path}`,
  }));
  return { records, edges: sqlResult.edges, diagnostics: sqlResult.diagnostics, capped: sqlResult.capped };
}

// ---------------------------------------------------------------------------
// Prisma schema
// ---------------------------------------------------------------------------

function extractPrisma(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const datasourcePattern = /\bdatasource\s+([A-Za-z_]\w*)\s*\{/g;
  for (const match of source.matchAll(datasourcePattern)) {
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1);
    const braceEnd = findMatching(source, '{', '}', braceIndex);
    if (braceEnd === -1) continue;
    const label = safeLabel(match[1]);
    if (label === null) continue;
    records.push(recordCandidate({
      category: 'store',
      dialect: 'prisma',
      signature: label,
      details: { kind: 'datasource', label },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }

  const modelPattern = /\bmodel\s+([A-Za-z_]\w*)\s*\{/g;
  for (const match of source.matchAll(modelPattern)) {
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1);
    const braceEnd = findMatching(source, '{', '}', braceIndex);
    if (braceEnd === -1) continue;
    const block = source.slice(braceIndex + 1, braceEnd);
    const entity = safeLabel(match[1]);
    if (entity === null) continue;
    const line = lineIndexOf(source, match.index);
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'prisma',
      signature: entitySignature(entity),
      details: { table: entity },
      path,
      line,
    }));
    const bodyLines = block.split(/\r?\n/);
    const fields = [];
    for (const rawLine of bodyLines) {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0 || trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('@@')) {
        const compound = trimmed.match(/^@@(id|unique|index)\s*\(\s*\[([^\]]*)\]\s*\)/);
        if (compound) {
          const columns = compound[2].split(',').map((entry) => safeLabel(entry.trim())).filter((entry) => entry !== null);
          const kind = compound[1] === 'id' ? 'primary' : compound[1];
          if (columns.length > 0) {
            records.push(recordCandidate({
              category: 'key',
              dialect: 'prisma',
              signature: keySignature(entity, compound[1], kind),
              details: { kind, columns },
              path,
              line: lineIndexOf(block, block.indexOf(trimmed)) + line - 1,
            }));
          }
        }
        continue;
      }
      const fieldMatch = trimmed.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\?|\[\])?)(?:\s+(@.*))?$/);
      if (!fieldMatch) continue;
      const name = safeLabel(fieldMatch[1]);
      if (name === null) continue;
      const type = fieldMatch[2];
      const attributes = fieldMatch[3] ?? '';
      const arrayType = type.endsWith('[]');
      const optional = type.endsWith('?');
      const baseType = arrayType ? type.slice(0, -2) : optional ? type.slice(0, -1) : type;
      fields.push({ name, type: baseType, arrayType, optional, attributes, line: lineIndexOf(block, block.indexOf(trimmed)) + line - 1 });
    }
    for (const field of fields) {
      records.push(recordCandidate({
        category: 'field',
        dialect: 'prisma',
        signature: fieldSignature(entity, field.name),
        details: { type: field.type, nullable: field.optional },
        path,
        line: field.line,
      }));
      if (field.attributes.includes('@id')) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'prisma',
          signature: keySignature(entity, field.name, 'primary'),
          details: { kind: 'primary', columns: [field.name] },
          path,
          line: field.line,
        }));
      }
      if (field.attributes.includes('@unique')) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'prisma',
          signature: keySignature(entity, field.name, 'unique'),
          details: { kind: 'unique', columns: [field.name] },
          path,
          line: field.line,
        }));
      }
      if (field.attributes.includes('@index') || field.attributes.includes('@@index')) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'prisma',
          signature: keySignature(entity, field.name, 'index'),
          details: { kind: 'index', columns: [field.name] },
          path,
          line: field.line,
        }));
      }
      const relationAttr = field.attributes.match(/@relation\(\s*fields\s*:\s*\[([^\]]*)\]\s*,\s*references\s*:\s*\[([^\]]*)\]\s*\)/);
      if (relationAttr) {
        const target = safeLabel(field.type);
        if (target !== null) {
          const columns = relationAttr[1].split(',').map((entry) => safeLabel(entry.trim())).filter((entry) => entry !== null);
          records.push(recordCandidate({
            category: 'relation',
            dialect: 'prisma',
            signature: relationSignature(entity, target, 'foreign_key'),
            details: { kind: 'foreign_key', target },
            path,
            line: field.line,
          }));
          if (columns.length > 0) {
            records.push(recordCandidate({
              category: 'key',
              dialect: 'prisma',
              signature: keySignature(entity, `${field.name}_foreign`, 'foreign'),
              details: { kind: 'foreign', columns },
              path,
              line: field.line,
            }));
          }
          edges.push(relationEdgeCandidate({
            from: entity,
            to: target,
            kind: 'foreign_key',
            path,
            line: field.line,
            matchedKey: matchedKeyForRecord('relation', relationSignature(entity, target, 'foreign_key')),
          }));
        }
      } else if (/@relation/.test(field.attributes)) {
        diagnostics.push(diagnostic(path, 'unverified', 'NAME_ONLY', field.line));
      } else if (field.arrayType) {
        diagnostics.push(diagnostic(path, 'unverified', 'NAME_ONLY', field.line));
      }
    }
  }
  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Python models (SQLAlchemy + Django)
// ---------------------------------------------------------------------------

function pythonClassBlocks(text) {
  const blocks = [];
  const source = String(text ?? '');
  const lines = source.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const header = line.match(/^class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*(?:#.*)?$/);
    if (!header) { index++; continue; }
    const indent = line.match(/^ */)[0].length;
    const body = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (next.trim() === '' || next.startsWith('\t')) {
        body.push(next);
        cursor++;
        continue;
      }
      const nextIndent = next.match(/^ */)[0].length;
      if (nextIndent > indent) { body.push(next); cursor++; continue; }
      break;
    }
    blocks.push({
      name: header[1],
      startLine: index + 1,
      body: body.join('\n'),
    });
    index = cursor;
  }
  return blocks;
}

function findCallArgsFrom(text, tokenIndex) {
  const nameMatch = text.slice(tokenIndex).match(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/);
  if (!nameMatch) return null;
  const nameEnd = tokenIndex + nameMatch[0].length;
  const skip = text.slice(nameEnd).match(/^\s*/)[0].length;
  const parenIndex = nameEnd + skip;
  if (text[parenIndex] !== '(') return null;
  const close = findMatching(text, '(', ')', parenIndex);
  if (close === -1) return null;
  return { line: lineIndexOf(text, tokenIndex), args: text.slice(parenIndex + 1, close) };
}

function pythonColumnInfo(body, path) {
  const columns = [];
  const fkTargets = [];
  const relationships = [];
  const pattern = /^\s*([A-Za-z_]\w*)\s*=\s*Column\s*\(/gm;
  for (const match of body.matchAll(pattern)) {
    const call = findCallArgsFrom(body, match.index + match[0].indexOf('Column'));
    if (call === null) continue;
    const name = match[1];
    const argText = call.args.trim();
    let explicitName = null;
    let rest = argText;
    const quoted = argText.match(/^['"]([^'"]+)['"]\s*(?:,|$)/);
    if (quoted) {
      explicitName = quoted[1];
      rest = argText.slice(quoted[0].length);
    }
    const columnName = safeLabel(explicitName ?? name);
    const typeMatch = rest.trim().match(/^[A-Za-z_][\w.]*/);
    const type = typeMatch ? typeMatch[0] : null;
    const foreign = argText.match(/ForeignKey\s*\(\s*['"]([^'"]+)['"]/);
    const primary = /\bprimary_key\s*=\s*True\b/.test(argText);
    const unique = /\bunique\s*=\s*True\b/.test(argText);
    const indexed = /\bindex\s*=\s*True\b/.test(argText);
    columns.push({ name: columnName, type, primary, unique, indexed, line: call.line });
    if (foreign) {
      const parts = foreign[1].split('.');
      const target = safeLabel(parts[0]);
      if (target !== null) fkTargets.push({ column: columnName, target, line: call.line });
    }
  }
  const relPattern = /^\s*[A-Za-z_]\w*\s*=\s*relationship\s*\(\s*['"]([^'"]+)['"]/gm;
  for (const match of body.matchAll(relPattern)) {
    relationships.push({ target: safeLabel(match[1]), line: lineIndexOf(body, match.index) });
  }
  return { columns, fkTargets, relationships };
}

function extractPythonModels(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');

  const cachePattern = /\bCACHES\s*=\s*\{/g;
  for (const match of source.matchAll(cachePattern)) {
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1);
    const braceEnd = findMatching(source, '{', '}', braceIndex);
    if (braceEnd === -1) continue;
    const block = source.slice(braceIndex + 1, braceEnd);
    const line = lineIndexOf(source, match.index);
    const seen = new Set();
    for (const keyMatch of block.matchAll(/^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:/gm)) {
      const name = safeLabel(keyMatch[1]);
      if (name === null || seen.has(name)) continue;
      seen.add(name);
      records.push(recordCandidate({
        category: 'cache',
        dialect: 'django',
        signature: name,
        details: { scope: 'config' },
        path,
        line,
      }));
    }
  }

  const queueDictPattern = /\b(?:CELERY_TASK_QUEUES|CELERY_QUEUES)\s*=\s*\{/g;
  for (const match of source.matchAll(queueDictPattern)) {
    const braceIndex = source.indexOf('{', match.index + match[0].length - 1);
    const braceEnd = findMatching(source, '{', '}', braceIndex);
    if (braceEnd === -1) continue;
    const block = source.slice(braceIndex + 1, braceEnd);
    const line = lineIndexOf(source, match.index);
    const seen = new Set();
    for (const keyMatch of block.matchAll(/^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:/gm)) {
      const name = safeLabel(keyMatch[1]);
      if (name === null || seen.has(name)) continue;
      seen.add(name);
      records.push(recordCandidate({
        category: 'queue',
        dialect: 'django',
        signature: name,
        details: { scope: 'config' },
        path,
        line,
      }));
    }
  }

  const queuePattern = /\bQueue\s*\(\s*['"]([^'"]+)['"]\s*,?/g;
  for (const match of source.matchAll(queuePattern)) {
    const name = safeLabel(match[1]);
    if (name === null) continue;
    records.push(recordCandidate({
      category: 'queue',
      dialect: 'rq',
      signature: name,
      details: { scope: 'constructor' },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }

  for (const block of pythonClassBlocks(source)) {
    const classLine = block.startLine;
    const tableMatch = block.body.match(/^\s*__tablename__\s*=\s*['"]([^'"]+)['"]/m);
    const isDjango = /\bmodels\.[A-Za-z_]\w*(?:Field)?\b/.test(block.body);
    const isSqlAlchemy = tableMatch !== null || /\bColumn\s*\(/.test(block.body);
    if (!isDjango && !isSqlAlchemy) continue;

    const table = tableMatch ? safeLabel(tableMatch[1]) : null;
    const entity = table !== null
      ? table
      : (isDjango ? safeLabel(block.name) : safeLabel(block.name));
    if (entity === null) continue;

    records.push(recordCandidate({
      category: 'entity',
      dialect: isSqlAlchemy ? 'sqlalchemy' : 'django',
      signature: entitySignature(entity),
      details: { table: table ?? entity },
      path,
      line: classLine,
    }));

    if (isSqlAlchemy) {
      const { columns, fkTargets, relationships } = pythonColumnInfo(block.body, path);
      for (const column of columns) {
        if (column.name === null) continue;
        records.push(recordCandidate({
          category: 'field',
          dialect: 'sqlalchemy',
          signature: fieldSignature(entity, column.name),
          details: { type: column.type, nullable: !column.primary },
          path,
          line: classLine + column.line,
        }));
        if (column.primary) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'sqlalchemy',
            signature: keySignature(entity, column.name, 'primary'),
            details: { kind: 'primary', columns: [column.name] },
            path,
            line: classLine + column.line,
          }));
        }
        if (column.unique) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'sqlalchemy',
            signature: keySignature(entity, column.name, 'unique'),
            details: { kind: 'unique', columns: [column.name] },
            path,
            line: classLine + column.line,
          }));
        }
        if (column.indexed) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'sqlalchemy',
            signature: keySignature(entity, column.name, 'index'),
            details: { kind: 'index', columns: [column.name] },
            path,
            line: classLine + column.line,
          }));
        }
      }
      for (const fk of fkTargets) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sqlalchemy',
          signature: keySignature(entity, `${fk.column}_foreign`, 'foreign'),
          details: { kind: 'foreign', columns: [fk.column] },
          path,
          line: classLine + fk.line,
        }));
        const signature = relationSignature(entity, fk.target, 'foreign_key');
        records.push(recordCandidate({
          category: 'relation',
          dialect: 'sqlalchemy',
          signature,
          details: { kind: 'foreign_key', target: fk.target },
          path,
          line: classLine + fk.line,
        }));
        edges.push(relationEdgeCandidate({
          from: entity,
          to: fk.target,
          kind: 'foreign_key',
          path,
          line: classLine + fk.line,
          matchedKey: matchedKeyForRecord('relation', signature),
        }));
      }
      for (const relationship of relationships) {
        diagnostics.push(diagnostic(path, 'unverified', 'NAME_ONLY', classLine + relationship.line));
      }
      continue;
    }

    if (isDjango) {
      const fieldPattern = /^\s*([A-Za-z_]\w*)\s*=\s*(models\.[A-Za-z_]\w*(?:Field)?)\s*\(/gm;
      for (const match of block.body.matchAll(fieldPattern)) {
        const call = findCallArgsFrom(block.body, match.index + match[0].indexOf('models.'));
        const argsText = call ? call.args : '';
        const name = safeLabel(match[1]);
        const type = match[2].split('.').pop() ?? null;
        if (name === null) continue;
        const fieldLine = lineIndexOf(block.body, match.index) + classLine - 1;
        const primary = /\bprimary_key\s*=\s*True\b/.test(argsText);
        const unique = /\bunique\s*=\s*True\b/.test(argsText);
        const indexed = /\bdb_index\s*=\s*True\b/.test(argsText);
        records.push(recordCandidate({
          category: 'field',
          dialect: 'django',
          signature: fieldSignature(entity, name),
          details: { type, nullable: !primary },
          path,
          line: fieldLine,
        }));
        if (primary) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'django',
            signature: keySignature(entity, name, 'primary'),
            details: { kind: 'primary', columns: [name] },
            path,
            line: fieldLine,
          }));
        }
        if (unique) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'django',
            signature: keySignature(entity, name, 'unique'),
            details: { kind: 'unique', columns: [name] },
            path,
            line: fieldLine,
          }));
        }
        if (indexed) {
          records.push(recordCandidate({
            category: 'key',
            dialect: 'django',
            signature: keySignature(entity, name, 'index'),
            details: { kind: 'index', columns: [name] },
            path,
            line: fieldLine,
          }));
        }
        if (match[2].includes('ForeignKey') || match[2].includes('OneToOneField')
            || match[2].includes('ManyToManyField')) {
          const targetMatch = argsText.trim().match(/^(?:['"]([^'"]+)['"]|([A-Za-z_]\w*))/);
          const target = targetMatch ? safeLabel(targetMatch[1] ?? targetMatch[2]) : null;
          const kind = match[2].includes('ManyToManyField') ? 'many_to_many'
            : match[2].includes('OneToOneField') ? 'one_to_one'
            : 'foreign_key';
          if (target !== null) {
            const signature = relationSignature(entity, target, kind);
            records.push(recordCandidate({
              category: 'relation',
              dialect: 'django',
              signature,
              details: { kind, target },
              path,
              line: fieldLine,
            }));
            edges.push(relationEdgeCandidate({
              from: entity,
              to: target,
              kind,
              path,
              line: fieldLine,
              matchedKey: matchedKeyForRecord('relation', signature),
            }));
          }
        }
      }
    }
  }

  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript models (Sequelize)
// ---------------------------------------------------------------------------

function sequelizeAttributes(text, startIndex) {
  const open = text.indexOf('{', startIndex);
  if (open === -1) return null;
  const close = findMatching(text, '{', '}', open);
  if (close === -1) return null;
  return { block: text.slice(open + 1, close), line: lineIndexOf(text, open) };
}

function extractJavascriptModels(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');

  const definePattern = /\bsequelize\.define\s*\(/g;
  for (const match of source.matchAll(definePattern)) {
    const parenIndex = source.indexOf('(', match.index + match[0].length - 1);
    const close = findMatching(source, '(', ')', parenIndex);
    if (close === -1) continue;
    const call = source.slice(parenIndex + 1, close);
    const nameMatch = call.match(/^\s*['"]([^'"]+)['"]\s*,/);
    if (!nameMatch) continue;
    const entity = safeLabel(nameMatch[1]);
    if (entity === null) continue;
    const line = lineIndexOf(source, match.index);
    const attrs = sequelizeAttributes(call, call.indexOf(nameMatch[0]) + nameMatch[0].length);
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'sequelize',
      signature: entitySignature(entity),
      details: { table: entity },
      path,
      line,
    }));
    if (!attrs) continue;
    for (const entry of attributeEntriesFromBlock(attrs.block)) {
      const type = typeToken(entry.value) ?? 'Unknown';
      records.push(recordCandidate({
        category: 'field',
        dialect: 'sequelize',
        signature: fieldSignature(entity, entry.key),
        details: { type, nullable: !/\ballowNull\s*:\s*false\b/.test(entry.value) },
        path,
        line: line + attrs.line,
      }));
      if (/\bprimaryKey\s*:\s*true\b/.test(entry.value)) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sequelize',
          signature: keySignature(entity, entry.key, 'primary'),
          details: { kind: 'primary', columns: [entry.key] },
          path,
          line: line + attrs.line,
        }));
      }
      if (/\bunique\s*:\s*true\b/.test(entry.value)) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sequelize',
          signature: keySignature(entity, entry.key, 'unique'),
          details: { kind: 'unique', columns: [entry.key] },
          path,
          line: line + attrs.line,
        }));
      }
    }
  }

  const initPattern = /\b\.init\s*\(/g;
  for (const match of source.matchAll(initPattern)) {
    const parenIndex = source.indexOf('(', match.index + match[0].length - 1);
    const close = findMatching(source, '(', ')', parenIndex);
    if (close === -1) continue;
    const call = source.slice(parenIndex + 1, close);
    const nameMatch = call.match(/^\s*\{/);
    if (!nameMatch) continue;
    const attrs = sequelizeAttributes(call, 0);
    if (!attrs) continue;
    const classMatch = source.slice(0, match.index).match(/(?:class|const)\s+([A-Za-z_]\w*)\s+extends\s+Model\s*$/m);
    const entity = classMatch ? safeLabel(classMatch[1]) : null;
    if (entity === null) continue;
    const line = lineIndexOf(source, match.index);
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'sequelize',
      signature: entitySignature(entity),
      details: { table: entity },
      path,
      line,
    }));
    for (const entry of attributeEntriesFromBlock(attrs.block)) {
      const type = typeToken(entry.value) ?? 'Unknown';
      records.push(recordCandidate({
        category: 'field',
        dialect: 'sequelize',
        signature: fieldSignature(entity, entry.key),
        details: { type, nullable: !/\ballowNull\s*:\s*false\b/.test(entry.value) },
        path,
        line: line + attrs.line,
      }));
      if (/\bprimaryKey\s*:\s*true\b/.test(entry.value)) {
        records.push(recordCandidate({
          category: 'key',
          dialect: 'sequelize',
          signature: keySignature(entity, entry.key, 'primary'),
          details: { kind: 'primary', columns: [entry.key] },
          path,
          line: line + attrs.line,
        }));
      }
    }
  }

  const associationPattern = /([A-Za-z_]\w*)\.(belongsTo|belongsToMany|hasMany|hasOne)\s*\(\s*(?:['"]([^'"]+)['"]|([A-Za-z_]\w*))/g;
  for (const match of source.matchAll(associationPattern)) {
    const from = safeLabel(match[1]);
    const target = safeLabel(match[3] ?? match[4]);
    if (from === null || target === null) continue;
    const method = match[2];
    const line = lineIndexOf(source, match.index);
    const kind = method === 'belongsTo' ? 'belongs_to'
      : method === 'belongsToMany' ? 'belongs_to_many'
      : method === 'hasOne' ? 'has_one' : 'has_many';
    if (kind === 'belongs_to' || kind === 'belongs_to_many') {
      const signature = relationSignature(from, target, kind);
      records.push(recordCandidate({
        category: 'relation',
        dialect: 'sequelize',
        signature,
        details: { kind, target },
        path,
        line,
      }));
      edges.push(relationEdgeCandidate({
        from,
        to: target,
        kind,
        path,
        line,
        matchedKey: matchedKeyForRecord('relation', signature),
      }));
    } else {
      diagnostics.push(diagnostic(path, 'unverified', 'NAME_ONLY', line));
    }
  }

  const queuePattern = /\bnew\s+(?:Bull\s+)?Queue\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(queuePattern)) {
    const name = safeLabel(match[1]);
    if (name === null) continue;
    records.push(recordCandidate({
      category: 'queue',
      dialect: 'bullmq',
      signature: name,
      details: { scope: 'constructor' },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }
  const createQueuePattern = /\bcreateQueue\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(createQueuePattern)) {
    const name = safeLabel(match[1]);
    if (name === null) continue;
    records.push(recordCandidate({
      category: 'queue',
      dialect: 'bullmq',
      signature: name,
      details: { scope: 'constructor' },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }
  const cachePattern = /\bnew\s+Cache\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(cachePattern)) {
    const name = safeLabel(match[1]);
    if (name === null) continue;
    records.push(recordCandidate({
      category: 'cache',
      dialect: 'js-cache',
      signature: name,
      details: { scope: 'constructor' },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }
  const createCachePattern = /\bcreateCache\s*\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(createCachePattern)) {
    const name = safeLabel(match[1]);
    if (name === null) continue;
    records.push(recordCandidate({
      category: 'cache',
      dialect: 'js-cache',
      signature: name,
      details: { scope: 'constructor' },
      path,
      line: lineIndexOf(source, match.index),
    }));
  }

  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Rust models (Diesel)
// ---------------------------------------------------------------------------

function extractRustModels(text, path) {
  const records = [];
  const edges = [];
  const diagnostics = [];
  const source = String(text ?? '');
  const structTable = new Map();

  const tableNamePattern = /#\[table_name\s*=\s*"([^"]+)"\]\s*(?:#\[[^\]]*\]\s*)*pub\s+struct\s+([A-Za-z_]\w*)/g;
  for (const match of source.matchAll(tableNamePattern)) {
    const table = safeLabel(match[1]);
    if (table !== null) structTable.set(match[2], table);
  }

  const tablePattern = /\btable!\s*\{\s*([A-Za-z0-9_]+)\s*\(\s*([^)]*)\)\s*\{([\s\S]*?)\}\s*\}/g;
  for (const match of source.matchAll(tablePattern)) {
    const entity = safeLabel(match[1]);
    if (entity === null) continue;
    const line = lineIndexOf(source, match.index);
    records.push(recordCandidate({
      category: 'entity',
      dialect: 'diesel',
      signature: entitySignature(entity),
      details: { table: entity },
      path,
      line,
    }));
    const primaryColumns = match[2].split(',').map((entry) => safeLabel(entry.trim())).filter((entry) => entry !== null);
    if (primaryColumns.length > 0) {
      records.push(recordCandidate({
        category: 'key',
        dialect: 'diesel',
        signature: keySignature(entity, 'primary_key', 'primary'),
        details: { kind: 'primary', columns: primaryColumns },
        path,
        line,
      }));
    }
    const body = match[3];
    for (const rawLine of body.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      const columnMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+->\s+([A-Za-z_][\w<>:]*)/);
      if (!columnMatch) continue;
      const name = safeLabel(columnMatch[1]);
      if (name === null) continue;
      const type = columnMatch[2];
      records.push(recordCandidate({
        category: 'field',
        dialect: 'diesel',
        signature: fieldSignature(entity, name),
        details: { type, nullable: false },
        path,
        line: lineIndexOf(body, body.indexOf(trimmed)) + line - 1,
      }));
    }
  }

  const belongsPattern = /#\[belongs_to\s*\(\s*([A-Za-z_]\w*)\s*\)\]\s*(?:#\[[^\]]*\]\s*)*pub\s+struct\s+([A-Za-z_]\w*)/g;
  for (const match of source.matchAll(belongsPattern)) {
    const from = structTable.get(match[2]) ?? safeLabel(match[2]);
    const targetStruct = match[1];
    const target = structTable.get(targetStruct) ?? safeLabel(targetStruct);
    if (from === null || target === null) continue;
    const line = lineIndexOf(source, match.index);
    const signature = relationSignature(from, target, 'belongs_to');
    records.push(recordCandidate({
      category: 'relation',
      dialect: 'diesel',
      signature,
      details: { kind: 'belongs_to', target },
      path,
      line,
    }));
    edges.push(relationEdgeCandidate({
      from,
      to: target,
      kind: 'belongs_to',
      path,
      line,
      matchedKey: matchedKeyForRecord('relation', signature),
    }));
  }

  return { records, edges, diagnostics, capped: {} };
}

// ---------------------------------------------------------------------------
// Per-file dispatch
// ---------------------------------------------------------------------------

/**
 * Extract data-architecture candidate records from one bounded artifact.
 *
 * @param {object} input - `{ path, text, value, format, ecosystem }`.
 * @returns {{ records: object[], edges: object[], diagnostics: object[],
 *   capped: object }} Candidate records (not yet frozen; the model validates
 *   and freezes them), unresolved edge candidates, diagnostics, and per-file
 *   cap flags. Never throws on content; malformed or unsupported content
 *   produces diagnostics.
 */
export function extractDataArtifact({ path, text, value, format, ecosystem }) {
  const classification = classifyDataPath(path);
  const migration = migrationKindOf(path);
  const source = String(text ?? '');
  const other = { records: [], edges: [], diagnostics: [diagnostic(path, 'unsupported', 'UNSUPPORTED')], capped: {} };

  if (migration !== null) {
    if (migration === 'django') return boundedCollections(extractDjangoMigration(source, path), path);
    if (migration === 'alembic') return boundedCollections(extractAlembic(source, path), path);
    if (migration === 'sequelize') return boundedCollections(extractSequelizeMigration(source, path), path);
    if (migration === 'prisma') return boundedCollections(extractSqlMigration(source, path, 'prisma'), path);
    return boundedCollections(extractSqlMigration(source, path, migration), path);
  }

  switch (classification.kind) {
    case 'sql': return boundedCollections(extractSql(source, path), path);
    case 'prisma': return boundedCollections(extractPrisma(source, path), path);
    case 'python': return boundedCollections(extractPythonModels(source, path), path);
    case 'javascript':
    case 'typescript': return boundedCollections(extractJavascriptModels(source, path), path);
    case 'rust': return boundedCollections(extractRustModels(source, path), path);
    default: return other;
  }
}
