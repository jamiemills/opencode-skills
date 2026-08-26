"use strict";

import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { parseJson } from "../../../../lib/schema-runtime/index.mjs";
import { readDurableJson } from "../../../../lib/durable-json/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "schemas");

const typeOf = (instance, type) => {
  if (type === "object")
    return instance !== null && typeof instance === "object" && !Array.isArray(instance);
  if (type === "array") return Array.isArray(instance);
  if (type === "integer") return Number.isInteger(instance);
  if (type === "number") return typeof instance === "number";
  if (type === "boolean") return typeof instance === "boolean";
  if (type === "null") return instance === null;
  return typeof instance === type;
};

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validate(instance, schema, path, errors) {
  if (schema === true) return;
  if (schema === false || schema === null || typeof schema !== "object") {
    errors.push(`${path}: invalid schema clause`);
    return;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeOf(instance, type)))
      errors.push(`${path}: expected type ${JSON.stringify(schema.type)}`);
  }
  if (schema.const !== undefined && !sameJson(instance, schema.const))
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => sameJson(option, instance)))
    errors.push(`${path}: value not in enum`);
  if (typeof instance === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(instance))
      errors.push(`${path}: pattern ${schema.pattern} mismatch`);
    if (typeof schema.minLength === "number" && instance.length < schema.minLength)
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && instance.length > schema.maxLength)
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
  }
  if (Array.isArray(instance)) {
    if (typeof schema.minItems === "number" && instance.length < schema.minItems)
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && instance.length > schema.maxItems)
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    if (schema.items !== undefined)
      instance.forEach((item, position) =>
        validate(item, schema.items, `${path}[${position}]`, errors),
      );
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(instance, key)) errors.push(`${path}: missing required property "${key}"`);
    if (schema.properties !== undefined) {
      for (const [key, sub] of Object.entries(schema.properties))
        if (Object.hasOwn(instance, key)) validate(instance[key], sub, `${path}.${key}`, errors);
      if (schema.additionalProperties === false)
        for (const key of Object.keys(instance))
          if (!Object.hasOwn(schema.properties, key))
            errors.push(`${path}: unexpected property "${key}"`);
    }
  }
  if (schema.not !== undefined) {
    const negated = [];
    validate(instance, schema.not, path, negated);
    if (negated.length === 0) errors.push(`${path}: must not match "not" clause`);
  }
  for (const sub of schema.allOf ?? []) validate(instance, sub, path, errors);
  if (schema.if !== undefined) {
    const conditionErrors = [];
    validate(instance, schema.if, path, conditionErrors);
    const branch = conditionErrors.length === 0 ? schema.then : schema.else;
    if (branch !== undefined) validate(instance, branch, path, errors);
  }
}

export function validateSchema(instance, schema) {
  const errors = [];
  validate(instance, schema, "$", errors);
  return { ok: errors.length === 0, errors };
}

async function loadSchema(name) {
  return parseJson(await readFile(join(schemasDir, name), "utf8"));
}

export async function validateGraphFile(file) {
  const schema = await loadSchema("ddd-graph.schema.json");
  const instance = await readDurableJson(file);
  const result = validateSchema(instance, schema);
  if (!result.ok) {
    for (const line of result.errors) process.stderr.write(`${line}\n`);
  }
  return result;
}

export async function validateReportEnvelope(envelope) {
  const schema = await loadSchema("ddd-report.schema.json");
  return validateSchema(envelope, schema);
}

export async function validateReportFile(file) {
  const schema = await loadSchema("ddd-report.schema.json");
  const instance = await readDurableJson(file);
  const result = validateSchema(instance, schema);
  if (!result.ok) {
    for (const line of result.errors) process.stderr.write(`${line}\n`);
  }
  return result;
}

export async function validateGraph(obj) {
  return validateSchema(obj, await loadSchema("ddd-graph.schema.json"));
}

export async function validateReport(obj) {
  return validateSchema(obj, await loadSchema("ddd-report.schema.json"));
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const [kind, file] = process.argv.slice(2);
  if ((kind !== "graph" && kind !== "report") || !file) {
    process.stderr.write("usage: node csm-ddd/lib/ddd/validate.mjs graph|report FILE\n");
    process.exit(2);
  }
  const result = kind === "graph" ? await validateGraphFile(file) : await validateReportFile(file);
  process.exit(result.ok ? 0 : 1);
}
