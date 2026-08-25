import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { evaluateFixture, validateManifest, validateTrace } from "./runner.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name) => JSON.parse(readFileSync(join(DIR, name), "utf8"));

const expectedFixtures = [
  "invalid-legacy-manifest.json",
  "invalid-manifest-additional-property.json",
  "invalid-manifest-enum.json",
  "invalid-manifest-required.json",
  "invalid-trace-additional-property.json",
  "invalid-trace-correlation.json",
  "invalid-trace-duplicate-id.json",
  "invalid-trace-id.json",
  "invalid-trace-nested-record.json",
  "invalid-trace-prompt.json",
  "invalid-trace-sensitive.json",
  "invalid-trace-version.json",
  "invalid-manifest.json",
  "legacy-manifest.json",
  "valid-manifest.json",
  "valid-trace.json",
].toSorted();

test("fixture inventory is explicit so omitted eval cases fail the suite", () => {
  assert.deepEqual(
    readdirSync(DIR)
      .filter((name) => name.endsWith(".json"))
      .toSorted(),
    expectedFixtures,
  );
});

test("valid manifest and trace cover activation, trajectory, refusal, recovery, and artifacts", () => {
  const result = evaluateFixture(join(DIR, "valid-manifest.json"), join(DIR, "valid-trace.json"));
  assert.deepEqual(result, { valid: true, compatibility: "current", artifactCount: 1 });
});

test("legacy manifest is accepted only through explicit compatibility", () => {
  const legacy = load("legacy-manifest.json");
  assert.equal(validateManifest(legacy).valid, false);
  assert.equal(validateManifest(legacy, { allowLegacy: true }).compatibility, "legacy-explicit");
});

test("unknown manifest versions are rejected, not coerced", () => {
  assert.match(validateManifest(load("invalid-manifest.json")).error, /unknown manifest version/);
});

test("raw prompts are rejected by default", () => {
  const trace = load("invalid-trace-prompt.json");
  assert.match(validateTrace(trace, load("valid-manifest.json")).error, /rawPrompt/);
});

test("secrets and complete tool results are rejected by default", () => {
  const trace = load("invalid-trace-sensitive.json");
  assert.match(validateTrace(trace, load("valid-manifest.json")).error, /secret/);
});

test("artifact records must correlate to a trace event", () => {
  const trace = load("invalid-trace-correlation.json");
  assert.match(validateTrace(trace, load("valid-manifest.json")).error, /correlation/);
});

test("the deterministic fixture has a stable result on repeated evaluation", () => {
  const args = [join(DIR, "valid-manifest.json"), join(DIR, "valid-trace.json")];
  assert.deepEqual(evaluateFixture(...args), evaluateFixture(...args));
});

const invalidFixtures = [
  ["invalid-manifest-required.json", /required/],
  ["invalid-manifest-additional-property.json", /not permitted/],
  ["invalid-manifest-enum.json", /must equal/],
  ["invalid-trace-id.json", /invalid format/],
  ["invalid-trace-version.json", /unknown trace version/],
  ["invalid-trace-nested-record.json", /must be one of/],
  ["invalid-trace-additional-property.json", /not permitted/],
  ["invalid-trace-duplicate-id.json", /unique/],
];

for (const [fixture, error] of invalidFixtures) {
  test(`${fixture} is rejected by the declared schema`, () => {
    const result = fixture.startsWith("invalid-manifest")
      ? validateManifest(load(fixture))
      : validateTrace(load(fixture), load("valid-manifest.json"));
    assert.equal(result.valid, false);
    assert.match(result.error, error);
  });
}

test("legacy compatibility rejects an unrecognized legacy property", () => {
  assert.equal(
    validateManifest(load("invalid-legacy-manifest.json"), { allowLegacy: true }).valid,
    false,
  );
});
