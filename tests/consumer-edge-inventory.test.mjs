import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSchemaValidator, parseJson } from "../lib/schema-runtime/index.mjs";

const inventoryPath = new URL("fixtures/json-migration/edge-inventory.json", import.meta.url);
const schema = parseJson(
  await readFile(new URL("../schemas/csm-edge-inventory.schema.json", import.meta.url), "utf8"),
);
const inventory = parseJson(await readFile(inventoryPath, "utf8"));
const validator = createSchemaValidator({ schemas: [schema] });

const expectedEdges = [
  "csm-scan->csm-plan",
  "csm-scan->csm-bdd-tdd",
  "csm-scan->csm-build",
  "csm-scan->csm-review",
  "csm-plan->csm-bdd-tdd",
  "csm-plan->csm-build",
  "csm-ddd->csm-plan",
  "csm-ddd->csm-build",
  "csm-deep-research->csm-grill",
  "csm-deep-research->csm-plan",
  "csm-deep-research->csm-make-tests",
  "csm-review->csm-plan",
  "csm-review->csm-grill",
  "csm-grill->csm-plan",
  "csm-bdd-tdd->csm-build",
  "csm-make-tests->csm-build",
  "csm-browse->csm-upload",
];

const requiredGenericEdges = new Set([
  "csm-scan->csm-review",
  "csm-ddd->csm-plan",
  "csm-deep-research->csm-grill",
  "csm-deep-research->csm-make-tests",
  "csm-review->csm-grill",
]);

test("versioned inventory descriptor validates against its schema", () => {
  assert.equal(validator.validate("csm-edge-inventory/1", inventory).valid, true);
  assert.equal(inventory.schema, "csm-edge-inventory/1");
  assert.equal(inventory.revision, 1);
});

test("inventory contains exactly the 17 producer-consumer edges", () => {
  assert.deepEqual(
    inventory.edges.map(({ id }) => id),
    expectedEdges,
  );
  assert.equal(new Set(inventory.edges.map(({ id }) => id)).size, 17);
  for (const edge of inventory.edges) {
    assert.equal(edge.owner.producer, edge.producer, `${edge.id}: producer ownership drift`);
    assert.equal(edge.owner.consumer, edge.consumer, `${edge.id}: consumer ownership drift`);
    assert.equal(edge.caller.producerEntryPoint.startsWith(`${edge.producer}/`), true, edge.id);
    assert.equal(edge.caller.consumerEntryPoint.startsWith(`${edge.consumer}/`), true, edge.id);
    assert.ok(edge.schema.producer && edge.schema.consumer, `${edge.id}: schema missing`);
    assert.ok(
      edge.runIdentity.producerField && edge.runIdentity.consumerField,
      `${edge.id}: run identity missing`,
    );
    assert.ok(edge.digestFields.required.length > 0, `${edge.id}: digest contract missing`);
    assert.ok(
      edge.path.producer && edge.path.consumer && edge.path.artifact,
      `${edge.id}: path missing`,
    );
    assert.ok(
      edge.terminalBehavior && edge.recoveryBehavior,
      `${edge.id}: lifecycle behavior missing`,
    );
    assert.equal(typeof edge.rollback, "boolean", `${edge.id}: rollback flag missing`);
  }
});

test("the five previously missing edges are required persisted generic handoffs", () => {
  const classified = new Set(
    inventory.edges
      .filter((edge) => edge.classification === "required-persisted-generic")
      .map(({ id }) => id),
  );
  assert.deepEqual(classified, requiredGenericEdges);
  for (const edge of inventory.edges) {
    assert.equal(
      edge.classification,
      requiredGenericEdges.has(edge.id) ? "required-persisted-generic" : "existing-persisted",
    );
  }
});

test("descriptor parsing is duplicate-key safe and inventory is not a projection", () => {
  assert.throws(
    () => parseJson('{"schema":"csm-edge-inventory/1","schema":"csm-edge-inventory/1"}'),
    /duplicate JSON object key/,
  );
  assert.notEqual(inventory.schema, "csm-projection/1");
});
