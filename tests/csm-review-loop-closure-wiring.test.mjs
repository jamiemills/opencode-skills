import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "csm-review/lib/loop-closure.mjs");
const base = JSON.parse(
  readFileSync(join(ROOT, "tests/fixtures/review-json/review-valid.json"), "utf8"),
);

const run = (mutate) => {
  const dir = mkdtempSync(join(tmpdir(), "csm-review-closure-"));
  const record = structuredClone(base);
  mutate(record);
  const path = join(dir, "report.json");
  writeFileSync(path, JSON.stringify(record));
  return spawnSync(process.execPath, [CLI, "--record", path], { encoding: "utf8" });
};

test("a clean VERIFIED record passes the loop-closure guard", () => {
  const result = run(() => {});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a VERIFIED record with unresolved checks fails the loop-closure guard", () => {
  const result = run((record) => {
    record.verificationStatus.unresolved = ["F-001"];
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
});
