// CSM skill progress tracker (csm-skill-progress/1). This is a pure library: it
// owns schema/derivation validation and normalization but has no lifecycle or
// session concept. The calling skill decides when a session is final — see
// csm-build/SKILL.md CHECKPOINT, which is the enforcement site for
// `validateSessionFinalization`.
//
// verifiedFraction rule (T005 reconciliation): a milestone claimed `complete`
// MUST retain a `verifiedFraction`, so `updateSkillProgress` sets it to 1 on
// completion instead of deleting it. Records written before this rule (the
// historical .agents/progress corpus and the sibling recorder) omit the
// fraction, so default validation *normalizes* them by inferring 1 rather than
// rejecting them; `{ strict: true }` rejects instead. This keeps the gate over
// the unmodifiable historical corpus green while the rule holds for new writes.
//
// Timestamp rule: `updatedAt` must not precede `startedAt`. New writes and
// session finalization are STRICT: `updateSkillProgress` and
// `validateSessionFinalization` reject the impossible order (no clamping), so a
// bad new record is refused. The read/compat path over the frozen historical
// corpus (the `.agents/progress` scan in scripts/check-suite.mjs) stays
// non-strict and normalizes the eight legacy records to `updatedAt = startedAt`.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const FRACTION_ON_COMPLETE = 1;

const BAR_WIDTH = 30;
const STATUS_SYMBOL = { complete: "✓", active: "▶", pending: "○" };

let cachedSchema = null;

async function atomicWrite(file, data) {
  const { writeFile: wf, rename } = await import("node:fs/promises");
  const tmp = file + ".tmp-" + Math.random().toString(36).slice(2);
  await wf(tmp, data);
  await rename(tmp, file);
}

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

// Non-mutating normalization of a raw record against the two cross-field rules
// the JSON schema cannot express: monotonic timestamps and verifiedFraction
// retention on complete milestones. Returns the normalized copy plus a list of
// the fixes applied (`[]` when the record already conforms).
export function normalizeSkillProgress(record) {
  const normalizations = [];
  if (!record || typeof record !== "object" || Array.isArray(record))
    return { record, normalizations };
  const next = {
    ...record,
    milestones: Array.isArray(record.milestones)
      ? record.milestones.map((m) => (m && typeof m === "object" ? { ...m } : m))
      : record.milestones,
  };
  const started = Date.parse(next.startedAt);
  const updated = Date.parse(next.updatedAt);
  if (Number.isFinite(started) && Number.isFinite(updated) && updated < started) {
    next.updatedAt = next.startedAt;
    normalizations.push({
      field: "updatedAt",
      reason: `updatedAt ${record.updatedAt} precedes startedAt ${record.startedAt}; clamped to startedAt`,
    });
  }
  if (Array.isArray(next.milestones)) {
    for (const milestone of next.milestones) {
      if (
        milestone &&
        typeof milestone === "object" &&
        milestone.status === "complete" &&
        typeof milestone.verifiedFraction !== "number"
      ) {
        milestone.verifiedFraction = FRACTION_ON_COMPLETE;
        normalizations.push({
          field: `milestones.${milestone.id}.verifiedFraction`,
          reason: `complete milestone ${milestone.id} is missing verifiedFraction; inferred ${FRACTION_ON_COMPLETE}`,
        });
      }
    }
  }
  return { record: next, normalizations };
}

export function validateSkillProgress(record, { strict = false } = {}) {
  const { record: normalized, normalizations } = normalizeSkillProgress(record);
  if (strict && normalizations.length)
    return {
      ok: false,
      reason: `progress record requires normalization: ${normalizations[0].reason}`,
      errors: normalizations.map((n) => n.reason),
      normalizations,
    };

  const errors = validateAgainstSchema(normalized, loadSchema());
  if (errors.length) return { ok: false, reason: errors[0], errors };

  const total = normalized.milestones.reduce((sum, m) => sum + m.weightPercent, 0);
  if (total !== 100)
    return { ok: false, reason: `milestone weights sum to ${total}; must be exactly 100`, errors };

  let computed = 0;
  for (const m of normalized.milestones) {
    if (m.status === "complete") computed += m.weightPercent;
    else if (m.status === "active") {
      if (typeof m.verifiedFraction !== "number")
        return { ok: false, reason: `active milestone ${m.id} requires verifiedFraction`, errors };
      computed += m.weightPercent * m.verifiedFraction;
    }
  }
  computed = Math.floor(computed);
  if (normalized.overallPercent !== computed)
    return {
      ok: false,
      reason: `overallPercent ${normalized.overallPercent} != computed ${computed} (completed + active x fraction)`,
      errors,
    };
  if (normalized.status === "complete" && normalized.overallPercent !== 100)
    return { ok: false, reason: `complete record must have overallPercent 100`, errors };

  const verdict = { ok: true, computedPercent: computed };
  if (normalizations.length) {
    verdict.normalized = true;
    verdict.normalizations = normalizations;
  }
  return verdict;
}

// Session-finalization gate. csm-build's CHECKPOINT block calls this before a
// terminal transition: a session that reaches CHECKPOINT -> COMPLETE must have
// finalized its progress record (100% / terminal) or the transition is refused.
export function validateSessionFinalization(record) {
  const verdict = validateSkillProgress(record, { strict: true });
  if (!verdict.ok) return { ok: false, reason: `progress record is invalid: ${verdict.reason}` };
  if (record.status !== "complete")
    return {
      ok: false,
      reason: `session not finalized: status is "${record.status}", expected "complete"`,
    };
  if (record.overallPercent !== 100)
    return {
      ok: false,
      reason: `session not finalized: overallPercent is ${record.overallPercent}, expected 100`,
    };
  const open = record.milestones.filter((m) => m.status !== "complete").map((m) => m.id);
  if (open.length)
    return {
      ok: false,
      reason: `session not finalized: non-terminal milestones ${open.join(", ")}`,
    };
  return { ok: true };
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

// Derive 3-6 weighted milestones from a saved plan's execution graph so every
// progress record stops reusing a boilerplate milestone signature. Accepts both
// `executionGraph.parallelGroups` shapes (object `{G1:[...]}` and array
// `[{group, tasks}]`) and falls back to `task.parallelGroup` buckets, then to
// the task list itself. Throws when fewer than three milestones can be derived,
// so the caller must declare milestones explicitly instead.
function taskIndex(tasks) {
  const index = new Map();
  for (const task of tasks) {
    const id = task?.taskId ?? task?.id;
    if (id) index.set(id, task);
  }
  return index;
}

function executionGroups(plan, tasks) {
  const index = taskIndex(tasks);
  const asTasks = (raw) =>
    raw.map((item) => (typeof item === "string" ? (index.get(item) ?? { taskId: item }) : item));
  const parallelGroups = plan?.executionGraph?.parallelGroups;
  const groups = [];
  if (Array.isArray(parallelGroups)) {
    for (const entry of parallelGroups) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry.tasks ?? entry.taskIds ?? entry.nodes;
      if (Array.isArray(raw))
        groups.push({ id: entry.id ?? entry.group ?? null, tasks: asTasks(raw) });
    }
  } else if (parallelGroups && typeof parallelGroups === "object") {
    for (const [id, raw] of Object.entries(parallelGroups)) {
      if (Array.isArray(raw)) groups.push({ id, tasks: asTasks(raw) });
      else if (raw && Array.isArray(raw.tasks)) groups.push({ id, tasks: asTasks(raw.tasks) });
    }
  }
  if (groups.length) return groups;
  const byGroup = new Map();
  for (const task of tasks) {
    const key = task?.parallelGroup ?? "G1";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(task);
  }
  if (byGroup.size) return [...byGroup.entries()].map(([id, list]) => ({ id, tasks: list }));
  return tasks.length ? [{ id: null, tasks }] : [];
}

function bucketize(steps, count) {
  const base = Math.floor(steps.length / count);
  const remainder = steps.length % count;
  const buckets = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    buckets.push(steps.slice(cursor, cursor + size));
    cursor += size;
  }
  return buckets;
}

function distributeWeights(count) {
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function bucketTitle(bucket) {
  const firstGroup = bucket[0]?.id;
  const lastGroup = bucket[bucket.length - 1]?.id;
  const taskTitles = bucket
    .flatMap((step) => step.tasks ?? [])
    .map((task) => task?.title)
    .filter((title) => typeof title === "string" && title.length);
  const label = taskTitles[0] ?? (firstGroup ? `${firstGroup} work` : "milestone");
  const groupPart =
    firstGroup && lastGroup && firstGroup !== lastGroup
      ? `${firstGroup}–${lastGroup}: `
      : firstGroup
        ? `${firstGroup}: `
        : "";
  const more = taskTitles.length > 1 ? ` +${taskTitles.length - 1} more` : "";
  return truncate(`${groupPart}${label}${more}`, 80);
}

export function milestonesFromExecutionGraph(plan, { status = "pending" } = {}) {
  if (!["complete", "active", "pending"].includes(status))
    throw new TypeError(`invalid milestone status: ${status}`);
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const groups = executionGroups(plan, tasks);
  const steps =
    groups.length >= 3
      ? groups
      : tasks.map((task) => ({ id: task?.taskId ?? null, tasks: [task] }));
  if (steps.length < 3)
    throw new Error(
      "execution graph yields fewer than 3 derivable milestones; declare milestones explicitly",
    );
  const buckets = bucketize(steps, Math.min(6, steps.length));
  const weights = distributeWeights(buckets.length);
  return buckets.map((bucket, i) => ({
    id: `M${i + 1}`,
    title: bucketTitle(bucket),
    weightPercent: weights[i],
    status,
  }));
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
    else if (milestoneStatus === "complete") milestone.verifiedFraction = FRACTION_ON_COMPLETE;
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
  const finalVerdict = validateSkillProgress(next, { strict: true });
  if (!finalVerdict.ok) throw new Error(`update produced invalid record: ${finalVerdict.reason}`);
  return next;
}

function isMain() {
  return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
}

async function main(argv) {
  const [command, file, ...rest] = argv;
  if (!file)
    throw new Error(
      "usage: progress-tracker.mjs <update|show|validate|finalize> <file> [specs...]",
    );
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
  if (command === "finalize") {
    const verdict = validateSessionFinalization(record);
    if (!verdict.ok) throw new Error(verdict.reason);
    console.log(`finalized — ${record.overallPercent}% (${record.milestones.length} milestones)`);
    return;
  }
  if (command === "update") {
    const statusFlag = rest.includes("--status") ? rest[rest.indexOf("--status") + 1] : undefined;
    const specs = rest.filter((arg) => arg !== "--status" && arg !== statusFlag);
    const next = updateSkillProgress(record, specs, { status: statusFlag });
    await atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(renderSkillProgress(next));
    return;
  }
  throw new Error(`unknown command: ${command} (expected update|show|validate|finalize)`);
}

if (isMain()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
