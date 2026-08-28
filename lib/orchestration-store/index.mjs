"use strict";

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// T006 SQLite WAL durable coordination store.
//
// Driver decision (prerequisite spike, recorded in docs/config-inventory.md):
// the built-in `node:sqlite` DatabaseSync is the preferred driver — zero
// dependencies, WAL-capable, available without a flag since Node 22.13.
// When `node:sqlite` is unavailable (Node < 22.13, or a runtime without the
// builtin), the same store interface runs on a pure-JS single-process engine
// so the seam stays testable; multi-process durability requires the sqlite
// backend. The store INTERFACE is the contract; the driver is swappable.

export const STORE_SCHEMA_VERSION = 1;

const CURSOR_ID = /^cursor-[a-z0-9][a-z0-9-]{1,127}$/;
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const PHASE_ID = /^phase-[a-z0-9][a-z0-9-]{1,127}$/;
const CHILD_RUN_ID = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const RESOLVED_OUTCOME = /^RESOLVED-[A-Z0-9-]+$/;
const INTENT_STATUSES = new Set(["dispatched", "completed", "failed", "cancelled"]);
const TERMINAL_RECORD_STATUS = new Map([
  ["VERIFIED", "completed"],
  ["completed", "completed"],
  ["REJECTED", "failed"],
  ["failed", "failed"],
  ["BLOCKED", "blocked"],
  ["blocked", "blocked"],
  ["REQUIRES_REVIEW", "blocked"],
  ["incomplete", "incomplete"],
]);

export class OrchestrationStoreError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = "OrchestrationStoreError";
    this.info = info;
  }
}

export class StoreClosedError extends OrchestrationStoreError {
  constructor() {
    super("orchestration store is closed");
    this.name = "StoreClosedError";
  }
}

export class CasMismatchError extends OrchestrationStoreError {
  constructor(info) {
    super(`cursor revision mismatch for ${info.cursorId}`, info);
    this.name = "CasMismatchError";
  }
}

export class StaleFenceError extends OrchestrationStoreError {
  constructor(info) {
    super(`stale fencing token for ${info.cursorId}`, info);
    this.name = "StaleFenceError";
  }
}

export class ApprovalAlreadyConsumedError extends OrchestrationStoreError {
  constructor(info) {
    super(`approval ${info.approvalId} was already consumed`, info);
    this.name = "ApprovalAlreadyConsumedError";
  }
}

export class DuplicateIdempotencyError extends OrchestrationStoreError {
  constructor(info) {
    super(`idempotency key ${info.key} already recorded`, info);
    this.name = "DuplicateIdempotencyError";
  }
}

export class MonotonicTerminalError extends OrchestrationStoreError {
  constructor(info) {
    super(`terminal record ${info.receiptId ?? info.reconciliationId} cannot be overwritten`, info);
    this.name = "MonotonicTerminalError";
  }
}

export class ReconciliationRequiredError extends OrchestrationStoreError {
  constructor(info) {
    super(`reconciliation required before dispatch for ${info.childRunId}`, info);
    this.name = "ReconciliationRequiredError";
  }
}

export class IntentResolutionError extends OrchestrationStoreError {
  constructor(info) {
    super(`dispatch intent ${info.intentId} cannot be resolved to ${info.status}`, info);
    this.name = "IntentResolutionError";
  }
}

let cachedDriver;

export function resolveSqliteDriver() {
  if (cachedDriver) return cachedDriver;
  const require = createRequire(import.meta.url);
  try {
    const sqlite = require("node:sqlite");
    if (sqlite && typeof sqlite.DatabaseSync === "function") {
      cachedDriver = { available: true, module: "node:sqlite", DatabaseSync: sqlite.DatabaseSync };
      return cachedDriver;
    }
  } catch {
    // Unavailable (Node < 22.13 or builtin disabled): fall through.
  }
  cachedDriver = { available: false, module: null, DatabaseSync: null };
  return cachedDriver;
}

// Column whitelists double as the migration-v1 table registry. Identifiers are
// only ever interpolated from this map; values are always bound parameters.
const TABLES = {
  schema_version: { pk: "version", autoPk: true, columns: ["version"] },
  cursors: {
    pk: "cursor_id",
    columns: [
      "cursor_id",
      "run_id",
      "phase_id",
      "revision",
      "state",
      "child_run_id",
      "attempt",
      "idempotency_key",
      "updated_at",
      "document",
    ],
  },
  fencing_tokens: {
    pk: "token_id",
    autoPk: true,
    columns: ["token_id", "cursor_id", "run_id", "token", "issued_at"],
  },
  approvals: { pk: "approval_id", columns: ["approval_id", "consumed_at", "consumed_by_cursor"] },
  idempotency: { pk: "key", columns: ["key", "cursor_id", "created_at"] },
  dispatch_intents: {
    pk: "intent_id",
    columns: [
      "intent_id",
      "cursor_id",
      "child_run_id",
      "fencing_token",
      "status",
      "created_at",
      "resolved_at",
    ],
  },
  events: {
    pk: "sequence",
    autoPk: true,
    columns: ["sequence", "cursor_id", "event_type", "payload", "occurred_at"],
  },
  terminal_receipts: {
    pk: "receipt_id",
    columns: ["receipt_id", "run_id", "phase_id", "status", "payload", "published_at"],
  },
  reconciliations: {
    pk: "reconciliation_id",
    columns: ["reconciliation_id", "child_run_id", "outcome", "resolved_at", "details"],
  },
};

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cursors (
  cursor_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  child_run_id TEXT,
  attempt INTEGER DEFAULT 0,
  idempotency_key TEXT,
  updated_at TEXT NOT NULL,
  document TEXT NOT NULL,
  UNIQUE(cursor_id)
);
CREATE TABLE IF NOT EXISTS fencing_tokens (
  token_id INTEGER PRIMARY KEY AUTOINCREMENT,
  cursor_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  token INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE(cursor_id)
);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  consumed_at TEXT,
  consumed_by_cursor TEXT,
  UNIQUE(approval_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  cursor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatch_intents (
  intent_id TEXT PRIMARY KEY,
  cursor_id TEXT NOT NULL,
  child_run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  cursor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS terminal_receipts (
  receipt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  child_run_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'UNKNOWN',
  resolved_at TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_cursor ON events(cursor_id);
CREATE INDEX IF NOT EXISTS idx_terminal_receipts_run ON terminal_receipts(run_id);
CREATE INDEX IF NOT EXISTS idx_reconciliations_child ON reconciliations(child_run_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_intents_cursor ON dispatch_intents(cursor_id);
`;

const MIGRATIONS = [{ version: 1, sql: MIGRATION_V1 }];

function table(name) {
  const def = TABLES[name];
  if (!def) throw new OrchestrationStoreError(`unknown table ${name}`);
  return def;
}

function assertBindable(row, name) {
  const def = table(name);
  for (const column of Object.keys(row)) {
    if (!def.columns.includes(column))
      throw new OrchestrationStoreError(`unknown column ${name}.${column}`);
  }
}

function sqliteBusy(error) {
  return /SQLITE_BUSY|database is locked/i.test(String(error?.message ?? error));
}

function createSqliteEngine({ databasePath, synchronous = "FULL", busyTimeoutMs = 5000 }) {
  const { DatabaseSync } = resolveSqliteDriver();
  const db = new DatabaseSync(databasePath);
  const statements = new Map();
  let depth = 0;

  db.exec(`PRAGMA busy_timeout=${Number(busyTimeoutMs)}`);
  if (databasePath !== ":memory:") {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec(`PRAGMA synchronous=${synchronous === "NORMAL" ? "NORMAL" : "FULL"}`);
  } else {
    db.exec("PRAGMA synchronous=FULL");
  }
  db.exec("PRAGMA foreign_keys=ON");

  const prepare = (sql) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  const engine = {
    backend: "sqlite",

    migrate() {
      // Bootstrap the version ledger before reading it; the table itself is
      // idempotent DDL so concurrent openers converge on the same shape.
      db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");
      engine.transaction(() => {
        const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version").get();
        const applied = Number(row?.v ?? 0);
        for (const migration of MIGRATIONS) {
          if (migration.version <= applied) continue;
          db.exec(migration.sql);
          db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
        }
      });
      return engine.currentVersion();
    },

    currentVersion() {
      const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version").get();
      return Number(row?.v ?? 0);
    },

    transaction(fn) {
      if (depth > 0) return fn();
      let attempts = 0;
      for (;;) {
        try {
          db.exec("BEGIN IMMEDIATE");
        } catch (error) {
          attempts += 1;
          if (sqliteBusy(error) && attempts < 8) continue;
          throw error;
        }
        break;
      }
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec("COMMIT");
        return result;
      } catch (error) {
        depth -= 1;
        try {
          db.exec("ROLLBACK");
        } catch {
          // Connection may already be unwinding; surface the original error.
        }
        throw error;
      }
    },

    insert(name, row) {
      assertBindable(row, name);
      const def = table(name);
      const columns = Object.keys(row);
      const sql = `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`;
      const result = prepare(sql).run(...columns.map((column) => row[column]));
      const lastId = def.autoPk ? Number(result.lastInsertRowid) : row[def.pk];
      return { lastId };
    },

    get(name, key) {
      const def = table(name);
      const row = prepare(`SELECT * FROM ${name} WHERE ${def.pk} = ?`).get(key);
      return row ? normalizeRow(row) : null;
    },

    updateWhere(name, where, patch) {
      assertBindable(where, name);
      assertBindable(patch, name);
      const whereColumns = Object.keys(where);
      if (!whereColumns.length)
        throw new OrchestrationStoreError("updateWhere requires a predicate");
      const patchColumns = Object.keys(patch);
      if (!patchColumns.length) return 0;
      const sql =
        `UPDATE ${name} SET ${patchColumns.map((c) => `${c} = ?`).join(", ")} ` +
        `WHERE ${whereColumns.map((c) => `${c} = ?`).join(" AND ")}`;
      const result = prepare(sql).run(
        ...patchColumns.map((c) => patch[c]),
        ...whereColumns.map((c) => where[c]),
      );
      return Number(result.changes);
    },

    selectWhere(name, where) {
      assertBindable(where, name);
      const def = table(name);
      const columns = Object.keys(where);
      const clauses = columns.length
        ? ` WHERE ${columns.map((c) => `${c} = ?`).join(" AND ")}`
        : "";
      const rows = prepare(`SELECT * FROM ${name}${clauses} ORDER BY ${def.pk} ASC`).all(
        ...columns.map((c) => where[c]),
      );
      return rows.map(normalizeRow);
    },

    journalMode() {
      const row = db.prepare("PRAGMA journal_mode").get();
      return String(row?.journal_mode ?? row?.journalMode ?? "unknown");
    },

    backup(targetPath) {
      // VACUUM INTO writes a consistent, self-contained snapshot; it cannot
      // run inside a transaction and refuses to clobber an existing file.
      db.prepare("VACUUM INTO ?").run(targetPath);
    },

    close() {
      db.close();
    },
  };

  return engine;
}

function createMemoryJsEngine() {
  const tables = new Map(Object.keys(TABLES).map((name) => [name, new Map()]));
  const counters = new Map();
  let depth = 0;
  let closed = false;

  const rows = (name) => {
    const t = tables.get(name);
    if (!t) throw new OrchestrationStoreError(`unknown table ${name}`);
    return t;
  };

  const engine = {
    backend: "memory-js",

    migrate() {
      const applied = rows("schema_version");
      const current = Math.max(0, ...[...applied.keys()].map(Number));
      for (const migration of MIGRATIONS) {
        if (migration.version <= current) continue;
        applied.set(migration.version, { version: migration.version });
      }
      return engine.currentVersion();
    },

    currentVersion() {
      const applied = rows("schema_version");
      return Math.max(0, ...[...applied.keys()].map(Number));
    },

    transaction(fn) {
      // Structural note: no rollback on throw — every store operation is a
      // single synchronized transaction whose steps are validated before any
      // mutation, so a throw leaves the pre-transaction state untouched.
      depth += 1;
      try {
        return fn();
      } finally {
        depth -= 1;
      }
    },

    insert(name, row) {
      assertBindable(row, name);
      const def = table(name);
      const record = { ...row };
      if (def.autoPk && record[def.pk] === undefined) {
        const next = (counters.get(name) ?? 0) + 1;
        counters.set(name, next);
        record[def.pk] = next;
      }
      const key = record[def.pk];
      if (rows(name).has(key))
        throw new OrchestrationStoreError(`constraint failed: ${name}.${def.pk} exists`);
      rows(name).set(key, record);
      return { lastId: key };
    },

    get(name, key) {
      const record = rows(name).get(key);
      return record ? { ...record } : null;
    },

    updateWhere(name, where, patch) {
      let changes = 0;
      for (const [key, record] of rows(name)) {
        const matches = Object.entries(where).every(([column, value]) => record[column] === value);
        if (!matches) continue;
        rows(name).set(key, { ...record, ...patch });
        changes += 1;
      }
      return changes;
    },

    selectWhere(name, where) {
      const result = [];
      for (const record of rows(name).values()) {
        if (Object.entries(where).every(([column, value]) => record[column] === value))
          result.push({ ...record });
      }
      return result;
    },

    journalMode() {
      return "memory";
    },

    backup(targetPath) {
      const snapshot = {
        schema: "csm-orchestration-store-backup/1",
        backend: "memory-js",
        schemaVersion: engine.currentVersion(),
        createdAt: new Date().toISOString(),
        tables: Object.fromEntries(
          [...tables.entries()].map(([name, tableRows]) => [name, [...tableRows.values()]]),
        ),
      };
      fs.writeFileSync(targetPath, JSON.stringify(snapshot));
    },

    close() {
      closed = true;
      tables.clear();
    },

    isClosed() {
      return closed;
    },
  };

  return engine;
}

function normalizeRow(row) {
  const copy = {};
  for (const [key, value] of Object.entries(row)) copy[key] = value === undefined ? null : value;
  return copy;
}

function fail(message) {
  throw new OrchestrationStoreError(message);
}

function assertCanonical(value, pattern, label) {
  if (!pattern.test(String(value ?? ""))) fail(`${label} is not canonical`);
}

function assertNonEmptyString(value, label, maxLength = 512) {
  if (typeof value !== "string" || !value.length || value.length > maxLength)
    fail(`${label} must be a non-empty string`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${label} is not valid JSON`);
  }
}

function terminalRecordStatus(receipt) {
  const raw =
    (receipt.outcome && typeof receipt.outcome === "object" && receipt.outcome?.status) ??
    (typeof receipt.outcome === "string" ? receipt.outcome : null) ??
    (Array.isArray(receipt.statuses) ? receipt.statuses[0] : null);
  return TERMINAL_RECORD_STATUS.get(raw) ?? "blocked";
}

export function createSqliteStore(options = {}) {
  const mode = options.mode === "memory" ? "memory" : "wal";
  const driverPreference =
    options.driver === "memory-js"
      ? "memory-js"
      : options.driver === "node-sqlite"
        ? "node-sqlite"
        : "auto";
  const driver = resolveSqliteDriver();
  const now =
    typeof options.now === "function" ? () => options.now() : () => new Date().toISOString();

  let engineBackend;
  let databasePath = null;
  if (driverPreference === "memory-js") {
    engineBackend = createMemoryJsEngine();
  } else if (mode === "memory") {
    engineBackend = driver.available
      ? createSqliteEngine({ ...options, databasePath: ":memory:" })
      : createMemoryJsEngine();
  } else {
    if (!driver.available) {
      // WAL durability requires node:sqlite; degrade explicitly rather than
      // silently pretending a Map is durable.
      engineBackend = createMemoryJsEngine();
    } else {
      databasePath =
        options.databasePath ??
        path.join(os.tmpdir(), `csm-orchestration-${process.pid}-${randomUUID()}.db`);
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      engineBackend = createSqliteEngine({ databasePath, ...options });
    }
  }
  const schemaVersion = engineBackend.migrate();

  let closed = false;
  const guard = () => {
    if (closed || engineBackend.isClosed?.()) throw new StoreClosedError();
  };

  const appendEventTx = (cursorId, eventType, payload) => {
    const occurredAt = now();
    let encoded;
    try {
      encoded = JSON.stringify(payload ?? {});
    } catch {
      return fail("event payload is not JSON-serializable");
    }
    const { lastId } = engineBackend.insert("events", {
      cursor_id: cursorId,
      event_type: eventType,
      payload: encoded,
      occurred_at: occurredAt,
    });
    return { sequence: Number(lastId), cursorId, eventType, occurredAt };
  };

  const fencingRow = (cursorId) =>
    engineBackend.selectWhere("fencing_tokens", { cursor_id: cursorId })[0] ?? null;

  const reconciliationRow = (childRunId) =>
    engineBackend.selectWhere("reconciliations", { child_run_id: childRunId })[0] ?? null;

  const store = {
    backend: engineBackend.backend,
    databasePath,
    schemaVersion,

    getBackendInfo() {
      return {
        backend: engineBackend.backend,
        journalMode: engineBackend.journalMode(),
        databasePath,
        schemaVersion: engineBackend.currentVersion(),
        durable: engineBackend.backend === "sqlite" && databasePath !== null,
      };
    },

    async saveCursor(cursor, saveOptions = {}) {
      guard();
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
        fail("cursor document is required");
      assertCanonical(cursor.cursorId, CURSOR_ID, "cursorId");
      assertCanonical(cursor.runId, RUN_ID, "runId");
      assertCanonical(cursor.phaseId, PHASE_ID, "phaseId");
      if (cursor.childRunId !== undefined && cursor.childRunId !== null)
        assertCanonical(cursor.childRunId, CHILD_RUN_ID, "childRunId");

      const { revision: cursorRevision, fencingToken: cursorFence, ...document } = cursor;
      const expectedRevision = saveOptions.expectedRevision ?? cursorRevision;
      const providedToken = saveOptions.fencingToken ?? cursorFence;
      const updatedAt = now();

      return engineBackend.transaction(() => {
        const existing = engineBackend.get("cursors", cursor.cursorId);
        const currentRevision = Number(existing?.revision ?? 0);
        if (expectedRevision !== undefined && expectedRevision !== currentRevision)
          throw new CasMismatchError({
            cursorId: cursor.cursorId,
            expectedRevision,
            currentRevision,
          });
        const fence = fencingRow(cursor.cursorId);
        if (providedToken !== undefined && fence && Number(providedToken) < Number(fence.token))
          throw new StaleFenceError({
            cursorId: cursor.cursorId,
            providedToken: Number(providedToken),
            currentToken: Number(fence.token),
          });
        const nextRevision = currentRevision + 1;
        const row = {
          cursor_id: cursor.cursorId,
          run_id: cursor.runId,
          phase_id: cursor.phaseId,
          revision: nextRevision,
          state: String(cursor.checkpointState ?? cursor.routeState ?? "unknown"),
          child_run_id: cursor.childRunId ?? null,
          attempt: Number(cursor.attempt ?? 0),
          idempotency_key: cursor.idempotencyKey ?? null,
          updated_at: updatedAt,
          document: JSON.stringify(document),
        };
        if (existing) engineBackend.updateWhere("cursors", { cursor_id: row.cursor_id }, row);
        else engineBackend.insert("cursors", row);
        appendEventTx(cursor.cursorId, "cursor-saved", { revision: nextRevision });
        return { ...document, cursorId: cursor.cursorId };
      });
    },

    async loadCursor(cursorId) {
      guard();
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      const row = engineBackend.get("cursors", cursorId);
      return row ? parseJson(row.document, "cursor document") : null;
    },

    async listCursorIds(runId) {
      guard();
      if (runId !== undefined) assertCanonical(runId, RUN_ID, "runId");
      const rows = engineBackend.selectWhere(
        "cursors",
        runId === undefined ? {} : { run_id: runId },
      );
      return rows.map((row) => row.cursor_id);
    },

    async getCursorMeta(cursorId) {
      guard();
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      const row = engineBackend.get("cursors", cursorId);
      if (!row) return null;
      const fence = fencingRow(cursorId);
      return {
        cursorId,
        revision: Number(row.revision),
        fencingToken: fence ? Number(fence.token) : null,
        updatedAt: row.updated_at,
      };
    },

    async claimCursor(cursorId, expectedRevision, meta = {}) {
      guard();
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
        fail("expectedRevision must be a non-negative integer");
      const claimedAt = now();
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("cursors", cursorId);
        if (!existing && !(meta.runId && meta.phaseId))
          throw new OrchestrationStoreError(`unknown cursor ${cursorId}; runId/phaseId required`, {
            cursorId,
          });
        const currentRevision = Number(existing?.revision ?? 0);
        if (expectedRevision !== currentRevision)
          throw new CasMismatchError({ cursorId, expectedRevision, currentRevision });
        const fence = fencingRow(cursorId);
        const token = Number(fence?.token ?? 0) + 1;
        if (fence) {
          engineBackend.updateWhere(
            "fencing_tokens",
            { cursor_id: cursorId },
            { token, issued_at: claimedAt },
          );
        } else {
          engineBackend.insert("fencing_tokens", {
            cursor_id: cursorId,
            run_id: existing?.run_id ?? meta.runId,
            token,
            issued_at: claimedAt,
          });
        }
        const nextRevision = currentRevision + 1;
        if (existing) {
          engineBackend.updateWhere(
            "cursors",
            { cursor_id: cursorId },
            { revision: nextRevision, updated_at: claimedAt },
          );
        } else {
          engineBackend.insert("cursors", {
            cursor_id: cursorId,
            run_id: meta.runId,
            phase_id: meta.phaseId,
            revision: nextRevision,
            state: meta.state ?? "claimed",
            child_run_id: meta.childRunId ?? null,
            attempt: Number(meta.attempt ?? 0),
            idempotency_key: meta.idempotencyKey ?? null,
            updated_at: claimedAt,
            document: JSON.stringify(
              meta.document ?? { cursorId, runId: meta.runId, phaseId: meta.phaseId },
            ),
          });
        }
        appendEventTx(cursorId, "cursor-claimed", { revision: nextRevision, fencingToken: token });
        return { cursorId, revision: nextRevision, fencingToken: token };
      });
    },

    async consumeApproval(approvalId, cursorId) {
      guard();
      assertNonEmptyString(approvalId, "approvalId");
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      const consumedAt = now();
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("approvals", approvalId);
        if (existing)
          throw new ApprovalAlreadyConsumedError({
            approvalId,
            consumedAt: existing.consumed_at,
            consumedByCursor: existing.consumed_by_cursor,
          });
        engineBackend.insert("approvals", {
          approval_id: approvalId,
          consumed_at: consumedAt,
          consumed_by_cursor: cursorId,
        });
        appendEventTx(cursorId, "approval-consumed", { approvalId });
        return { approvalId, consumedAt, consumedByCursor: cursorId };
      });
    },

    async recordIdempotency(key, cursorId) {
      guard();
      assertNonEmptyString(key, "idempotency key");
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      const createdAt = now();
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("idempotency", key);
        if (existing)
          throw new DuplicateIdempotencyError({
            key,
            cursorId: existing.cursor_id,
            createdAt: existing.created_at,
          });
        engineBackend.insert("idempotency", { key, cursor_id: cursorId, created_at: createdAt });
        appendEventTx(cursorId, "idempotency-recorded", { key });
        return { key, cursorId, createdAt };
      });
    },

    async createDispatchIntent(cursorId, childRunId, fencingToken) {
      guard();
      assertCanonical(cursorId, CURSOR_ID, "cursorId");
      assertCanonical(childRunId, CHILD_RUN_ID, "childRunId");
      if (!Number.isInteger(fencingToken) || fencingToken < 1)
        fail("fencingToken must be a positive integer");
      const createdAt = now();
      const intentId = `intent:${cursorId}:${childRunId}:${fencingToken}`;
      return engineBackend.transaction(() => {
        const fence = fencingRow(cursorId);
        if (!fence)
          throw new OrchestrationStoreError(
            `cursor ${cursorId} has no fencing token; claim first`,
            {
              cursorId,
            },
          );
        if (fencingToken < Number(fence.token))
          throw new StaleFenceError({
            cursorId,
            providedToken: fencingToken,
            currentToken: Number(fence.token),
          });
        if (fencingToken > Number(fence.token))
          throw new OrchestrationStoreError(`fencing token ${fencingToken} was never issued`, {
            cursorId,
            providedToken: fencingToken,
            currentToken: Number(fence.token),
          });
        const reconciliation = reconciliationRow(childRunId);
        if (reconciliation && reconciliation.outcome === "UNKNOWN")
          throw new ReconciliationRequiredError({
            childRunId,
            reconciliationId: reconciliation.reconciliation_id,
          });
        const existing = engineBackend.get("dispatch_intents", intentId);
        if (existing)
          return {
            intentId,
            cursorId: existing.cursor_id,
            childRunId: existing.child_run_id,
            fencingToken: Number(existing.fencing_token),
            status: existing.status,
            createdAt: existing.created_at,
            resolvedAt: existing.resolved_at,
            created: false,
          };
        engineBackend.insert("dispatch_intents", {
          intent_id: intentId,
          cursor_id: cursorId,
          child_run_id: childRunId,
          fencing_token: fencingToken,
          status: "pending",
          created_at: createdAt,
          resolved_at: null,
        });
        appendEventTx(cursorId, "dispatch-intent-created", { intentId, childRunId, fencingToken });
        return {
          intentId,
          cursorId,
          childRunId,
          fencingToken,
          status: "pending",
          createdAt,
          resolvedAt: null,
          created: true,
        };
      });
    },

    async resolveDispatchIntent(intentId, status) {
      guard();
      assertNonEmptyString(intentId, "intentId");
      if (!INTENT_STATUSES.has(status)) fail(`unsupported dispatch intent status ${status}`);
      const resolvedAt = now();
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("dispatch_intents", intentId);
        if (!existing) throw new OrchestrationStoreError(`unknown dispatch intent ${intentId}`);
        if (existing.resolved_at !== null && existing.status !== status)
          throw new IntentResolutionError({
            intentId,
            status,
            existingStatus: existing.status,
            resolvedAt: existing.resolved_at,
          });
        if (existing.resolved_at !== null)
          return {
            intentId,
            status: existing.status,
            resolvedAt: existing.resolved_at,
            changed: false,
          };
        engineBackend.updateWhere(
          "dispatch_intents",
          { intent_id: intentId },
          { status, resolved_at: resolvedAt },
        );
        appendEventTx(existing.cursor_id, "dispatch-intent-resolved", { intentId, status });
        return { intentId, status, resolvedAt, changed: true };
      });
    },

    async appendEvent(cursorId, eventType, payload) {
      guard();
      assertNonEmptyString(cursorId, "cursorId");
      assertNonEmptyString(eventType, "eventType", 128);
      return engineBackend.transaction(() => appendEventTx(cursorId, eventType, payload ?? {}));
    },

    async getHistory(cursorId) {
      guard();
      assertNonEmptyString(cursorId, "cursorId");
      return engineBackend.selectWhere("events", { cursor_id: cursorId }).map((row) => ({
        sequence: Number(row.sequence),
        cursorId: row.cursor_id,
        eventType: row.event_type,
        payload: parseJson(row.payload, "event payload"),
        occurredAt: row.occurred_at,
      }));
    },

    async saveTerminalReceipt(receipt) {
      guard();
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
        fail("terminal receipt is required");
      assertNonEmptyString(receipt.receiptId, "receiptId");
      assertCanonical(receipt.runId, RUN_ID, "runId");
      assertCanonical(receipt.phaseId, PHASE_ID, "phaseId");
      const status = terminalRecordStatus(receipt);
      const publishedAt = now();
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("terminal_receipts", receipt.receiptId);
        if (existing)
          throw new MonotonicTerminalError({
            receiptId: receipt.receiptId,
            existingStatus: existing.status,
            existingPublishedAt: existing.published_at,
          });
        engineBackend.insert("terminal_receipts", {
          receipt_id: receipt.receiptId,
          run_id: receipt.runId,
          phase_id: receipt.phaseId,
          status,
          payload: JSON.stringify(receipt),
          published_at: publishedAt,
        });
        appendEventTx(`terminal:${receipt.receiptId}`, "terminal-receipt-published", {
          runId: receipt.runId,
          phaseId: receipt.phaseId,
          status,
        });
        return { ...receipt };
      });
    },

    async loadTerminalReceipt(receiptId) {
      guard();
      assertNonEmptyString(receiptId, "receiptId");
      const row = engineBackend.get("terminal_receipts", receiptId);
      return row ? parseJson(row.payload, "terminal receipt") : null;
    },

    async loadTerminalRecords(childRunId) {
      guard();
      assertCanonical(childRunId, CHILD_RUN_ID, "childRunId");
      return engineBackend.selectWhere("terminal_receipts", { run_id: childRunId }).map((row) => {
        const receipt = parseJson(row.payload, "terminal receipt");
        const status = terminalRecordStatus(receipt);
        return {
          receiptId: row.receipt_id,
          runId: row.run_id,
          childRunId: row.run_id,
          status,
          publishedAt: row.published_at,
          result: { status, receiptId: row.receipt_id, outcome: receipt.outcome ?? null },
        };
      });
    },

    async recordReconciliation(childRunId, outcome, details = null) {
      guard();
      assertCanonical(childRunId, CHILD_RUN_ID, "childRunId");
      if (outcome !== "UNKNOWN" && !RESOLVED_OUTCOME.test(outcome))
        fail('outcome must be "UNKNOWN" or "RESOLVED-*"');
      const recordedAt = now();
      const reconciliationId = `recon:${childRunId}`;
      return engineBackend.transaction(() => {
        const existing = engineBackend.get("reconciliations", reconciliationId);
        const resolvedAt = outcome === "UNKNOWN" ? null : recordedAt;
        const encodedDetails = details === null ? null : JSON.stringify(details);
        if (existing) {
          if (existing.outcome !== "UNKNOWN") {
            if (outcome !== existing.outcome)
              throw new MonotonicTerminalError({
                reconciliationId,
                childRunId,
                existingOutcome: existing.outcome,
                requestedOutcome: outcome,
              });
          } else {
            engineBackend.updateWhere(
              "reconciliations",
              { reconciliation_id: reconciliationId },
              { outcome, resolved_at: resolvedAt, details: encodedDetails },
            );
          }
        } else {
          engineBackend.insert("reconciliations", {
            reconciliation_id: reconciliationId,
            child_run_id: childRunId,
            outcome,
            resolved_at: resolvedAt,
            details: encodedDetails,
          });
        }
        appendEventTx(`reconciliation:${childRunId}`, "reconciliation-recorded", { outcome });
        const row = engineBackend.get("reconciliations", reconciliationId);
        return {
          reconciliationId,
          childRunId,
          outcome: row.outcome,
          resolvedAt: row.resolved_at,
          details: row.details ? parseJson(row.details, "reconciliation details") : null,
        };
      });
    },

    async recordLateResult(childRunId, result) {
      guard();
      assertCanonical(childRunId, CHILD_RUN_ID, "childRunId");
      const recordedAt = now();
      const reconciliationId = `recon:${childRunId}`;
      return engineBackend.transaction(() => {
        appendEventTx(`reconciliation:${childRunId}`, "late-result", { result: result ?? null });
        const existing = engineBackend.get("reconciliations", reconciliationId);
        let resolved = false;
        if (existing && existing.outcome === "UNKNOWN") {
          engineBackend.updateWhere(
            "reconciliations",
            { reconciliation_id: reconciliationId },
            {
              outcome: "RESOLVED-LATE-RESULT",
              resolved_at: recordedAt,
              details: JSON.stringify({
                priorDetails: existing.details ? parseJson(existing.details, "details") : null,
                lateResult: result ?? null,
              }),
            },
          );
          resolved = true;
        }
        return {
          childRunId,
          recordedAsEvent: true,
          reconciliationResolved: resolved,
          terminalStateModified: false,
        };
      });
    },

    async getReconciliation(childRunId) {
      guard();
      assertCanonical(childRunId, CHILD_RUN_ID, "childRunId");
      const row = reconciliationRow(childRunId);
      if (!row) return null;
      return {
        reconciliationId: row.reconciliation_id,
        childRunId: row.child_run_id,
        outcome: row.outcome,
        resolvedAt: row.resolved_at,
        details: row.details ? parseJson(row.details, "reconciliation details") : null,
      };
    },

    async getSchemaVersion() {
      guard();
      return engineBackend.currentVersion();
    },

    async backup(targetPath) {
      guard();
      if (typeof targetPath !== "string" || !targetPath.length)
        fail("backup target path must be a non-empty string");
      const resolved = path.resolve(targetPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      // VACUUM INTO refuses to overwrite an existing file; removing a prior
      // snapshot first keeps scheduled re-backups to the same path idempotent.
      fs.rmSync(resolved, { force: true });
      const timestamp = now();
      engineBackend.backup(resolved);
      const bytes = fs.statSync(resolved).size;
      if (!Number.isFinite(bytes) || bytes <= 0) fail("backup produced an empty file");
      return { path: resolved, bytes, timestamp };
    },

    close() {
      if (closed) return;
      closed = true;
      engineBackend.close();
    },
  };

  return store;
}

export default { createSqliteStore, resolveSqliteDriver };
