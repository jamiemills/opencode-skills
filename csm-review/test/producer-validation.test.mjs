import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertFindingsPayload, validateFindingsPayload } from "../lib/findings-validator.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  await readFile(join(root, "../tests/fixtures/review-json/review-valid.json"), "utf8"),
);

test("producer validation accepts the review fixture", () => {
  assert.equal(validateFindingsPayload(fixture).valid, true);
});

test("producer validation rejects semantic publication mismatches", () => {
  const cases = [
    (payload) => {
      payload.findings[0].sortKey = "2:2:2:F-001";
    },
    (payload) => {
      payload.findings.push({ ...payload.findings[0] });
    },
    (payload) => {
      payload.findings[0].confidence = "verified";
    },
    (payload) => {
      payload.findings[0].challenges = [];
    },
  ];
  for (const mutate of cases) {
    const candidate = structuredClone(fixture);
    mutate(candidate);
    assert.equal(validateFindingsPayload(candidate).valid, false);
    assert.throws(() => assertFindingsPayload(candidate), TypeError);
  }
});
