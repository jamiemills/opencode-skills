#!/usr/bin/env node
"use strict";

// AC6 daily check: validate that an orchestration-store backup exists, opens,
// and carries the coordination tables. Supports both backend formats:
// SQLite snapshots (VACUUM INTO) and memory-js JSON exports.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REQUIRED_TABLES = ["schema_version", "cursors", "events"];
const target = process.argv[2];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function printCounts(counts) {
  for (const table of REQUIRED_TABLES) console.log(`  ${table} rows: ${counts[table]}`);
}

if (!target) fail("usage: node scripts/verify-orchestration-backup.mjs <backup-file>");

const backupPath = path.resolve(target);
if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile())
  fail(`backup file not found: ${backupPath}`);

const head = fs.readFileSync(backupPath).subarray(0, 1);
if (head[0] === 0x7b) {
  // "{" — memory-js JSON export.
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  } catch (error) {
    fail(`backup is not valid JSON: ${error.message}`);
  }
  if (snapshot?.schema !== "csm-orchestration-store-backup/1")
    fail("backup JSON is not an orchestration-store export");
  const counts = {};
  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(snapshot.tables?.[table])) fail(`missing table ${table}`);
    counts[table] = snapshot.tables[table].length;
  }
  printCounts(counts);
  console.log(`PASS: ${backupPath} (memory-js export)`);
  process.exit(0);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite"));
} catch {
  fail("node:sqlite is unavailable; cannot verify a SQLite backup");
}

let db;
try {
  db = new DatabaseSync(backupPath, { readOnly: true });
} catch (error) {
  fail(`backup is not a restorable SQLite database: ${error.message}`);
}

try {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const verdict = String(integrity?.integrity_check ?? integrity?.integrityCheck ?? "unknown");
  if (verdict !== "ok") fail(`integrity_check reported ${verdict}`);
  const present = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  const counts = {};
  for (const table of REQUIRED_TABLES) {
    if (!present.has(table)) fail(`missing table ${table}`);
    counts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
  }
  printCounts(counts);
  console.log(`PASS: ${backupPath}`);
  process.exit(0);
} finally {
  db.close();
}
