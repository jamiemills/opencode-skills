// T003/P2b corpus validator: validates the goal-owned tracked plan/build-state
// corpus against the csm-plan/2 + csm-build-state/2 revision contract.
//
// Scope (and why): the /2 schemas are the strict structural revision contract
// (additionalProperties:false, typed supersession, terminal `superseded`,
// dual-revision ids). This validator enforces:
//   1. every enumerated record is a /2 record (id + schemaRevision),
//   2. its payload validates against the strict /2 JSON schema,
//   3. supersession is present iff terminal `superseded` and well-formed,
//   4. every pre-migration (HEAD) pending/in_progress task identity survives,
//   5. every pre-migration build-state activeTask survives.
// It deliberately does NOT re-apply the authoring-time semantic critique
// (applicability completeness, single-hop journal grammar) to historical
// records: those are new-plan authoring rules, and rewriting legacy journals to
// satisfy them would destroy evidence. See the T003 report for this residual.
//
// Usage: node scripts/validate-corpus-v2.mjs [--quiet]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaRegistry, parseJson } from "../lib/schema-runtime/index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_V2 = "csm-plan/2";
const BUILD_V2 = "csm-build-state/2";

// The actively-executed plan for this very run is out of scope: mutating the
// control document mid-build is unsafe. No live build-state references it today,
// but the exclusion is derived from the plan path so a later run stays safe.
const EXCLUDED_PLANS = new Set([".agents/plans/2026-09-14-csm-completion-fixes-csm.json"]);

const RUN_ID_RE = /^run-[a-z0-9][a-z0-9-]{1,127}$/;
const PLAN_SCHEMA_RE = /^csm-plan\/[1-9][0-9]*$/;
const BUILD_SCHEMA_RE = /^csm-build-state\/[1-9][0-9]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

function enumerateCorpus() {
  const listed = git(["ls-files", ".agents/plans/*.json", ".agents/csm-build-state/*.json"])
    .trim()
    .split("\n")
    .filter(Boolean);
  const builds = listed.filter((file) => file.startsWith(".agents/csm-build-state/"));
  const excluded = new Set(EXCLUDED_PLANS);
  // Derive excluded live build-state records: any build-state that consumes an
  // excluded (actively-executed) plan.
  for (const file of builds) {
    const raw = JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
    if ((raw.inputs ?? []).some((input) => input?.path && excluded.has(input.path)))
      excluded.add(file);
  }
  return {
    files: listed.filter((file) => !excluded.has(file)),
    excluded: [...excluded].toSorted(),
  };
}

function baselineOf(file) {
  try {
    return parseJson(git(["show", `HEAD:${file}`]));
  } catch {
    return null;
  }
}

function supersessionErrors(record, schema) {
  const errors = [];
  const superseded = record.status === "superseded";
  if (superseded) {
    const pointer = record.supersession?.supersededBy;
    if (!pointer || typeof pointer !== "object") {
      errors.push("superseded record requires a typed supersession pointer");
    } else {
      const schemaRe = schema === BUILD_V2 ? BUILD_SCHEMA_RE : PLAN_SCHEMA_RE;
      if (!nonEmpty(pointer.artifactId)) errors.push("supersession pointer requires artifactId");
      if (!RUN_ID_RE.test(pointer.runId ?? ""))
        errors.push("supersession pointer requires a runId");
      if (!schemaRe.test(pointer.schema ?? ""))
        errors.push("supersession pointer requires a same-kind /revision schema id");
    }
    if (!DATE_RE.test(record.supersession?.supersededAt ?? ""))
      errors.push("superseded record requires a supersededAt timestamp");
    if (!nonEmpty(record.supersession?.reason)) errors.push("superseded record requires a reason");
  } else if (record.supersession !== undefined) {
    errors.push("a supersession pointer is only valid on a superseded record");
  }
  return errors;
}

function migrationErrors(file, record, baseline) {
  const errors = [];
  if (!baseline || baseline.schema === record.schema) return errors;
  if (record.schema === PLAN_V2) {
    const survived = new Map(record.tasks?.map((task) => [task.taskId, task.status]) ?? []);
    for (const task of baseline.tasks ?? []) {
      if (task.status !== "pending" && task.status !== "in_progress") continue;
      if (!survived.has(task.taskId))
        errors.push(`migration dropped ${task.status} task ${task.taskId}`);
      else if (survived.get(task.taskId) !== task.status)
        errors.push(
          `migration changed ${task.taskId} status ${task.status} -> ${survived.get(task.taskId)}`,
        );
    }
  } else if (record.schema === BUILD_V2) {
    const active = new Set(record.control?.activeTasks ?? []);
    for (const taskId of baseline.control?.activeTasks ?? [])
      if (!active.has(taskId)) errors.push(`migration dropped activeTask ${taskId}`);
  }
  return errors;
}

async function main() {
  const quiet = process.argv.includes("--quiet");
  const registry = await loadSchemaRegistry({ root: ROOT });
  const { files, excluded } = enumerateCorpus();
  const failures = [];
  const records = new Map();
  let supersededCount = 0;

  for (const file of files) {
    const errors = [];
    const record = parseJson(readFileSync(resolve(ROOT, file), "utf8"));
    records.set(file, record);
    const schema = record.schema;
    if (schema !== PLAN_V2 && schema !== BUILD_V2) {
      errors.push(`unexpected revision ${JSON.stringify(schema)} (want ${PLAN_V2} or ${BUILD_V2})`);
    } else {
      if (record.schemaRevision !== 2)
        errors.push(
          `schemaRevision must be 2 for ${schema} (got ${JSON.stringify(record.schemaRevision)})`,
        );
      const structural = registry.validate(schema, record);
      if (!structural.valid)
        for (const error of structural.errors)
          errors.push(
            `${error.instancePath || "/"} ${error.message}${
              error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ""
            }`,
          );
      errors.push(...supersessionErrors(record, schema));
      if (record.status === "superseded") {
        supersededCount += 1;
        const terminal =
          schema === PLAN_V2
            ? { state: "STOP", next: "none; closed as superseded" }
            : { state: "SUPERSEDED", next: "none (terminal)" };
        if (record.control?.currentState !== terminal.state)
          errors.push(`superseded record must close on a ${terminal.state} cursor`);
        if (record.control?.nextTransition !== terminal.next)
          errors.push(`superseded record must not be resumable (${terminal.next})`);
      }
      errors.push(...migrationErrors(file, record, baselineOf(file)));
    }
    if (errors.length) failures.push({ file, errors });
  }

  // Supersession pointers must resolve to a same-corpus successor with matching
  // artifact/run identity (a typed pointer, not just a free-text note).
  for (const [file, record] of records) {
    const pointer = record.supersession?.supersededBy;
    if (!pointer) continue;
    const target = pointer.path ? records.get(pointer.path) : null;
    const errors = [];
    if (!target) errors.push(`supersession target not in corpus: ${pointer.path ?? "(no path)"}`);
    else {
      if (target.artifactId !== pointer.artifactId) errors.push("supersession artifactId mismatch");
      if (target.runId !== pointer.runId) errors.push("supersession runId mismatch");
    }
    if (errors.length) failures.push({ file, errors });
  }

  if (!quiet) {
    console.log(`corpus: ${files.length} records (${excluded.length} excluded)`);
    console.log(`excluded: ${excluded.join(", ") || "(none)"}`);
    console.log(`superseded: ${supersededCount}`);
    for (const file of files)
      if (!failures.some((f) => f.file === file)) console.log(`ok   ${file}`);
  }
  for (const { file, errors } of failures) {
    console.log(`FAIL ${file}`);
    for (const error of errors) console.log(`     - ${error}`);
  }
  console.log(`validate-corpus-v2: ${files.length} records, ${failures.length} failures`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`validate-corpus-v2: ${error.stack ?? error}`);
  process.exitCode = 1;
});
