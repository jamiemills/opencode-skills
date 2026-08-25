import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const schema = JSON.parse(
  fs.readFileSync(path.join(root, "schemas/verification-status.schema.json"), "utf8"),
);

function load(name) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/evidence-status", name), "utf8"),
  );
}

function assertStatusRecord(record) {
  assert.equal(record.format, schema.$id);
  assert.ok(["VERIFIED", "INCOMPLETE", "BLOCKED"].includes(record.status));
  assert.ok(Array.isArray(record.unresolved));
  assert.ok(Array.isArray(record.evidence));
  assert.ok(Array.isArray(record.anchors));
  for (const evidence of record.evidence) {
    assert.ok(["retained", "embedded", "unavailable"].includes(evidence.retention));
    if (evidence.retention === "retained") {
      assert.ok(evidence.path && /^[a-f0-9]{64}$/.test(evidence.sha256));
      assert.ok(
        fs.existsSync(path.join(root, evidence.path)),
        `retained evidence missing: ${evidence.path}`,
      );
    }
    if (evidence.retention === "embedded") assert.ok(evidence.summary && evidence.sha256);
    if (evidence.retention === "unavailable") assert.ok(evidence.reason);
  }
  for (const anchor of record.anchors) {
    assert.match(anchor.url, /^https:\/\//);
    assert.ok(anchor.version || anchor.edition);
    assert.ok(anchor.retrievedAt);
    assert.ok(["reachable", "unreachable", "not-checked"].includes(anchor.reachability));
  }
  if (record.status === "VERIFIED") {
    assert.equal(record.unresolved.length, 0);
    assert.ok(record.evidence.every(({ retention }) => retention !== "unavailable"));
    assert.ok(record.anchors.every(({ reachability }) => reachability === "reachable"));
  }
}

test("retained evidence and typed reachable anchors are durable", () => {
  assertStatusRecord(load("verified-retained.json"));
});

test("unavailable evidence is explicit and incomplete", () => {
  const record = load("incomplete-unavailable.json");
  assertStatusRecord(record);
  assert.notEqual(record.status, "VERIFIED");
  assert.equal(record.evidence[0].retention, "unavailable");
});

test("unresolved verification cannot be labeled verified", () => {
  const record = load("blocked-unresolved.json");
  assertStatusRecord(record);
  assert.notEqual(record.status, "VERIFIED");
  assert.throws(() => assertStatusRecord({ ...record, status: "VERIFIED" }));
});

test("unreachable anchors remain non-success evidence", () => {
  const record = load("blocked-unresolved.json");
  record.status = "VERIFIED";
  record.unresolved = [];
  assert.equal(record.anchors[0].reachability, "unreachable");
  assert.throws(() => assertStatusRecord(record));
});

test("deleted evidence cannot be referenced as available", () => {
  const record = load("incomplete-unavailable.json");
  record.status = "VERIFIED";
  record.unresolved = [];
  record.evidence[0] = {
    id: "perf-profile",
    kind: "performance-profile",
    retention: "retained",
    path: "tests/fixtures/evidence-status/deleted-profile.json",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.throws(() => assertStatusRecord(record), /retained evidence missing/);
});
