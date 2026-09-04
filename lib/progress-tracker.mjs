import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const BAR_WIDTH = 30;
const STATUS_SYMBOL = { complete: "✓", active: "▶", pending: "○" };

let cachedSchema = null;

function loadSchema() {
  if (cachedSchema) return cachedSchema;
  const registry = require("../schemas/registry.json");
  const entry = registry.entries.find((e) => e.id === "csm-skill-progress/1");
  if (!entry) throw new Error("csm-skill-progress/1 is not registered");
  cachedSchema = JSON.parse(
    require("node:fs").readFileSync(
      new URL(`../${entry.schemaPath}`, import.meta.url),
      "utf-8",
    ),
  );
  return cachedSchema;
}

function validateAgainstSchema(record, schema, path = "record") {
  const errors = [];
  if (schema.const !== undefined && record !== schema.const)
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema.type === "object") {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return [`${path} must be an object`];
    }
    for (const field of schema.required ?? []) {
      if (!(field in record)) errors.push(`${path}.${field} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in (schema.properties ?? {})))
          errors.push(`${path}.${key} is not an allowed property`);
      }
    }
    for (const [key, subschema] of Object.entries(schema.properties ?? {})) {
      if (key in record)
        errors.push(...validateAgainstSchema(record[key], subschema, `${path}.${key}`));
    }
    return errors;
  }
  if (schema.enum && !schema.enum.includes(record))
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  if (schema.type === "string") {
    if (typeof record !== "string") errors.push(`${path} must be a string`);
    else {
      if (schema.minLength !== undefined && record.length < schema.minLength)
        errors.push(`${path} must be at least ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && record.length > schema.maxLength)
        errors.push(`${path} must be at most ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(record))
        errors.push(`${path} must match ${schema.pattern}`);
    }
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(record)) errors.push(`${path} must be an integer`);
    else {
      if (schema.minimum !== undefined && record < schema.minimum)
        errors.push(`${path} must be >= ${schema.minimum}`);
      if (schema.maximum !== undefined && record > schema.maximum)
        errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }
  if (schema.type === "number" && typeof record === "number") {
    if (schema.minimum !== undefined && record < schema.minimum)
      errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && record > schema.maximum)
      errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (schema.type === "array") {
    if (!Array.isArray(record)) errors.push(`${path} must be an array`);
    else {
      if (schema.minItems !== undefined && record.length < schema.minItems)
        errors.push(`${path} must have at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && record.length > schema.maxItems)
        errors.push(`${path} must have at most ${schema.maxItems} items`);
      record.forEach((item, i) =>
        errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)),
      );
    }
  }
  if (schema.format === "date-time") {
    if (Number.isNaN(Date.parse(record))) errors.push(`${path} must be a valid ISO date-time`);
  }
  return errors;
}

export function validateSkillProgress(record) {
  const errors = validateAgainstSchema(record, loadSchema());
  if (errors.length) return { ok: false, reason: errors[0], errors };

  const total = record.milestones.reduce((sum, m) => sum + m.weightPercent, 0);
  if (total !== 100)
    return { ok: false, reason: `milestone weights sum to ${total}; must be exactly 100`, errors };

  let computed = 0;
  for (const m of record.milestones) {
    if (m.status === "complete") computed += m.weightPercent;
    else if (m.status === "active") {
      if (typeof m.verifiedFraction !== "number")
        return { ok: false, reason: `active milestone ${m.id} requires verifiedFraction`, errors };
      computed += m.weightPercent * m.verifiedFraction;
    }
  }
  computed = Math.floor(computed);
  if (record.overallPercent !== computed)
    return {
      ok: false,
      reason: `overallPercent ${record.overallPercent} != computed ${computed} (completed + active x fraction)`,
      errors,
    };
  if (record.status === "complete" && record.overallPercent !== 100)
    return { ok: false, reason: `complete record must have overallPercent 100`, errors };

  return { ok: true, computedPercent: computed };
}

export function renderSkillProgress(record) {
  const verdict = validateSkillProgress(record);
  if (!verdict.ok) throw new Error(`cannot render invalid skill progress: ${verdict.reason}`);
  const filled = Math.round((record.overallPercent * BAR_WIDTH) / 100);
  const bar = `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
  const milestones = record.milestones
    .map((m) => `[${m.title} ${STATUS_SYMBOL[m.status]} ${m.weightPercent}%]`)
    .join(" ");
  return `TASK PROGRESS  [${bar}] ${record.overallPercent}%\nMilestones\n${milestones}`;
}

export async function loadSkillProgress(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}
