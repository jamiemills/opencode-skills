import { readFile, writeFile, link, unlink, mkdir, lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  createSchemaValidator,
  canonicalize,
  digest,
  parseJson,
} from "../../../lib/schema-runtime/index.mjs";
import schema from "../schemas/csm-plan.schema.json" with { type: "json" };

export const PLAN_SCHEMA = "csm-plan/1";
export const PLAN_PATH_PATTERN = ".agents/plans/<date>-<goal-slug>-csm.json";
const validator = createSchemaValidator({ schemas: [schema] });
const STATES = new Set([
  "INTAKE",
  "DISCOVER",
  "RESEARCH",
  "DRAFT",
  "CRITIQUE",
  "REMEDIATE",
  "VERIFY",
  "SAVED",
  "STOP",
  "NOT_STARTED",
  "RECOVER",
  "VALIDATE",
  "SELECT",
  "DISPATCH",
  "INTEGRATE",
  "REVIEW",
  "REPAIR",
  "CHECKPOINT",
  "COMPLETE",
  "BLOCKED",
  "PAUSED",
]);

const identity = (value, prefix) =>
  `${prefix}-${createHash("sha256").update(canonicalize(value)).digest("hex").slice(0, 32)}`;

const APPLICABILITY_SIGNALS = new Map([
  ["boundary_change", ["boundary", "observable_behavior", "seam"]],
  ["public_contract", ["contract", "parity", "observable_behavior"]],
  ["ownership_or_persistence", ["ownership", "invariant", "rollback_recovery"]],
  ["invariant_or_consistency", ["invariant", "observable_behavior"]],
  ["external_side_effect", ["boundary", "observable_behavior", "rollback_recovery"]],
  ["migration_or_rollback", ["parity", "rollback_recovery", "unresolved_risks"]],
  ["cross_boundary_coordination", ["boundary", "ownership", "seam"]],
  ["architecture_or_refactor", ["boundary", "ownership", "seam", "unresolved_risks"]],
  ["security_or_authority", ["boundary", "contract", "unresolved_risks"]],
]);
const APPLICABILITY_OBLIGATIONS = new Set([
  "boundary",
  "ownership",
  "contract",
  "invariant",
  "observable_behavior",
  "seam",
  "parity",
  "rollback_recovery",
  "unresolved_risks",
]);
const APPLICABILITY_MODES = new Set(["risk-first", "explicit-opt-in", "lightweight-bypass"]);
const EVIDENCE_SOURCES = new Set(["brief", "plan", "repository", "ddd"]);
const APPLICABILITY_DECISIONS = new Set(["lightweight", "warranted", "mixed"]);

function applicabilityErrors(value) {
  if (value?.applicability === null || value?.applicability === undefined) return [];
  const record = value.applicability;
  const errors = [];
  const allowed = new Set([
    "format",
    "decision",
    "mode",
    "matchedSignals",
    "evidence",
    "obligations",
    "taskApplicability",
    "dddArtifacts",
    "unresolvedRisks",
    "bypass",
    "reclassificationHistory",
  ]);
  if (!record || typeof record !== "object" || Array.isArray(record))
    return ["/applicability must be a csm-applicability/1 object"];
  if (record.format !== "csm-applicability/1") errors.push("/applicability format is invalid");
  for (const key of Object.keys(record))
    if (!allowed.has(key)) errors.push(`/applicability unknown key ${key}`);
  if (!["lightweight", "warranted", "mixed"].includes(record.decision))
    errors.push("/applicability decision is invalid");
  if (!APPLICABILITY_MODES.has(record.mode)) errors.push("/applicability mode is invalid");
  if (
    !Array.isArray(record.matchedSignals) ||
    record.matchedSignals.some((signal) => !APPLICABILITY_SIGNALS.has(signal))
  )
    errors.push("/applicability matchedSignals must contain canonical signals");
  else if (new Set(record.matchedSignals).size !== record.matchedSignals.length)
    errors.push("/applicability matchedSignals must not contain duplicates");
  if (!Array.isArray(record.evidence)) errors.push("/applicability evidence must be an array");
  else
    for (const [index, item] of record.evidence.entries()) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => !["source", "locator", "observation"].includes(key)) ||
        !EVIDENCE_SOURCES.has(item.source) ||
        typeof item.locator !== "string" ||
        !item.locator.trim() ||
        typeof item.observation !== "string" ||
        !item.observation.trim()
      )
        errors.push(`/applicability/evidence/${index} is malformed`);
    }
  if (!Array.isArray(record.obligations))
    errors.push("/applicability obligations must be an array");
  if (!record.taskApplicability || typeof record.taskApplicability !== "object")
    errors.push("/applicability taskApplicability is required");
  const obligations = new Map();
  for (const [index, item] of (record.obligations ?? []).entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => !["id", "status"].includes(key)) ||
      !APPLICABILITY_OBLIGATIONS.has(item.id) ||
      !["required", "satisfied", "missing", "not_applicable", "unverified"].includes(item.status)
    ) {
      errors.push(`/applicability/obligations/${index} is malformed`);
    } else if (obligations.has(item.id))
      errors.push(`/applicability/obligations/${index} is duplicated`);
    else obligations.set(item.id, item.status);
  }
  const taskApplicability = record.taskApplicability;
  if (
    taskApplicability &&
    (Array.isArray(taskApplicability) ||
      Object.keys(taskApplicability).some((key) => !["warranted", "lightweight"].includes(key)) ||
      !Array.isArray(taskApplicability.warranted) ||
      !Array.isArray(taskApplicability.lightweight))
  )
    errors.push(
      "/applicability taskApplicability must contain only warranted and lightweight arrays",
    );
  else if (taskApplicability) {
    const taskIds = [...taskApplicability.warranted, ...taskApplicability.lightweight];
    if (taskIds.some((task) => typeof task !== "string" || !/^T\d{3}$/.test(task)))
      errors.push("/applicability task slices contain malformed task IDs");
    if (new Set(taskIds).size !== taskIds.length)
      errors.push("/applicability task slices must not duplicate or overlap task IDs");
  }
  if (
    !Array.isArray(record.dddArtifacts) ||
    record.dddArtifacts.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some(
          (key) => !["report", "graph", "runId", "reportRunId", "graphRunId"].includes(key),
        ) ||
        ["report", "graph", "runId", "reportRunId", "graphRunId"].some(
          (key) =>
            typeof item[key] !== "string" ||
            !item[key].trim() ||
            isAbsolute(item[key]) ||
            /^[A-Za-z]:[\\/]/.test(item[key]) ||
            item[key]
              .replaceAll("\\", "/")
              .split("/")
              .some((part) => part === ".." || part === ""),
        ) ||
        item.runId !== item.reportRunId ||
        item.runId !== item.graphRunId,
    )
  )
    errors.push(
      "/applicability dddArtifacts must contain matching relative report/graph references",
    );
  if (
    !Array.isArray(record.unresolvedRisks) ||
    record.unresolvedRisks.some((risk) => typeof risk !== "string" || !risk.trim())
  )
    errors.push("/applicability unresolvedRisks must be an array of non-empty strings");
  if (
    !record.bypass ||
    typeof record.bypass !== "object" ||
    Array.isArray(record.bypass) ||
    Object.keys(record.bypass).some((key) => !["requested", "rationale"].includes(key)) ||
    typeof record.bypass.requested !== "boolean" ||
    (record.bypass.rationale !== null &&
      (typeof record.bypass.rationale !== "string" || !record.bypass.rationale.trim()))
  )
    errors.push("/applicability bypass has an invalid shape");
  if (record.bypass?.requested) {
    if (record.matchedSignals?.length)
      errors.push("/applicability bypass cannot hide matched signals");
    if (!record.bypass.rationale?.trim()) errors.push("/applicability bypass requires a rationale");
    if (record.mode !== "lightweight-bypass" || record.decision !== "lightweight")
      errors.push("/applicability bypass must use lightweight-bypass/lightweight");
  } else if (record.bypass?.rationale !== null)
    errors.push("/applicability non-requested bypass must have a null rationale");
  if (record.mode === "explicit-opt-in" && record.decision !== "warranted")
    errors.push("/applicability explicit-opt-in mode must be warranted");
  if (
    record.mode === "lightweight-bypass" &&
    (!record.bypass?.requested || record.decision !== "lightweight")
  )
    errors.push("/applicability lightweight-bypass mode requires a requested lightweight bypass");
  if (
    record.reclassificationHistory !== undefined &&
    (!Array.isArray(record.reclassificationHistory) ||
      record.reclassificationHistory.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          Object.keys(entry).some((key) => !["from", "to", "reason"].includes(key)) ||
          !APPLICABILITY_DECISIONS.has(entry.from) ||
          !APPLICABILITY_DECISIONS.has(entry.to) ||
          typeof entry.reason !== "string" ||
          !entry.reason.trim(),
      ))
  )
    errors.push("/applicability reclassificationHistory has an invalid shape");
  const required = [
    ...new Set(
      (record.matchedSignals ?? []).flatMap((signal) => APPLICABILITY_SIGNALS.get(signal) ?? []),
    ),
  ];
  if (["warranted", "mixed"].includes(record.decision)) {
    if (!record.obligations?.length) errors.push("warranted applicability requires obligations");
    for (const id of required)
      if (!obligations.has(id) || obligations.get(id) === "missing")
        errors.push(`/applicability missing required obligation ${id}`);
    const warranted = record.taskApplicability?.warranted;
    const lightweight = record.taskApplicability?.lightweight;
    if (!Array.isArray(warranted) || (record.decision === "warranted" && warranted.length === 0))
      errors.push("warranted applicability requires warranted task slices");
    if (record.decision === "mixed" && (!warranted?.length || !lightweight?.length))
      errors.push("mixed applicability requires both task slices");
    for (const tasks of [warranted, lightweight])
      if (tasks && (!Array.isArray(tasks) || tasks.some((task) => !/^T\d{3}$/.test(task))))
        errors.push("/applicability task slices contain malformed task IDs");
  }
  const planTaskIds = new Set((value.tasks ?? []).map((task) => task.taskId));
  for (const task of [
    ...(record.taskApplicability?.warranted ?? []),
    ...(record.taskApplicability?.lightweight ?? []),
  ])
    if (!planTaskIds.has(task))
      errors.push(`/applicability task slice ${task} does not resolve to a plan task`);
  const hasSignals = record.matchedSignals?.length > 0;
  const hasWarrantedTasks = record.taskApplicability?.warranted?.length > 0;
  const hasLightweightTasks = record.taskApplicability?.lightweight?.length > 0;
  if (record.decision === "mixed" && record.mode !== "risk-first")
    errors.push("/applicability mixed decisions must use risk-first mode");
  if (hasSignals && record.decision === "lightweight")
    errors.push("/applicability matched signals cannot produce a lightweight decision");
  if (hasWarrantedTasks && record.decision === "lightweight")
    errors.push("/applicability warranted tasks cannot produce a lightweight decision");
  if (hasWarrantedTasks && hasLightweightTasks && record.decision !== "mixed")
    errors.push("/applicability mixed task slices require a mixed decision");
  if (
    record.decision === "warranted" &&
    !hasSignals &&
    !hasWarrantedTasks &&
    record.mode !== "explicit-opt-in"
  )
    errors.push("/applicability warranted decisions require a signal, task, or explicit opt-in");
  if (record.mode === "explicit-opt-in" && hasSignals)
    errors.push("/applicability explicit opt-in cannot include matched signals");
  if (record.mode === "lightweight-bypass" && (hasWarrantedTasks || hasSignals))
    errors.push("/applicability lightweight bypass cannot contain warranted scope");
  if (!hasWarrantedTasks && hasLightweightTasks && record.decision === "warranted")
    errors.push("/applicability lightweight-only task scope cannot be warranted");
  return errors;
}

function semanticErrors(value) {
  const errors = [];
  const validTransition = (transition) => {
    if (typeof transition !== "string") return false;
    const candidate = transition.replace(/^On a future explicit csm-build invocation,\s*/, "");
    if (["none (terminal)", "none; closed as superseded"].includes(candidate)) return true;
    const match = candidate.match(/^([A-Z_]+)\s*->\s*([A-Z_]+)$/);
    return Boolean(match && STATES.has(match[1]) && STATES.has(match[2]));
  };
  if (value?.control?.status !== value?.status) errors.push("/control/status must match status");
  errors.push(...applicabilityErrors(value));
  if (value?.control && !STATES.has(value.control.currentState))
    errors.push("/control/currentState is not a known lifecycle state");
  if (value?.control && !validTransition(value.control.nextTransition))
    errors.push("/control/nextTransition is not a valid lifecycle transition");
  if (value?.control?.currentState === "PAUSED" && value.status !== "paused")
    errors.push("PAUSED plans must have paused status");
  if (value?.control?.currentState === "COMPLETE" && value.status !== "complete")
    errors.push("COMPLETE plans must have complete status");
  if (value?.status === "paused" && value.control?.currentState !== "PAUSED")
    errors.push("paused plans must have a PAUSED cursor");
  if (value?.status === "complete" && value.control?.currentState !== "COMPLETE")
    errors.push("complete plans must have a COMPLETE cursor");
  if (value?.status === "paused" && value.control?.nextTransition !== "PAUSED -> RECOVER")
    errors.push("paused plans must transition through PAUSED -> RECOVER");
  const finalJournalState = value?.journal?.at(-1)?.nextState;
  if (
    value?.journal?.length &&
    STATES.has(finalJournalState) &&
    finalJournalState !== value.control.currentState
  )
    errors.push("plan cursor must match the final journal state");
  if (value?.status === "complete" && finalJournalState !== "COMPLETE")
    errors.push("complete plans must end with a COMPLETE journal state");
  const ids = new Set();
  for (const [index, task] of (value?.tasks ?? []).entries()) {
    if (ids.has(task.taskId)) errors.push(`/tasks/${index}/taskId collides with an existing task`);
    ids.add(task.taskId);
    if (task.ordinal !== index + 1) errors.push(`/tasks/${index}/ordinal must be ${index + 1}`);
  }
  const sequences = (value?.journal ?? []).map((event) => event.sequence);
  if (sequences.some((sequence, index) => sequence !== index))
    errors.push("/journal sequence must be append-only and contiguous");
  for (const event of value?.journal ?? []) {
    if (!STATES.has(event.nextState) && !["closed", "completion gate"].includes(event.nextState))
      errors.push(`/journal nextState ${event.nextState} is unknown`);
    if (!validTransition(event.transition))
      errors.push(`/journal transition ${event.transition} is invalid`);
  }
  if (
    value?.status === "paused" &&
    (value.control.currentState !== "PAUSED" || value.journal.at(-1)?.nextState !== "PAUSED")
  )
    errors.push("paused plans must end their cursor and journal at PAUSED");
  if (
    value?.status === "complete" &&
    (value?.control?.currentState !== "COMPLETE" ||
      !["none (terminal)", "none; closed as superseded"].includes(value?.control?.nextTransition))
  )
    errors.push("terminal plans cannot be resumed or replaced");
  return errors;
}

export function validatePlanArtifact(value) {
  const result = validator.validate(PLAN_SCHEMA, value);
  const errors = result.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
  errors.push(...semanticErrors(value));
  return { valid: errors.length === 0, errors };
}

export function createPlanArtifact(input, { producerVersion = "csm-plan/1" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("plan input must be an object");
  const producedAt = input.provenance?.producedAt ?? new Date().toISOString();
  const runId = input.runId ?? identity({ planId: input.planId, producedAt }, "run");
  const status = input.status ?? input.control?.status ?? "ready";
  const control = {
    currentState: "NOT_STARTED",
    cycle: 0,
    commits: "disabled",
    lastCheckpoint: "none",
    lastModelRun: "",
    nextTransition: "On a future explicit csm-build invocation, NOT_STARTED -> RECOVER",
    activeTasks: [],
    blockers: [],
    resume: {
      instruction:
        "re-read control, latest journal, recovery notes, requirements, and working-tree diff",
    },
    ...structuredClone(input.control ?? {}),
    status,
  };
  const payload = {
    schema: PLAN_SCHEMA,
    schemaRevision: 1,
    artifactId: input.artifactId ?? identity({ runId, planId: input.planId }, "art"),
    runId,
    planId: input.planId,
    status,
    control,
    goal: structuredClone(input.goal ?? {}),
    acceptanceCriteria: structuredClone(input.acceptanceCriteria ?? []),
    currentStateEvidence: structuredClone(input.currentStateEvidence ?? {}),
    applicability: input.applicability === undefined ? null : structuredClone(input.applicability),
    assumptionsAndDecisions: structuredClone(input.assumptionsAndDecisions ?? []),
    rdRecord: structuredClone(input.rdRecord ?? []),
    discoveredRequirements: structuredClone(input.discoveredRequirements ?? []),
    design: structuredClone(input.design ?? {}),
    executionGraph: structuredClone(input.executionGraph ?? {}),
    tasks: structuredClone(input.tasks ?? []),
    verificationStrategy: structuredClone(input.verificationStrategy ?? {}),
    risksAndRecovery: structuredClone(input.risksAndRecovery ?? {}),
    critiqueResolution: structuredClone(input.critiqueResolution ?? []),
    journal: structuredClone(input.journal ?? []),
    completionReview: input.completionReview ?? null,
    inputs: structuredClone(input.inputs ?? []),
    provenance: {
      producer: "csm-plan",
      producerVersion,
      producedAt,
      sourceDigests: [...(input.provenance?.sourceDigests ?? [])],
    },
    projection: { profile: "csm-plan-human/1", legacyMarkdownStatus: "history-only" },
  };
  payload.digest = digest(payload);
  const result = validatePlanArtifact(payload);
  if (!result.valid) throw new TypeError(`invalid plan artifact: ${result.errors.join(", ")}`);
  return payload;
}

export function serializePlanArtifact(value) {
  const result = validatePlanArtifact(value);
  if (!result.valid) throw new TypeError(`invalid plan artifact: ${result.errors.join(", ")}`);
  return `${canonicalize(value)}\n`;
}

export async function writePlanArtifact(path, value) {
  if (extname(path) !== ".json")
    throw Object.assign(new TypeError("plans must be persisted as canonical JSON"), {
      code: "migration-required",
    });
  const absolute = resolve(path);
  const marker = `${sep}.agents${sep}plans${sep}`;
  const markerIndex = absolute.lastIndexOf(marker);
  const root = markerIndex < 0 ? null : absolute.slice(0, markerIndex);
  const filename = absolute.slice(markerIndex + marker.length);
  if (!root || !/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*-csm\.json$/.test(filename))
    throw Object.assign(new TypeError(`plans must use ${PLAN_PATH_PATTERN}`), {
      code: "non-canonical-path",
    });
  if (value?.provenance?.producer !== "csm-plan")
    throw Object.assign(new TypeError("plan owner must be csm-plan"), {
      code: "ownership-mismatch",
    });
  let current = sep;
  for (const component of absolute.split(sep).filter(Boolean)) {
    current = current === sep ? `${sep}${component}` : `${current}${sep}${component}`;
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Object.assign(new Error("symlinked plan path is not allowed"), {
          code: "symlink-path",
        });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      break;
    }
  }
  await mkdir(dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  await writeFile(temp, serializePlanArtifact(value), { flag: "wx" });
  try {
    try {
      const existing = JSON.parse(await readFile(absolute, "utf8"));
      if (existing.status === "complete")
        throw Object.assign(new Error("terminal plan cannot be replaced"), {
          code: "terminal-replacement",
        });
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "terminal-replacement") throw error;
      if (error.code === "terminal-replacement") throw error;
    }
    await link(temp, absolute);
    await unlink(temp);
  } catch (error) {
    try {
      await unlink(temp);
    } catch {}
    if (error.code === "EEXIST") error.code = "collision";
    throw error;
  }
  return { path: absolute, digest: digest(value) };
}

export async function readPlanArtifact(path) {
  if (extname(path) !== ".json")
    throw Object.assign(
      new Error("legacy Markdown plan requires migration-required reconstruction"),
      { code: "migration-required" },
    );
  const value = parseJson(await readFile(path, "utf8"));
  const result = validatePlanArtifact(value);
  if (!result.valid)
    throw Object.assign(new Error(result.errors.join(", ")), {
      code: "schema-invalid",
      errors: result.errors,
    });
  if (
    value.digest !== undefined &&
    value.digest !==
      digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")))
  )
    throw Object.assign(new Error("plan digest does not match content"), {
      code: "digest-mismatch",
    });
  if (value.owner !== undefined && value.owner !== "csm-plan")
    throw Object.assign(new Error("plan owner does not match csm-plan"), {
      code: "ownership-mismatch",
    });
  if (value.path !== undefined && resolve(value.path) !== resolve(path))
    throw Object.assign(new Error("plan path identity does not match artifact path"), {
      code: "identity-mismatch",
    });
  if (value.provenance?.digest !== undefined) {
    const payload = structuredClone(value);
    delete payload.provenance.digest;
    if (value.provenance.digest !== digest(payload))
      throw Object.assign(new Error("plan provenance digest does not match content"), {
        code: "digest-mismatch",
      });
  }
  if (value.provenance?.owner !== undefined && value.provenance.owner !== "csm-plan")
    throw Object.assign(new Error("plan provenance owner does not match csm-plan"), {
      code: "ownership-mismatch",
    });
  if (value.provenance?.path !== undefined && resolve(value.provenance.path) !== resolve(path))
    throw Object.assign(new Error("plan provenance path does not match artifact path"), {
      code: "identity-mismatch",
    });
  return value;
}

export function appendPlanJournal(value, event) {
  const result = validatePlanArtifact(value);
  if (!result.valid) throw new TypeError(`invalid plan artifact: ${result.errors.join(", ")}`);
  if (value.status === "complete")
    throw Object.assign(new Error("terminal plan is immutable"), { code: "terminal-immutable" });
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    typeof event.timestamp !== "string" ||
    typeof event.transition !== "string" ||
    typeof event.evidence !== "string" ||
    !STATES.has(event.nextState)
  )
    throw Object.assign(new TypeError("journal event has an invalid shape"), {
      code: "invalid-event",
    });
  const transition = event.transition.match(/^([A-Z_]+)\s*->\s*([A-Z_]+)$/);
  if (
    !transition ||
    transition[1] !== value.control.currentState ||
    transition[2] !== event.nextState
  )
    throw Object.assign(new Error("journal transition does not match the lifecycle cursor"), {
      code: "invalid-transition",
    });
  const next = structuredClone(value);
  next.journal.push({ ...structuredClone(event), sequence: next.journal.length });
  next.control.currentState = event.nextState;
  if (event.nextState === "COMPLETE") {
    next.status = next.control.status = "complete";
    next.control.nextTransition = "none (terminal)";
  } else if (event.nextState === "PAUSED") {
    next.status = next.control.status = "paused";
    next.control.nextTransition = "PAUSED -> RECOVER";
  } else if (value.status === "paused") {
    next.status = next.control.status = "in_progress";
    next.control.nextTransition = event.transition;
  } else {
    next.control.nextTransition = event.transition;
  }
  const final = validatePlanArtifact(next);
  if (!final.valid)
    throw new TypeError(`invalid resulting plan artifact: ${final.errors.join(", ")}`);
  return next;
}

export function resumePlanArtifact(
  value,
  { timestamp = new Date().toISOString(), evidence = "resume requested" } = {},
) {
  const result = validatePlanArtifact(value);
  if (!result.valid) throw new TypeError(`invalid plan artifact: ${result.errors.join(", ")}`);
  if (value.status === "complete")
    throw Object.assign(new Error("terminal plan is immutable"), { code: "terminal-immutable" });
  if (value.status !== "paused" || value.control.currentState !== "PAUSED")
    throw Object.assign(new Error("only a paused plan can resume"), { code: "not-paused" });
  const next = structuredClone(value);
  next.status = "in_progress";
  next.control.status = "in_progress";
  next.control.currentState = "RECOVER";
  next.control.nextTransition = "PAUSED -> RECOVER";
  next.journal.push({
    sequence: next.journal.length,
    timestamp,
    cycle: next.control.cycle,
    transition: "PAUSED -> RECOVER",
    tasks: [...next.control.activeTasks],
    evidence,
    nextState: "RECOVER",
  });
  return next;
}

export const validatePlan = validatePlanArtifact;
export const createPlan = createPlanArtifact;
export const readPlan = readPlanArtifact;
export const writePlan = writePlanArtifact;
export const resumePlan = resumePlanArtifact;

export { semanticErrors };
