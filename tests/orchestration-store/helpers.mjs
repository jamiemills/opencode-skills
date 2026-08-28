"use strict";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore, resolveSqliteDriver } from "../../lib/orchestration-store/index.mjs";

const sqliteDriver = resolveSqliteDriver();

export const SQLITE_AVAILABLE = sqliteDriver.available;

export function cursorIdFor(name) {
  return `cursor-${name}`;
}

export async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "t006-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function withStore(options, fn) {
  const run = async (databasePath) => {
    const store = createSqliteStore(
      typeof options === "function" ? options(databasePath) : { ...options, databasePath },
    );
    try {
      return await fn(store);
    } finally {
      store.close();
    }
  };
  if (options?.mode === "memory" || options?.driver === "memory-js") return run(":memory:");
  return withTempDir((dir) => run(join(dir, "store.db")));
}

export function baseCursor(overrides = {}) {
  return {
    schema: "csm-orchestrate-cursor/2",
    cursorId: "cursor-cas-race",
    runId: "run-cas-race",
    phaseId: "phase-cas-race",
    routeState: "selected",
    checkpointState: "saved",
    attempt: 0,
    idempotencyKey: "phase-cas-key",
    childReceiptIds: [],
    updatedAt: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

export const FIXED_NOW = () => "2026-08-27T12:00:00.000Z";
