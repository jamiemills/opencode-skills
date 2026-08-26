import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  makeReceipt,
  validateReceipt,
  writeImmutableReceipt,
} from "../scripts/run-final-receipt.mjs";

const checks = {
  node: { status: "verified", detail: "Node 22" },
  docker: { status: "unavailable", detail: "offline" },
};
const identity = { status: "verified", files: 1, digest: `sha256:${"a".repeat(64)}` };
function receipt() {
  return makeReceipt({
    preflight: { checks },
    testedSourceSha: "a".repeat(40),
    commands: [
      {
        id: "check",
        identity: "make check",
        status: "verified",
        exitStatus: 0,
        count: 1,
        durationMs: 1,
      },
    ],
    packageIdentity: identity,
    payloadIdentity: identity,
  });
}

test("receipt has separate source and receipt commit bindings", () => {
  const r = receipt();
  assert.equal(r.binding.testedSourceSha.length, 40);
  assert.equal(r.binding.receiptCommitSha, null);
  assert.equal(r.immutable, true);
});
test("fabricated counts are rejected by the schema contract", () => {
  const r = receipt();
  r.commands = [
    { id: "x", identity: "x", status: "verified", exitStatus: 0, count: -1, durationMs: 1 },
  ];
  assert.throws(() => validateReceipt(r), /schema validation failed/);
});
test("malformed receipt is rejected before writing", () => {
  const r = receipt();
  delete r.binding.testedSourceSha;
  assert.throws(() => validateReceipt(r), /schema validation failed/);
});
test("unavailable browser evidence cannot be promoted to verified", () => {
  const r = receipt();
  r.live.browser = { status: "verified", detail: "fabricated" };
  assert.throws(() => validateReceipt(r), /cannot be verified/);
});
test("writer protects evidence directory and refuses replacement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-"));
  const destination = path.join(process.cwd(), ".agents/docs", `test-${path.basename(dir)}.json`);
  try {
    writeImmutableReceipt(receipt(), destination);
    assert.throws(() => writeImmutableReceipt(receipt(), destination), /EEXIST/);
    assert.throws(
      () => writeImmutableReceipt(receipt(), path.join(dir, "escape.json")),
      /outside protected/,
    );
  } finally {
    fs.rmSync(destination, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
