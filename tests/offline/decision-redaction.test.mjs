"use strict";

// G5 repair (review F1): adversarial redaction coverage. Credential material
// must never survive redaction, and the fail-closed survivor net must find
// nothing in the redacted output.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findCredentialShapes,
  redactDecisionArtifact,
} from "../../csm-orchestrate/lib/decision-adapter/artifact.mjs";

const SAMPLE = {
  authorization: "Bearer abcdefghijklmnop.qrstuvwx",
  note: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AIzaSyA1234567890abcdefghijklmnopqrs",
  password: "hunter2-not-a-real-password",
  credential: "cred-1234567890",
  cookie: "session=deadbeefcafebabe",
  nested: [{ apiKey: "sk-live-abcdefghijklmnop" }],
  safe: "sha256:" + "a".repeat(64),
};

test("redaction removes PATs, Google keys, bearer tokens, and credential-named values", () => {
  const out = redactDecisionArtifact(SAMPLE);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes("ghp_"));
  assert.ok(!serialized.includes("AIza"));
  assert.ok(!serialized.includes("Bearer abc"));
  assert.ok(!serialized.includes("hunter2"));
  assert.ok(!serialized.includes("cred-1234567890"));
  assert.ok(!serialized.includes("sk-live-abcdefghijklmnop"));
  assert.ok(!serialized.includes("session=deadbeefcafebabe"));
  assert.ok(serialized.includes("sha256:"));
});

test("the fail-closed survivor net finds nothing after redaction", () => {
  const out = redactDecisionArtifact(SAMPLE);
  assert.deepEqual(findCredentialShapes(out), []);
});

test("the survivor net flags a raw unredacted secret as a backstop", () => {
  assert.ok(findCredentialShapes(SAMPLE).length > 0);
});
