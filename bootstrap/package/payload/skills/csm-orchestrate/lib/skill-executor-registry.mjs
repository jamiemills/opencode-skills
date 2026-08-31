"use strict";

import { readFile } from "node:fs/promises";
import { digest, parseJson, createSchemaValidator } from "../../../lib/schema-runtime/index.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SCHEMA = "csm-orchestrate-skill-executor/1";

const descriptorDigest = (descriptor) =>
  digest({
    schema: descriptor.schema,
    version: descriptor.version,
    skill: descriptor.skill,
    inputSchemaDigest: descriptor.inputSchemaDigest,
    outputSchemaDigest: descriptor.outputSchemaDigest,
    receiptSchemaDigest: descriptor.receiptSchemaDigest,
    evidenceSchemaDigest: descriptor.evidenceSchemaDigest,
    effectiveConfigDigest: descriptor.effectiveConfigDigest,
    permissions: descriptor.permissions,
    effects: descriptor.effects,
    cancellation: descriptor.cancellation,
    idempotency: descriptor.idempotency,
  });

function key(value) {
  return [
    value.skill,
    value.contractDigest,
    value.handlerDigest,
    value.inputSchemaDigest,
    value.outputSchemaDigest,
    value.receiptSchemaDigest,
    value.evidenceSchemaDigest,
    value.effectiveConfigDigest,
  ].join("\u0000");
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor))
    throw new TypeError("skill executor descriptor is required");
  if (
    typeof descriptor.skill !== "string" ||
    !/^csm-[a-z0-9][a-z0-9-]{1,63}$/.test(descriptor.skill)
  )
    throw new TypeError("invalid skill executor skill");
  for (const field of [
    "contractDigest",
    "handlerDigest",
    "inputSchemaDigest",
    "outputSchemaDigest",
    "inputSchemaDigest",
    "outputSchemaDigest",
    "receiptSchemaDigest",
    "evidenceSchemaDigest",
    "effectiveConfigDigest",
  ])
    if (typeof descriptor[field] !== "string" || !DIGEST.test(descriptor[field]))
      throw new TypeError(`invalid skill executor ${field}`);
  if (descriptor.schema !== SCHEMA || descriptor.version !== 1)
    throw new TypeError("unsupported skill executor contract");
  if (typeof descriptor.handler !== "function")
    throw new TypeError("skill executor handler is required");
  if (descriptor.contractDigest !== descriptorDigest(descriptor))
    throw new TypeError("skill executor contract digest mismatch");
  return Object.freeze({ ...descriptor });
}

export async function createSkillExecutorRegistry({ descriptors = [] } = {}) {
  const schema = parseJson(
    await readFile(new URL("../schemas/skill-executor.v1.schema.json", import.meta.url), "utf8"),
  );
  const validator = createSchemaValidator({ schemas: [schema] });
  const entries = new Map();
  for (const descriptor of descriptors) {
    const structural = { ...descriptor };
    delete structural.handler;
    const result = validator.validate(SCHEMA, structural);
    if (!result.valid) throw new TypeError("invalid skill executor descriptor schema");
    const checked = validateDescriptor(descriptor);
    const entryKey = key(checked);
    if (entries.has(entryKey)) throw new TypeError(`duplicate skill executor: ${checked.skill}`);
    entries.set(entryKey, checked);
  }
  return Object.freeze({
    resolveExact(request) {
      const entry = entries.get(key(request));
      if (!entry)
        throw Object.assign(new Error("exact skill executor is not registered"), {
          code: "stale-handler",
        });
      return entry;
    },
    resolve(request) {
      return this.resolveExact(request);
    },
    size: entries.size,
  });
}

export { SCHEMA as SKILL_EXECUTOR_SCHEMA, descriptorDigest as skillExecutorContractDigest };
