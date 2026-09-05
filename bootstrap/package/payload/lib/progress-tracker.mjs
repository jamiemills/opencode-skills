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
    require("node:fs").readFileSync(new URL(`../${entry.schemaPath}`, import.meta.url), "utf-8"),
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

const STATUS_ALIASES = {
  done: "complete",
  finished: "complete",
  in_progress: "active",
  inprogress: "active",
  started: "active",
  todo: "pending",
  waiting: "pending",
};

const RECORD_STATUS_ALIASES = {
  in_progress: "active",
  inprogress: "active",
  done: "complete",
  finished: "complete",
};

export function normalizeStatus(raw, aliases) {
  const key = String(raw).trim().toLowerCase();
  return aliases[key] ?? key;
}

export function parseMilestoneSpec(spec) {
  const match = /^([A-Za-z][A-Za-z0-9]*)=([A-Za-z_]+)(?::([0-9]*\.?[0-9]+))?$/.exec(spec);
  if (!match) return null;
  const [, id, rawStatus, rawFraction] = match;
  const status = normalizeStatus(rawStatus, STATUS_ALIASES);
  if (!["complete", "active", "pending"].includes(status)) return null;
  if (rawFraction === undefined) return { id, status };
  if (status !== "active") return null;
  const verifiedFraction = Number(rawFraction);
  if (!(verifiedFraction >= 0 && verifiedFraction <= 1)) return null;
  return { id, status, verifiedFraction };
}

export function updateSkillProgress(
  record,
  specs,
  { now = new Date().toISOString(), status } = {},
) {
  const byId = new Map(record.milestones.map((m) => [m.id, m]));
  const updates = specs.map((spec) => {
    const parsed = parseMilestoneSpec(spec);
    if (!parsed)
      throw new Error(`invalid milestone spec: ${spec} (expected M<id>=<status>[:<fraction>])`);
    if (!byId.has(parsed.id)) throw new Error(`unknown milestone: ${parsed.id}`);
    return parsed;
  });
  for (const { id, status: milestoneStatus, verifiedFraction } of updates) {
    const milestone = byId.get(id);
    milestone.status = milestoneStatus;
    if (milestoneStatus === "active") milestone.verifiedFraction = verifiedFraction ?? 0;
    else delete milestone.verifiedFraction;
  }
  const next = { ...record, milestones: record.milestones.map((m) => ({ ...m })) };
  if (status !== undefined) next.status = normalizeStatus(status, RECORD_STATUS_ALIASES);
  else if (next.milestones.every((m) => m.status === "complete")) next.status = "complete";
  else if (next.status === "complete") next.status = "active";
  let computed = 0;
  for (const m of next.milestones) {
    if (m.status === "complete") computed += m.weightPercent;
    else if (m.status === "active") computed += m.weightPercent * (m.verifiedFraction ?? 0);
  }
  next.overallPercent = Math.floor(computed);
  next.updatedAt = now;
  const finalVerdict = validateSkillProgress(next);
  if (!finalVerdict.ok) throw new Error(`update produced invalid record: ${finalVerdict.reason}`);
  return next;
}

function isMain() {
  return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
}

async function main(argv) {
  const [command, file, ...rest] = argv;
  if (!file)
    throw new Error("usage: progress-tracker.mjs <update|show|validate> <file> [specs...]");
  const record = await loadSkillProgress(file);
  if (command === "show") {
    console.log(renderSkillProgress(record));
    return;
  }
  if (command === "validate") {
    const verdict = validateSkillProgress(record);
    if (!verdict.ok) throw new Error(verdict.reason);
    console.log(`valid — overallPercent ${record.overallPercent}`);
    return;
  }
  if (command === "update") {
    const statusFlag = rest.includes("--status") ? rest[rest.indexOf("--status") + 1] : undefined;
    const specs = rest.filter((arg) => arg !== "--status" && arg !== statusFlag);
    const next = updateSkillProgress(record, specs, { status: statusFlag });
    const { writeFile } = require("node:fs/promises");
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(renderSkillProgress(next));
    return;
  }
  throw new Error(`unknown command: ${command} (expected update|show|validate)`);
}

if (isMain()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
