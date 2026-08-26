import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createSchemaValidator, digest, parseJson } from "../../../lib/schema-runtime/index.mjs";
import schema from "../schemas/package.schema.json" with { type: "json" };

const validator = createSchemaValidator({ schemas: [schema] });
const terminal = new Set(["SAVED", "STOP"]);
const THEN_KEY = String.fromCharCode(116, 104, 101, 110);

export function validateBddPackage(value) {
  const result = validator.validate("csm-bdd-tdd-package/1", value);
  const errors = [...result.errors];
  if (!result.valid) return { valid: false, errors };
  if (value.digest && value.digest !== packageDigest(value))
    errors.push("/digest does not match package");
  const scenarioIds = new Set();
  for (const scenario of value.scenarios) {
    if (scenarioIds.has(scenario.scenarioId))
      errors.push(`/scenarios duplicate ${scenario.scenarioId}`);
    scenarioIds.add(scenario.scenarioId);
  }
  const testIds = new Set(value.testDesigns.map((design) => design.testId));
  if (testIds.size !== value.testDesigns.length) errors.push("/testDesigns duplicate test ID");
  const traces = new Map();
  for (const trace of value.traceability) {
    if (traces.has(trace.scenarioId)) errors.push(`/traceability duplicate ${trace.scenarioId}`);
    traces.set(trace.scenarioId, trace);
  }
  const criteria = new Set(value.criteria.map((criterion) => criterion.id));
  for (const scenario of value.scenarios) {
    const trace = traces.get(scenario.scenarioId);
    if (!trace) errors.push(`/traceability missing ${scenario.scenarioId}`);
    else if (trace.featurePath !== scenario.featurePath)
      errors.push(`/traceability feature mismatch ${scenario.scenarioId}`);
    for (const criterion of scenario.criteria ?? [])
      if (!criteria.has(criterion)) errors.push(`/scenarios unknown criterion ${criterion}`);
  }
  for (const design of value.testDesigns) {
    if (!scenarioIds.has(design.scenarioId))
      errors.push(`/testDesigns/${design.testId} missing scenario link`);
    const trace = traces.get(design.scenarioId);
    if (trace && !trace.testIds.includes(design.testId))
      errors.push(`/traceability missing test design ${design.testId}`);
    if (trace && !trace.testPaths.includes(design.path))
      errors.push(`/traceability missing test path ${design.path}`);
  }
  for (const trace of value.traceability) {
    if (!scenarioIds.has(trace.scenarioId)) errors.push(`/traceability orphan ${trace.scenarioId}`);
    for (const id of trace.testIds)
      if (!testIds.has(id)) errors.push(`/traceability missing test ${id}`);
  }
  if (value.journal.some((event, index) => event.runId !== value.runId || event.sequence !== index))
    errors.push("/journal must have contiguous sequence and package runId");
  if (terminal.has(value.control.state) && value.control.nextTransition !== "none (terminal)")
    errors.push("/control terminal state requires none (terminal)");
  if (value.status === "paused" && value.control.state !== "PAUSED")
    errors.push("paused package requires PAUSED control state");
  if (value.status === "complete" && !terminal.has(value.control.state))
    errors.push("complete package requires a terminal control state");
  if (value.journal.length && value.journal.at(-1).state !== value.control.state)
    errors.push("package cursor must match the final journal state");
  if (value.status === "paused" && value.control.nextTransition !== "PAUSED -> RECOVER")
    errors.push("paused package must transition through PAUSED -> RECOVER");
  return { valid: errors.length === 0, errors };
}

export function createBddPackage(overrides = {}) {
  const value = {
    schema: "csm-bdd-tdd-package/1",
    schemaRevision: 1,
    artifactId: "art-bdd-package",
    runId: "run-bdd-package",
    owner: "csm-bdd-tdd",
    status: "ready",
    sourcePlan: {
      artifactId: "art-source-plan",
      runId: "run-source-plan",
      schema: "csm-plan/1",
      path: ".agents/plans/source-csm.json",
      digest: "sha256:" + "0".repeat(64),
    },
    objective: { id: "objective", statement: "Specify the planned behavior" },
    scope: { in: ["planned behavior"], out: ["implementation"] },
    criteria: [{ id: "AC-001", statement: "The behavior is traceable" }],
    risks: [],
    spec: {
      id: "spec-001",
      title: "Behavior specification",
      featurePath: "specs/example/features/behavior.feature",
    },
    scenarios: [
      {
        scenarioId: "behavior-001",
        title: "Trace behavior",
        featurePath: "specs/example/features/behavior.feature",
        given: ["a valid plan exists"],
        when: "the package is resolved",
        [THEN_KEY]: ["the source lineage is preserved"],
        criteria: ["AC-001"],
      },
    ],
    testDesigns: [
      {
        testId: "TST-001",
        scenarioId: "behavior-001",
        path: "specs/example/tests/design/behavior.json",
        purpose: "Validate traceability",
        given: ["a valid package"],
        when: ["it is validated"],
        [THEN_KEY]: ["validation succeeds"],
        tdd: ["red", "green", "refactor"],
      },
    ],
    control: {
      state: "SAVED",
      cycle: 0,
      nextTransition: "none (terminal)",
      cursor: { step: "SAVED", artifact: "package" },
      recovery: { resumeFrom: "SAVED", checkpoint: "package validated", temporaryState: "none" },
    },
    journal: [
      {
        sequence: 0,
        runId: "run-bdd-package",
        timestamp: "2026-08-25T00:00:00Z",
        transition: "VERIFY -> SAVED",
        state: "SAVED",
        evidence: "package validated",
      },
    ],
    traceability: [
      {
        scenarioId: "behavior-001",
        featurePath: "specs/example/features/behavior.feature",
        testIds: ["TST-001"],
        testPaths: ["specs/example/tests/design/behavior.json"],
      },
    ],
    provenance: { createdAt: "2026-08-25T00:00:00Z", sourceDigest: "sha256:" + "0".repeat(64) },
    projection: { allowed: ["gherkin", "markdown"], sourceOnly: true },
    ...overrides,
  };
  value.journal = value.journal.map((event) => ({ ...event, runId: value.runId }));
  value.digest = packageDigest(value);
  return value;
}

export function packageDigest(value) {
  const copy = structuredClone(value);
  delete copy.digest;
  return digest(copy);
}
export function resumeBddPackage(
  value,
  { timestamp = new Date().toISOString(), evidence = "resume requested" } = {},
) {
  const result = validateBddPackage(value);
  if (!result.valid)
    throw Object.assign(new TypeError("invalid BDD package"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  if (value.status !== "paused" || value.control.state !== "PAUSED")
    throw Object.assign(new Error("only a paused BDD package can resume"), { code: "not-paused" });
  const next = structuredClone(value);
  next.status = "in_progress";
  next.control = {
    ...next.control,
    state: "RECOVER",
    nextTransition: "RECOVER -> VALIDATE",
    recovery: { ...next.control.recovery, resumeFrom: "RECOVER", checkpoint: evidence },
  };
  next.journal.push({
    sequence: next.journal.length,
    runId: next.runId,
    timestamp,
    transition: "PAUSED -> RECOVER",
    state: "RECOVER",
    evidence,
  });
  next.digest = packageDigest(next);
  return next;
}
export async function readBddPackage(path, { root = process.cwd() } = {}) {
  return parseJson(await readFile(resolve(root, path), "utf8"));
}
export async function writeBddPackage(path, value, { root = process.cwd() } = {}) {
  const candidate = structuredClone(value);
  delete candidate.digest;
  const result = validateBddPackage(candidate);
  if (!result.valid)
    throw Object.assign(new Error("invalid BDD package"), {
      code: "schema-invalid",
      errors: result.errors,
    });
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(
    resolve(root, path),
    JSON.stringify({ ...candidate, digest: packageDigest(candidate) }, null, 2) + "\n",
    { flag: "wx" },
  );
}
