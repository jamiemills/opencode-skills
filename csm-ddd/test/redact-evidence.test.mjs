"use strict";

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidence } from "../lib/ddd/contracts.mjs";
import { redactEvidenceRecords } from "../lib/ddd/redact.mjs";

const GHP_TOKEN = "ghp_a1B2c3D4e5F6g7H8i9J0";
const SK_TOKEN = "sk-fakefakefakefake1234";

test("evidence-record funnel sanitizes hostile locators and matched keys", () => {
  const records = [
    buildEvidence({
      claimId: "cl-test-0001",
      sourceKind: "walk",
      path: "src/a.mjs",
      locator: "import:/home/dev/secret/module.mjs",
      matchedKey: `/Users/dev/token ${SK_TOKEN}`,
    }),
    buildEvidence({
      claimId: "cl-test-0002",
      sourceKind: "git-log",
      path: "src/b.mjs",
      locator: "/home/dev/repo/.git/refs",
      matchedKey: `commits:${GHP_TOKEN}`,
    }),
  ];
  const redacted = redactEvidenceRecords(records);
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /\/home\/dev/);
  assert.doesNotMatch(serialized, /\/Users\/dev/);
  assert.doesNotMatch(serialized, new RegExp(SK_TOKEN));
  assert.doesNotMatch(serialized, new RegExp(GHP_TOKEN));
  assert.equal(redacted[0].locator, "import:<redacted-path>");
  assert.equal(redacted[0].matchedKey, "<redacted-path> <redacted-secret>");
  assert.equal(redacted[1].locator, "<redacted-path>");
  assert.equal(redacted[1].matchedKey, "commits:<redacted-secret>");
  assert.equal(redacted[0].id, records[0].id);
  assert.equal(redacted[0].claimId, records[0].claimId);
  assert.equal(redacted[0].sourceKind, records[0].sourceKind);
  assert.equal(redacted[0].path, records[0].path);
});

test("evidence serializer sanitizes every persisted record field", () => {
  const record = buildEvidence({
    claimId: "cl-canary-0003",
    sourceKind: "walk",
    path: `docs/${GHP_TOKEN}-runbook.md`,
    locator: "/tmp/hostile/locator",
    matchedKey: "/var/hostile/key",
  });
  const [out] = redactEvidenceRecords([record]);
  assert.equal(out.locator, "<redacted-path>");
  assert.equal(out.matchedKey, "<redacted-path>");
  assert.doesNotMatch(out.path, new RegExp(GHP_TOKEN));
});
