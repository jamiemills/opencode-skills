"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CONTRACTS,
  FORMAT_VERSIONS,
  INTERFACES,
  MANIFEST,
  NEVER_INVOKE,
} from "../../scripts/lib/contracts.mjs";

const root = new URL("../", import.meta.url);
const fixtures = new URL("./fixtures/", import.meta.url);
const schemaNames = [
  "run-contract",
  "policy",
  "evaluator-request",
  "evaluator-response",
  "ledger-event",
  "report",
  "llm-adapter",
];

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function requiredAndFormat(schema, value) {
  for (const key of schema.required ?? [])
    assert.ok(Object.hasOwn(value, key), `${schema.title}: missing ${key}`);
  assert.equal(value.format, schema.properties.format.const);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value))
      assert.ok(Object.hasOwn(schema.properties, key), `${schema.title}: unknown ${key}`);
  }
}

test("all first-class schemas are strict and versioned", async () => {
  for (const name of schemaNames) {
    const schema = await json(new URL(`./schemas/${name}.schema.json`, root));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.additionalProperties, false);
    assert.match(schema.properties.format.const, /^csm-autoresearch-[a-z-]+\/1$/);
    assert.ok(schema.required.length > 0);
  }
});

test("registered contract fixture is accepted and generated mode requires sandbox evidence", async () => {
  const schema = await json(new URL("./schemas/run-contract.schema.json", root));
  const valid = await json(new URL("valid-contract.json", fixtures));
  requiredAndFormat(schema, valid);
  assert.equal(valid.source.mode, "registered");
  const generated = await json(new URL("invalid-generated-contract.json", fixtures));
  assert.throws(() => {
    requiredAndFormat(schema, generated);
    assert.ok(
      generated.source.sandboxProvider && generated.source.sandboxEvidence,
      "generated mode is blocked without verified sandbox",
    );
  }, /sandbox/);
});

test("bounded protocol preserves status taxonomy and fail-closed validity", async () => {
  const responseSchema = await json(new URL("./schemas/evaluator-response.schema.json", root));
  const valid = await json(new URL("valid-response.json", fixtures));
  requiredAndFormat(responseSchema, valid);
  assert.deepEqual(Object.keys(responseSchema.properties.status.enum), [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
  ]);
  const invalid = await json(new URL("invalid-response.json", fixtures));
  assert.equal(invalid.status, "timed_out");
  assert.equal(invalid.valid, true);
  assert.notEqual(invalid.status, "ok");
});

test("budgets, policies, artifacts, and adapters expose required safety controls", async () => {
  const contract = await json(new URL("./schemas/run-contract.schema.json", root));
  assert.equal(contract.$defs.budget.properties.maxProposals.maximum, 50);
  const policy = await json(new URL("./schemas/policy.schema.json", root));
  assert.deepEqual(policy.properties.mode.enum, ["target", "hill-climb"]);
  assert.equal(policy.properties.population.properties.enabled.type, "boolean");
  assert.deepEqual(policy.properties.execution.required, [
    "network",
    "credentials",
    "evaluatorAssets",
    "isolation",
  ]);
  const adapter = await json(new URL("./schemas/llm-adapter.schema.json", root));
  assert.equal(adapter.properties.response.properties.advisory.const, true);
  assert.equal(adapter.allOf[0].then.properties.defEval.const, "resolved");
  for (const name of ["csm-autoresearch-ledger", "csm-autoresearch-report"])
    assert.ok(FORMAT_VERSIONS[name]);
});

test("registry declares complete interface and never-invoke boundaries", () => {
  assert.ok(MANIFEST["csm-autoresearch"]);
  assert.deepEqual(MANIFEST["csm-autoresearch"].machine, {
    section: "Autoresearch State Machine",
    entryExit: false,
  });
  assert.ok(INTERFACES["csm-autoresearch"].entryConditions.length > 0);
  const skills = Object.keys(NEVER_INVOKE);
  assert.ok(skills.includes("csm-autoresearch"));
  for (const skill of skills) {
    assert.ok(
      Object.hasOwn(NEVER_INVOKE[skill], "csm-autoresearch"),
      `${skill} missing autoresearch column`,
    );
    assert.equal(NEVER_INVOKE[skill]["csm-autoresearch"], skill !== "csm-autoresearch");
  }
  assert.equal(CONTRACTS.length >= 4, true);
});
