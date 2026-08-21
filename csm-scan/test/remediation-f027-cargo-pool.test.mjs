// F-027 — Cargo [workspace.dependencies] pool entries carry distinct
// declared-pool provenance.
//
// Before this fix every [workspace.dependencies] entry of a virtual workspace
// root was attributed to the root's own dependency inventory regardless of
// member references, so downstream detection tables reported unused pool
// packages as "used". After the fix the pool is merged for backward
// compatibility but each entry is marked with declared-pool provenance: the
// declared pool map, the sorted declared-pool names, and the subset actually
// referenced by member crates via `workspace = true`.
//
// Seeded fixtures only.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readManifest } from "../lib/scan/shared/manifest.mjs";

function workspaceFixture() {
  const dir = mkdtempSync(join(tmpdir(), "cargo-pool-"));
  mkdirSync(join(dir, "crate-a"));
  writeFileSync(
    join(dir, "Cargo.toml"),
    [
      "[workspace]",
      'members = ["crate-a"]',
      "",
      "[workspace.dependencies]",
      'anyhow = "1.0"',
      'serde = "1.0"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "crate-a", "Cargo.toml"),
    [
      "[package]",
      'name = "crate-a"',
      'version = "0.1.0"',
      "",
      "[dependencies]",
      "serde = { workspace = true }",
      'tokio = "1.0"',
      "",
    ].join("\n"),
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("F-027: workspace pool entries are marked with declared-pool provenance", () => {
  const { dir, cleanup } = workspaceFixture();
  try {
    const m = readManifest(dir);
    assert.ok(m.workspace, "workspace metadata present");
    assert.deepEqual(m.workspace.declaredPool, ["anyhow", "serde"]);
    assert.deepEqual(Object.keys(m.workspace.dependencies).toSorted(), ["anyhow", "serde"]);
    // Only serde is referenced by a member via workspace = true.
    assert.deepEqual(m.workspace.referencedPool, ["serde"]);
    // Member deps still union into the root inventory (existing behavior).
    assert.ok("tokio" in m.dependencies, "member tokio unioned");
    assert.ok("serde" in m.dependencies, "referenced pool entry merged");
  } finally {
    cleanup();
  }
});
