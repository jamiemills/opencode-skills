"use strict";

import assert from "node:assert/strict";
import test from "node:test";
import { STORE_SCHEMA_VERSION, createSqliteStore } from "../../lib/orchestration-store/index.mjs";

test("T015: STORE_SCHEMA_VERSION matches the migrated schema version", async () => {
  assert.equal(STORE_SCHEMA_VERSION, 2);
  const store = createSqliteStore({ driver: "memory-js" });
  try {
    assert.equal(await store.getSchemaVersion(), STORE_SCHEMA_VERSION);
  } finally {
    store.close();
  }
});
