import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const schemaPath = join(root, "bootstrap/agent-report.schema.json");

export async function loadReportSchema() {
  return JSON.parse(await readFile(schemaPath, "utf8"));
}

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
  if (typeof instance === "number") {
    if (typeof schema.minimum === "number" && instance < schema.minimum)
      errors.push(`${path}: below minimum ${schema.minimum}`);
    if (typeof schema.maximum === "number" && instance > schema.maximum)
      errors.push(`${path}: above maximum ${schema.maximum}`);
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
  if (schema?.$id?.includes("csm-agent-report-1.json")) validateReportContract(instance, errors);
  return errors;
}

function validateReportContract(report, errors) {
  if (!report || typeof report !== "object" || !Array.isArray(report.states)) return;
  const chain = [
    "DISCOVER",
    "TRUST",
    "PLAN_DESTINATION",
    "CONFIRM_IF_NEEDED",
    "MATERIALIZE",
    "VERIFY",
    "REPORT",
  ];
  const states = report.states;
  const expected = chain.slice(0, states.length);
  if (states.some((entry, index) => entry?.state !== expected[index]))
    errors.push("$.states: entries must be an exact prefix of the protocol state chain");
  const refusalIndex = states.findIndex((entry) => entry?.refusal !== null);
  if (refusalIndex !== -1) {
    if (refusalIndex !== states.length - 1)
      errors.push("$.states: refusal must be the final trace entry");
    if (report.result !== "refused") errors.push("$.result: refusal trace requires refused result");
    if (report.refusal?.state !== states[refusalIndex]?.state)
      errors.push("$.refusal.state: must match the terminal refusal trace state");
  } else if (report.result === "refused") {
    errors.push("$.states: refused result requires a terminal refusal trace entry");
  } else if (report.result === "placed" && states.length !== chain.length) {
    errors.push("$.states: placed result requires the complete protocol state chain");
  }
}
