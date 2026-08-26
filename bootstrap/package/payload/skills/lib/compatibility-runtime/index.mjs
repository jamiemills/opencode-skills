"use strict";

import { canonicalize, digest } from "../schema-runtime/index.mjs";

const REVISION = /^[1-9][0-9]*$/;
const SCHEMA = /^[a-z][a-z0-9-]*(?:-[a-z0-9]+)*$/;

function fail(message) {
  throw new TypeError(message);
}

function freezeSnapshot(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeSnapshot(child, seen);
  return Object.freeze(value);
}

function pairKey(schema, producerRevision, consumerRevision) {
  return `${schema}:${producerRevision}->${consumerRevision}`;
}

function assertRevision(value, field) {
  if (!Number.isInteger(value) || !REVISION.test(String(value)))
    fail(`${field} must be a positive integer`);
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter))
    fail("adapter must be an object");
  if (typeof adapter.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(adapter.id))
    fail("adapter id must be a lowercase identifier");
  if (typeof adapter.version !== "string" || adapter.version.length === 0)
    fail(`adapter ${adapter.id} must declare a version`);
  if (typeof adapter.schema !== "string" || !SCHEMA.test(adapter.schema))
    fail(`adapter ${adapter.id} must declare a schema`);
  assertRevision(adapter.sourceRevision, `adapter ${adapter.id} sourceRevision`);
  assertRevision(adapter.targetRevision, `adapter ${adapter.id} targetRevision`);
  if (adapter.sourceRevision === adapter.targetRevision)
    fail(`adapter ${adapter.id} cannot adapt a revision to itself`);
  if (typeof adapter.transform !== "function")
    fail(`adapter ${adapter.id} must provide a transform function`);
  return Object.freeze({
    id: adapter.id,
    version: adapter.version,
    schema: adapter.schema,
    sourceRevision: adapter.sourceRevision,
    targetRevision: adapter.targetRevision,
    transform: adapter.transform,
  });
}

export function validateCompatibilityMatrix(matrix) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix))
    fail("compatibility matrix must be an object");
  if (matrix.format !== "csm-compatibility-matrix/1")
    fail("unsupported compatibility matrix format");
  if (
    matrix.policy !==
    "unknown revisions fail closed; incompatible revisions require an explicit adapter"
  )
    fail("compatibility matrix has an unsupported policy");
  if (
    !matrix.schemaDiffPolicy ||
    matrix.schemaDiffPolicy.same !== "matrix-entry-required" ||
    matrix.schemaDiffPolicy.additive !== "matrix-entry-required" ||
    matrix.schemaDiffPolicy.breaking !== "explicit-adapter-required"
  )
    fail("compatibility matrix has an unsupported schema diff policy");
  if (!Array.isArray(matrix.entries)) fail("compatibility matrix entries must be an array");
  if (!Array.isArray(matrix.adapters)) fail("compatibility matrix adapters must be an array");

  const pairs = new Set();
  for (const entry of matrix.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("invalid matrix entry");
    if (typeof entry.schema !== "string" || !SCHEMA.test(entry.schema))
      fail("matrix entry schema must be a canonical name");
    assertRevision(entry.producerRevision, "matrix producerRevision");
    assertRevision(entry.consumerRevision, "matrix consumerRevision");
    if (entry.status !== "compatible" && entry.status !== "incompatible")
      fail("matrix entry status must be compatible or incompatible");
    if (entry.status === "compatible" && entry.adapter !== null)
      fail("compatible matrix entries cannot name an adapter");
    if (entry.status === "incompatible" && (typeof entry.adapter !== "string" || !entry.adapter))
      fail("incompatible matrix entries require an adapter ID");
    if (entry.status === "incompatible" && !matrix.adapters.includes(entry.adapter))
      fail(`matrix entry references an unregistered adapter: ${entry.adapter}`);
    const key = pairKey(entry.schema, entry.producerRevision, entry.consumerRevision);
    if (pairs.has(key)) fail(`duplicate compatibility pair: ${key}`);
    pairs.add(key);
  }
  const adapters = new Set();
  for (const adapter of matrix.adapters) {
    if (typeof adapter !== "string" || !/^[a-z][a-z0-9-]*$/.test(adapter))
      fail("matrix adapter IDs must be lowercase identifiers");
    if (adapters.has(adapter)) fail(`duplicate matrix adapter: ${adapter}`);
    adapters.add(adapter);
  }
  return freezeSnapshot({
    ...matrix,
    schemaDiffPolicy: { ...matrix.schemaDiffPolicy },
    entries: matrix.entries.map((entry) => ({ ...entry })),
    adapters: [...matrix.adapters],
  });
}

function registryEntry(registry, schema, revision) {
  try {
    return registry.resolve(schema, revision);
  } catch (error) {
    throw new RangeError(`unknown schema revision: ${schema}/${revision}`, { cause: error });
  }
}

function validateRegistered(registry, id, value) {
  const result = registry.validate(id, value);
  if (!result.valid) {
    const error = new Error(`schema validation failed for ${id}`);
    error.errors = result.errors;
    throw error;
  }
}

function changed(a, b) {
  if (a === undefined || b === undefined) return !Object.is(a, b);
  return canonicalize(a) !== canonicalize(b);
}

function sanitizeThrownMessage(error) {
  let isError = false;
  try {
    isError = error instanceof Error;
  } catch {
    return "replay failed with an unreadable thrown value";
  }
  if (isError) {
    try {
      return typeof error.message === "string" ? error.message : String(error.message);
    } catch {
      return "replay failed with an unreadable error";
    }
  }
  if (error === null) return "replay failed with thrown null";
  if (typeof error === "string") return error;
  return `replay failed with thrown ${typeof error}`;
}

const SCHEMA_METADATA = new Set(["$comment", "description", "examples", "title"]);

function withoutMetadata(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([keyword]) => !SCHEMA_METADATA.has(keyword))
      .map(([keyword, value]) => [keyword, withoutMetadata(value)]),
  );
}

export function classifySchemaDiff(source, target) {
  if (!source || !target || typeof source !== "object" || typeof target !== "object")
    return "breaking";
  const sourceSchema = withoutMetadata(source);
  const targetSchema = withoutMetadata(target);
  if (!changed(sourceSchema, targetSchema)) return "same";
  if (sourceSchema.type !== "object" || targetSchema.type !== "object") return "breaking";
  if (changed(sourceSchema.required ?? [], targetSchema.required ?? [])) return "breaking";
  if (
    Object.keys(sourceSchema).some(
      (keyword) => !["type", "properties", "required"].includes(keyword),
    )
  )
    return "breaking";
  if (
    Object.keys(targetSchema).some(
      (keyword) => !["type", "properties", "required"].includes(keyword),
    )
  )
    return "breaking";
  const sourceProperties = sourceSchema.properties ?? {};
  const targetProperties = targetSchema.properties ?? {};
  for (const [name, definition] of Object.entries(sourceProperties))
    if (!(name in targetProperties) || changed(definition, targetProperties[name]))
      return "breaking";
  if (Object.keys(targetProperties).some((name) => !(name in sourceProperties))) return "additive";
  return "same";
}

export function createCompatibilityRuntime({ schemaRegistry, matrix, adapters = [] } = {}) {
  if (
    !schemaRegistry ||
    typeof schemaRegistry.resolve !== "function" ||
    typeof schemaRegistry.validate !== "function"
  )
    fail("schemaRegistry must provide resolve and validate");
  const checkedMatrix = validateCompatibilityMatrix(matrix);
  const adapterById = new Map();
  for (const adapter of adapters) {
    const checked = validateAdapter(adapter);
    if (adapterById.has(checked.id)) fail(`duplicate adapter: ${checked.id}`);
    adapterById.set(checked.id, checked);
  }
  for (const entry of checkedMatrix.entries) {
    if (entry.status === "incompatible") {
      const adapter = adapterById.get(entry.adapter);
      if (!adapter) fail(`matrix adapter is not registered: ${entry.adapter}`);
      if (
        adapter.schema !== entry.schema ||
        adapter.sourceRevision !== entry.producerRevision ||
        adapter.targetRevision !== entry.consumerRevision
      )
        fail(`adapter ${adapter.id} does not match its matrix pair`);
    }
  }
  const entryByPair = new Map(
    checkedMatrix.entries.map((entry) => [
      pairKey(entry.schema, entry.producerRevision, entry.consumerRevision),
      entry,
    ]),
  );

  function negotiate(schema, producerRevision, consumerRevision) {
    registryEntry(schemaRegistry, schema, producerRevision);
    registryEntry(schemaRegistry, schema, consumerRevision);
    const entry = entryByPair.get(pairKey(schema, producerRevision, consumerRevision));
    if (!entry)
      throw new Error(
        `unregistered compatibility pair: ${pairKey(schema, producerRevision, consumerRevision)}`,
      );
    if (entry.status === "compatible")
      return freezeSnapshot({ ...entry, mode: "direct", adapter: null });
    const adapter = adapterById.get(entry.adapter);
    if (!adapter) throw new Error(`adapter is unavailable: ${entry.adapter}`);
    return freezeSnapshot({ ...entry, mode: "adapter", adapter });
  }

  function replayOne(record) {
    let schema;
    let producerRevision;
    let consumerRevision;
    let value;
    let sourceDigest;
    try {
      if (!record || typeof record !== "object" || Array.isArray(record))
        throw new TypeError("malformed replay record");
      ({ schema, producerRevision, consumerRevision, value, sourceDigest } = record);
      if (
        typeof schema !== "string" ||
        !SCHEMA.test(schema) ||
        !Number.isInteger(producerRevision) ||
        !REVISION.test(String(producerRevision)) ||
        !Number.isInteger(consumerRevision) ||
        !REVISION.test(String(consumerRevision)) ||
        value === undefined
      )
        throw new TypeError("malformed replay record");
      const sourceId = `${schema}/${producerRevision}`;
      const targetId = `${schema}/${consumerRevision}`;
      registryEntry(schemaRegistry, schema, producerRevision);
      registryEntry(schemaRegistry, schema, consumerRevision);
      const actualSourceDigest = digest(value);
      if (sourceDigest !== undefined && sourceDigest !== actualSourceDigest)
        throw new Error("source digest does not match replay input");
      validateRegistered(schemaRegistry, sourceId, value);
      const plan = negotiate(schema, producerRevision, consumerRevision);
      const output =
        plan.mode === "direct" ? value : plan.adapter.transform(structuredClone(value));
      validateRegistered(schemaRegistry, targetId, output);
      return {
        status: "accepted",
        value: output,
        provenance: freezeSnapshot({
          sourceDigest: actualSourceDigest,
          sourceSchema: schema,
          sourceSchemaId: sourceId,
          sourceRevision: producerRevision,
          targetSchema: schema,
          targetSchemaId: targetId,
          targetRevision: consumerRevision,
          adapterId: plan.adapter?.id ?? null,
          adapterVersion: plan.adapter?.version ?? null,
          adapter: plan.adapter ? { id: plan.adapter.id, version: plan.adapter.version } : null,
        }),
      };
    } catch (error) {
      return {
        status: "quarantined",
        value: null,
        quarantine: {
          code: error instanceof RangeError ? "unknown-revision" : "replay-failed",
          message: sanitizeThrownMessage(error),
        },
        provenance: {
          sourceSchema: schema,
          sourceRevision: producerRevision,
          targetSchema: schema,
          targetRevision: consumerRevision,
        },
      };
    }
  }

  function replay(records) {
    if (!Array.isArray(records)) {
      return {
        status: "quarantined",
        cutover: false,
        outputs: [],
        quarantine: [replayOne(records)],
      };
    }
    const outputs = records.map(replayOne);
    const quarantine = outputs.filter((output) => output.status === "quarantined");
    return {
      status: quarantine.length === 0 ? "accepted" : "quarantined",
      cutover: quarantine.length === 0,
      outputs: quarantine.length === 0 ? outputs : [],
      quarantine,
    };
  }

  return {
    matrix: checkedMatrix,
    adapters: Object.freeze([...adapterById.values()]),
    negotiate,
    replay: replayOne,
    replayBatch: replay,
    classifySchemaDiff,
  };
}
