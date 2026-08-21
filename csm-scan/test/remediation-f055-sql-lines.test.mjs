// F-055 — SQL DDL evidence line numbers are resolved from FULL-source offsets.
//
// Before this fix sqlStatements split+trimmed the source (destroying offsets)
// and line resolution used statement-relative indexes against the full source,
// so nearly every SQL DDL record reported line 1. After the fix statements
// carry their source start offset and evidence lines search the full source.
// This test uses a multi-statement SQL fixture (the finding's requested case).

import assert from "node:assert/strict";
import { test } from "node:test";

import { extractDataArtifact } from "../lib/scan/deep/data/extractor.mjs";

const MULTI_STATEMENT_SQL = [
  "-- header comment (line 1)",
  "CREATE TABLE users (",
  "  id INTEGER PRIMARY KEY,",
  "  email TEXT NOT NULL",
  ");",
  "",
  "CREATE INDEX idx_users_email ON users (email);",
  "",
  "CREATE TABLE orders (",
  "  id INTEGER PRIMARY KEY,",
  "  user_id INTEGER REFERENCES users(id)",
  ");",
  "",
  "CREATE DATABASE appdb;",
  "",
].join("\n");

test("F-055: multi-statement SQL evidence cites correct full-source lines", () => {
  const result = extractDataArtifact({
    path: "migrations/001.sql",
    text: MULTI_STATEMENT_SQL,
    value: null,
    format: "text",
    ecosystem: null,
  });
  const bySignature = new Map(result.records.map((record) => [record.signature, record.line]));
  assert.equal(bySignature.get("users"), 2, "CREATE TABLE users starts on line 2, not line 1");
  assert.equal(bySignature.get("orders"), 9, "CREATE TABLE orders starts on line 9");
  assert.equal(bySignature.get("users:idx_users_email:index"), 7, "CREATE INDEX is on line 7");
  assert.equal(bySignature.get("appdb"), 14, "CREATE DATABASE is on line 14");
  // All SQL evidence lines must be within the fixture's line count.
  const maxLine = MULTI_STATEMENT_SQL.split("\n").length;
  for (const [, line] of bySignature) {
    assert.ok(
      Number.isSafeInteger(line) && line >= 1 && line <= maxLine,
      `line ${line} must be a plausible source line`,
    );
  }
});
