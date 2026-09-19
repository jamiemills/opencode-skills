import {
  createSchemaValidator,
  digest,
  loadSchemaRegistry,
} from "../../lib/schema-runtime/index.mjs";
import schema from "../schemas/state.schema.json" with { type: "json" };
import schemaV2 from "../schemas/state.v2.schema.json" with { type: "json" };
import { resolveBddInput } from "./bdd-input-resolver.mjs";
import { resolveTestPackage } from "./test-package.mjs";
import { assertCompletionGate } from "./loop-guard.mjs";
import { resolveArtifactFile } from "../../lib/artifact-resolver/index.mjs";
import { validatePlanArtifact } from "../../csm-plan/lib/plan.mjs";
import { isAbsolute } from "node:path";

export const BUILD_SCHEMA = "csm-build-state/1";
export const BUILD_SCHEMA_V2 = "csm-build-state/2";
// Dual-revision reader contract: /1 stays byte-frozen and /2 is additive.
export const BUILD_SCHEMAS = Object.freeze([BUILD_SCHEMA, BUILD_SCHEMA_V2]);

// Evaluator contract (P2a doc constant; enforced in-loop by P3). Same binding
// contract as csm-plan's: durable control + goal/acceptance in, one
// continue|complete|blocked verdict with evidence out, journaled as a receipt.
export { EVALUATOR_CONTRACT } from "../../csm-plan/lib/plan.mjs";
export {
  EVALUATOR_VERDICTS,
  createEvaluatorReceipt,
  evaluatorReceiptDescriptor,
  findEvaluatorVerdict,
  isEvaluatorReceipt,
  recordEvaluatorReceipt,
} from "./loop-guard.mjs";

export const BUILD_STATES = Object.freeze([
  "RECOVER",
  "VALIDATE",
  "SELECT",
  "DISPATCH",
  "INTEGRATE",
  "VERIFY",
  "REVIEW",
  "REPAIR",
  "CHECKPOINT",
  "COMPLETE",
  "BLOCKED",
  "PAUSED",
  "SUPERSEDED",
]);
const TERMINAL_BY_REVISION = new Map([
  [1, new Set(["COMPLETE", "BLOCKED"])],
  [2, new Set(["COMPLETE", "BLOCKED", "SUPERSEDED"])],
]);
const terminalFor = (value) => TERMINAL_BY_REVISION.get(value?.schema === BUILD_SCHEMA_V2 ? 2 : 1);
const transitions = new Map([
  ["RECOVER", ["VALIDATE", "BLOCKED"]],
  ["VALIDATE", ["SELECT", "REPAIR", "BLOCKED"]],
  ["SELECT", ["DISPATCH", "CHECKPOINT", "BLOCKED", "PAUSED"]],
  ["DISPATCH", ["INTEGRATE", "REPAIR", "BLOCKED"]],
  ["INTEGRATE", ["VERIFY", "REPAIR", "BLOCKED"]],
  ["VERIFY", ["REVIEW", "REPAIR", "BLOCKED"]],
  ["REVIEW", ["CHECKPOINT", "REPAIR", "BLOCKED"]],
  ["REPAIR", ["VALIDATE", "BLOCKED"]],
  ["CHECKPOINT", ["SELECT", "COMPLETE", "BLOCKED"]],
  ["PAUSED", ["RECOVER"]],
]);
const validator = createSchemaValidator({ schemas: [schema, schemaV2] });
const reject = (code, message, extra = {}) =>
  Object.freeze({ status: "rejected", code, message, ...extra });

export function validateBuildState(value) {
  const schemaId = value?.schema === BUILD_SCHEMA_V2 ? BUILD_SCHEMA_V2 : BUILD_SCHEMA;
  const result = validator.validate(schemaId, value);
  const errors = [...result.errors];
  const terminal = terminalFor(value);
  if (value?.control && value.status === "complete" && value.control.currentState !== "COMPLETE")
    errors.push({ message: "complete state must be terminal" });
  if (value?.control?.currentState === "PAUSED" && value.status !== "paused")
    errors.push({ message: "paused state must have paused status" });
  if (value?.status === "paused" && value.control?.currentState !== "PAUSED")
    errors.push({ message: "paused status must have paused state" });
  if (value?.status === "paused" && value.control?.nextTransition !== "PAUSED -> RECOVER")
    errors.push({ message: "paused state must recover through PAUSED -> RECOVER" });
  if (value?.status === "superseded") {
    if (!value?.supersession) errors.push({ message: "superseded state requires a supersession" });
    if (value?.control?.currentState !== "SUPERSEDED")
      errors.push({ message: "superseded state must close on a SUPERSEDED cursor" });
  } else if (value?.supersession) {
    errors.push({ message: "supersession is only valid on a superseded state" });
  }
  const current = value?.control?.currentState;
  // Cursor alignment (T002/P2a): the SKILL lets a state declare which of its
  // legal exits it will take (e.g. CHECKPOINT -> COMPLETE/BLOCKED as well as
  // CHECKPOINT -> SELECT), so accept any declared transition of the current
  // state rather than pinning to the first one in the table.
  const allowedTransitions = terminal.has(current)
    ? ["none (terminal)"]
    : (transitions.get(current) ?? []).map((to) => `${current} -> ${to}`);
  if (!allowedTransitions.includes(value?.control?.nextTransition))
    errors.push({ message: "next transition does not match the lifecycle state" });
  if (value?.journal?.length) {
    if (value.journal.at(-1).to !== value.control.currentState)
      errors.push({ message: "cursor must match journal" });
    for (const [index, event] of value.journal.entries())
      if (event.sequence !== index) errors.push({ message: "journal is not contiguous" });
  }
  if (
    terminal.has(value?.control?.currentState) &&
    value?.journal?.at(-1)?.to !== value.control.currentState
  )
    errors.push({ message: "terminal state requires terminal journal event" });
  if (current === "PAUSED" && value.journal?.at(-1)?.from !== "SELECT")
    errors.push({ message: "paused state requires SELECT -> PAUSED evidence" });
  for (const descriptor of [...(value?.artifacts ?? []), ...(value?.completion?.evidence ?? [])]) {
    const body = Object.fromEntries(
      Object.entries(descriptor).filter(([key]) => key !== "descriptorDigest"),
    );
    if (descriptor.descriptorDigest !== digest(body))
      errors.push({ message: `descriptor digest mismatch: ${descriptor.artifactId}` });
  }
  return { valid: errors.length === 0, errors };
}

export function createBuildState({
  runId = "run-build",
  artifactId = "art-build",
  sourcePlan,
  activeTasks = [],
  timestamp = new Date().toISOString(),
  lastModelRun = "unknown",
  schemaRevision = 1,
} = {}) {
  if (!sourcePlan?.digest) throw new TypeError("sourcePlan digest is required");
  const schemaId = schemaRevision === 2 ? BUILD_SCHEMA_V2 : BUILD_SCHEMA;
  return {
    schema: schemaId,
    schemaRevision: schemaId === BUILD_SCHEMA_V2 ? 2 : 1,
    artifactId,
    runId,
    owner: "csm-build",
    status: "in_progress",
    control: {
      currentState: "RECOVER",
      cycle: 0,
      nextTransition: "RECOVER -> VALIDATE",
      activeTasks,
      blockers: [],
      lastCheckpoint: "",
      lastModelRun,
    },
    inputs: [],
    journal: [
      {
        sequence: 0,
        timestamp,
        from: "NOT_STARTED",
        to: "RECOVER",
        evidence: "build recovered",
        inputDigests: [],
      },
    ],
    artifacts: [],
    completion: null,
    provenance: {
      sourcePlan: sourcePlan.artifactId ?? sourcePlan.path,
      sourceDigests: [sourcePlan.digest],
    },
    projection: { sourceOnly: true, allowed: ["markdown", "html"] },
  };
}

export function transitionBuildState(
  value,
  to,
  { timestamp = new Date().toISOString(), evidence, inputDigests = [] } = {},
) {
  const check = validateBuildState(value);
  if (!check.valid)
    throw Object.assign(new TypeError("invalid build state"), {
      code: "schema-invalid",
      errors: check.errors,
    });
  const from = value.control.currentState;
  if (terminalFor(value).has(from))
    throw Object.assign(new Error("terminal build state is immutable"), {
      code: "terminal-immutable",
    });
  if (!transitions.get(from)?.includes(to))
    throw Object.assign(new Error(`invalid build transition ${from} -> ${to}`), {
      code: "invalid-transition",
    });
  const next = structuredClone(value);
  next.control.currentState = to;
  next.control.nextTransition =
    to === "COMPLETE" || to === "BLOCKED"
      ? "none (terminal)"
      : `${to} -> ${transitions.get(to)?.[0] ?? "VALIDATE"}`;
  if (to === "CHECKPOINT") next.control.lastCheckpoint = evidence ?? "checkpoint";
  if (to === "COMPLETE") next.status = "complete";
  if (to === "BLOCKED") next.status = "blocked";
  if (to === "PAUSED") next.status = "paused";
  next.journal.push({
    sequence: next.journal.length,
    timestamp,
    from,
    to,
    evidence: evidence ?? `${from} transitioned to ${to}`,
    inputDigests,
  });
  return next;
}

export function recoverBuildState(value, options = {}) {
  if (value?.control?.currentState !== "PAUSED")
    throw Object.assign(new Error("only paused builds can recover"), { code: "not-paused" });
  const paused = structuredClone(value);
  paused.status = "paused";
  paused.control.nextTransition = "PAUSED -> RECOVER";
  const recovered = transitionBuildState(paused, "RECOVER", {
    ...options,
    evidence: options.evidence ?? "recovered from checkpoint",
  });
  recovered.status = "in_progress";
  return recovered;
}

// Dual-revision close-out: only a /2 build state can be closed as superseded.
// The terminal `superseded` status plus the typed pointer make the replacement
// explicit and immutable, and the journal records the binding receipt.
export function supersedeBuildState(
  value,
  {
    supersededBy,
    reason,
    timestamp = new Date().toISOString(),
    evidence = "superseded by successor build state",
  } = {},
) {
  const check = validateBuildState(value);
  if (!check.valid)
    throw Object.assign(new TypeError("invalid build state"), {
      code: "schema-invalid",
      errors: check.errors,
    });
  if (value.schema !== BUILD_SCHEMA_V2)
    throw Object.assign(new Error("supersession requires a csm-build-state/2 record"), {
      code: "unknown-revision",
    });
  const from = value.control.currentState;
  if (terminalFor(value).has(from))
    throw Object.assign(new Error("terminal build state is immutable"), {
      code: "terminal-immutable",
    });
  if (!supersededBy || typeof supersededBy !== "object" || typeof reason !== "string" || !reason)
    throw Object.assign(new TypeError("supersession requires a supersededBy pointer and reason"), {
      code: "invalid-supersession",
    });
  const next = structuredClone(value);
  next.status = "superseded";
  next.control.currentState = "SUPERSEDED";
  next.control.nextTransition = "none (terminal)";
  next.supersession = structuredClone({
    supersededBy,
    supersededAt: timestamp,
    reason,
  });
  next.journal.push({
    sequence: next.journal.length,
    timestamp,
    from,
    to: "SUPERSEDED",
    evidence,
    inputDigests: [],
  });
  const result = validateBuildState(next);
  if (!result.valid)
    throw Object.assign(new TypeError("invalid superseded build state"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  return next;
}

export function createArtifactDescriptor({
  artifactId,
  kind,
  runId,
  owner = "csm-build",
  digest: valueDigest,
  path,
  contentType = "application/json",
  lifecycleStatus = "completed",
  sourceArtifactIds = [],
  rollbackArtifactId = null,
}) {
  const descriptor = {
    schema: "csm-build-artifact/1",
    artifactId,
    kind,
    runId,
    owner,
    digest: valueDigest,
    path,
    contentType,
    lifecycleStatus,
    sourceArtifactIds,
    rollbackArtifactId,
  };
  return { ...descriptor, descriptorDigest: digest(descriptor) };
}

export function completeBuild(
  value,
  {
    evidence = [],
    commit = { status: "not-requested", sha: null, message: "", files: [] },
    rollback = {
      status: "available",
      checkpoint: value.control.lastCheckpoint || null,
      action: "restore the last verified checkpoint",
    },
    verifiedAt = new Date().toISOString(),
    tasks = [],
    plan = null,
    evaluatorReceipt = null,
    requireEvaluator = value?.schema === BUILD_SCHEMA_V2,
  } = {},
) {
  // In-loop completion enforcement: the deterministic guard always vetoes a
  // COMPLETE while any work remains, and a /2 state additionally requires a
  // binding evaluator verdict receipt. `/1` stays byte-compatible (guard only).
  const pendingTasks = Array.isArray(tasks) ? tasks : Array.isArray(plan?.tasks) ? plan.tasks : [];
  const gate = assertCompletionGate({
    record: value,
    tasks: pendingTasks,
    evaluatorReceipt,
    requireEvaluator,
  });
  const next = transitionBuildState(value, "COMPLETE", { evidence: "completion verified" });
  const completionEvidence = [...evidence];
  if (
    gate.descriptor &&
    !completionEvidence.some(
      (descriptor) => descriptor?.descriptorDigest === gate.descriptor.descriptorDigest,
    )
  )
    completionEvidence.push(gate.descriptor);
  next.completion = {
    status: "complete",
    verifiedAt,
    evidence: completionEvidence,
    commit,
    rollback,
  };
  next.artifacts.push(...completionEvidence);
  const result = validateBuildState(next);
  if (!result.valid)
    throw Object.assign(new TypeError("invalid completed build state"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  return next;
}

async function validateInput(name, input, options) {
  if (typeof input === "string" && /\.(?:md|html?)$/i.test(input))
    return reject("json-only-input", `${name} input must be canonical JSON`);
  if (name === "bdd") return resolveBddInput(input, options);
  if (name === "tests")
    return resolveTestPackage(input, {
      ...options,
      expectedPlanDigest: options.expectedPlanDigest,
      replay: true,
    });
  let path = null;
  if (typeof input === "string") {
    const inputPath = input;
    if (isAbsolute(input) || input.split(/[\\/]/).some((part) => part === ".."))
      return reject("unsafe-path", `${name} input path is not contained`);
    const loaded = await resolveArtifactFile(inputPath, {
      root: options.root ?? process.cwd(),
      schemaRegistry: options.schemaRegistry ?? (await loadSchemaRegistry()),
      consumerRevision: 1,
      requireSourceDigest: name !== "plan",
    });
    if (loaded.status !== "resolved") return loaded;
    input = loaded.value;
    path = loaded.path;
  }
  const value = input?.value ?? input;
  if (!value || value.schema === "csm-projection/1")
    return reject(
      value?.schema === "csm-projection/1" ? "projection-input" : "missing-input",
      `${name} input is required`,
    );
  if (name === "plan") {
    const result = validatePlanArtifact(value);
    return result.valid
      ? { status: "resolved", value, digest: digest(value), path }
      : reject("schema-invalid", "plan input is invalid", { errors: result.errors });
  }
  const schemaId = value.schema ?? value.format;
  if (!["ddd", "norms"].includes(name) || typeof schemaId !== "string")
    return reject("untyped-input", `${name} input is not typed JSON`);
  const registry = options.schemaRegistry ?? (await loadSchemaRegistry());
  try {
    const result = registry.validate(schemaId, value);
    if (!result.valid)
      return reject("schema-invalid", `${name} input is invalid`, { errors: result.errors });
  } catch {
    return reject("unknown-revision", `${name} input schema revision is unknown`);
  }
  const owners = { ddd: "csm-ddd", norms: "csm-scan" };
  if (owners[name] && value.owner && value.owner !== owners[name])
    return reject("ownership-mismatch", `${name} input owner is invalid`);
  if (
    value.digest &&
    value.digest !==
      digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")))
  )
    return reject("digest-mismatch", `${name} input digest does not match content`);
  if (
    value.artifactDigest &&
    value.artifactDigest !==
      digest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "artifactDigest")))
  )
    return reject("digest-mismatch", `${name} artifact digest does not match content`);
  return { status: "resolved", value, digest: digest(value), path };
}

export async function resolveBuildInputs({ plan, bdd, tests, ddd, norms } = {}, options = {}) {
  // plan/bdd/tests are the required build inputs; ddd/norms are optional and
  // resolve only when the plan cites them (matching the SKILL). A present but
  // invalid optional input is still refused.
  const provided = { plan, bdd, tests, ddd, norms };
  const required = ["plan", "bdd", "tests"];
  const optional = ["ddd", "norms"];
  const results = {};
  for (const name of required) results[name] = await validateInput(name, provided[name], options);
  for (const name of optional) {
    const present = provided[name] !== undefined && provided[name] !== null;
    results[name] = present ? await validateInput(name, provided[name], options) : null;
  }
  const rejected = required.find((name) => results[name].status !== "resolved");
  if (rejected)
    return reject("input-validation-failed", `build input ${rejected} was refused`, {
      input: rejected,
      results,
    });
  const optionalRejected = optional.find(
    (name) => results[name] && results[name].status !== "resolved",
  );
  if (optionalRejected)
    return reject("input-validation-failed", `build input ${optionalRejected} was refused`, {
      input: optionalRejected,
      results,
    });
  const planValue = results.plan.value;
  const planDigest = digest(planValue);
  if (results.bdd.value.sourcePlan?.digest && results.bdd.value.sourcePlan.digest !== planDigest)
    return reject("lineage-mismatch", "BDD input is not from the selected plan");
  if (
    results.tests.value.sourcePlan?.planDigest &&
    results.tests.value.sourcePlan.planDigest !== planDigest
  )
    return reject("lineage-mismatch", "test input is not from the selected plan");
  const names = [...required, ...optional.filter((name) => results[name])];
  return {
    status: "resolved",
    inputs: names.map((name) => ({
      name,
      artifactId:
        results[name].value.artifactId ??
        results[name].value.packageId ??
        `${name}-${results[name].digest.slice(-12)}`,
      schema: results[name].value.schema ?? results[name].value.format,
      runId: results[name].value.runId ?? "unknown",
      owner: results[name].value.owner ?? `csm-${name}`,
      digest: results[name].digest,
      path: results[name].path ?? null,
      status: "resolved",
    })),
    values: results,
  };
}

export function dispatchBuild(value, resolvedInputs) {
  if (value.control.currentState !== "SELECT")
    return reject("dispatch-state", "build dispatch requires SELECT state");
  if (!resolvedInputs || resolvedInputs.status !== "resolved")
    return reject(
      "refusal-before-dispatch",
      "implementation dispatch is refused until inputs validate",
    );
  return transitionBuildState(value, "DISPATCH", {
    evidence: "validated inputs selected",
    inputDigests: resolvedInputs.inputs.map((input) => input.digest),
  });
}
