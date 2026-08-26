import {
  createSchemaValidator,
  digest,
  loadSchemaRegistry,
} from "../../lib/schema-runtime/index.mjs";
import schema from "../schemas/state.schema.json" with { type: "json" };
import { resolveBddInput } from "./bdd-input-resolver.mjs";
import { resolveTestPackage } from "./test-package.mjs";
import { resolveArtifactFile } from "../../lib/artifact-resolver/index.mjs";
import { validatePlanArtifact } from "../../csm-plan/lib/plan.mjs";
import { isAbsolute } from "node:path";

export const BUILD_SCHEMA = "csm-build-state/1";
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
]);
const terminal = new Set(["COMPLETE", "BLOCKED"]);
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
const validator = createSchemaValidator({ schemas: [schema] });
const reject = (code, message, extra = {}) =>
  Object.freeze({ status: "rejected", code, message, ...extra });

export function validateBuildState(value) {
  const result = validator.validate(BUILD_SCHEMA, value);
  const errors = [...result.errors];
  if (value?.control && value.status === "complete" && value.control.currentState !== "COMPLETE")
    errors.push({ message: "complete state must be terminal" });
  if (value?.control?.currentState === "PAUSED" && value.status !== "paused")
    errors.push({ message: "paused state must have paused status" });
  if (value?.status === "paused" && value.control?.currentState !== "PAUSED")
    errors.push({ message: "paused status must have paused state" });
  if (value?.status === "paused" && value.control?.nextTransition !== "PAUSED -> RECOVER")
    errors.push({ message: "paused state must recover through PAUSED -> RECOVER" });
  const current = value?.control?.currentState;
  const expectedTransition = terminal.has(current)
    ? "none (terminal)"
    : `${current} -> ${transitions.get(current)?.[0] ?? "VALIDATE"}`;
  if (value?.control?.nextTransition !== expectedTransition)
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
} = {}) {
  if (!sourcePlan?.digest) throw new TypeError("sourcePlan digest is required");
  return {
    schema: BUILD_SCHEMA,
    schemaRevision: 1,
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
  if (terminal.has(from))
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
  } = {},
) {
  const next = transitionBuildState(value, "COMPLETE", { evidence: "completion verified" });
  next.completion = { status: "complete", verifiedAt, evidence, commit, rollback };
  next.artifacts.push(...evidence);
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
  const names = ["plan", "bdd", "tests", "ddd", "norms"];
  const results = {};
  for (const name of names)
    results[name] = await validateInput(name, { plan, bdd, tests, ddd, norms }[name], options);
  const rejected = names.find((name) => results[name].status !== "resolved");
  if (rejected)
    return reject("input-validation-failed", `build input ${rejected} was refused`, {
      input: rejected,
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
