// T226 — five-ecosystem and generic expansion fixtures on the production
// pipeline.
//
// Owned by T226. Drives NEW topic-focused fixtures (test/fixtures-expansion/)
// and inline fixture maps exclusively through the EXPORTED production pipeline
// `runExpandedPipeline` — never a reconstructed dispatch. It proves:
//   - The five built-in ecosystems preserve their established facts (language,
//     ecosystem, stack, 17 dimensions, coverage) through the production
//     pipeline, and the generic fallback does NOT fire for them.
//   - The unknown-language fixture receives generic artifact-only evidence.
//   - Every applicable new dimension has positive AND negative cases.
//   - Statuses behave per the T202 contract (observed / not_detected /
//     unsupported / unverified / not_applicable with correct search-space
//     evidence).
//   - Privacy hazards (emails, tokens, absolute-path-bearing credentials, URL
//     credentials) are sanitized or downgraded and never reach findings or
//     NORMS.md.
//   - Dynamic constructs (dynamic imports, reflection, templates) surface as
//     disclosed unverified/unsupported diagnostics, never invented facts.
//   - Architecture facts (import edges) and cross-repository relationships
//     (exact references) behave per contract.
//   - Determinism: fixed clock produces byte-identical repeated runs.
//
// Scope (own-only): test/fixtures-expansion/*.mjs and this test file. No
// production, baseline, contract, or locked fixture is edited.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { makeFixture, cleanupFixture } from "./harness.mjs";
import { runExpandedPipeline } from "../lib/scan/pipeline/run.mjs";
import { renderNORMS } from "../lib/scan/write.mjs";
import { synthesizeCrossRepository } from "../lib/scan/cross-repo/edges.mjs";
import { CLAIM_STATUSES } from "../lib/scan/contracts/dimension.mjs";
import { DIMENSION_REGISTRY } from "../lib/scan/registry/dimensions.mjs";

import { files as pythonFiles } from "./fixtures-expansion/python.mjs";
import { files as javascriptFiles } from "./fixtures-expansion/javascript.mjs";
import { files as typescriptFiles } from "./fixtures-expansion/typescript.mjs";
import { files as shellFiles } from "./fixtures-expansion/shell.mjs";
import { files as rustFiles } from "./fixtures-expansion/rust.mjs";
import { files as unknownFiles } from "./fixtures-expansion/unknown.mjs";
import { files as practicesFiles } from "./fixtures-expansion/practices.mjs";
import { repoA, repoB, repoASingle, repoBSingle } from "./fixtures-expansion/cross-repo.mjs";

const SIX_NEW_DIMENSIONS = [
  "api",
  "data",
  "deployment",
  "maintainability",
  "governance",
  "assurance",
  "practices",
];

const SIX_NEW_HEADINGS = [
  "## API Surface",
  "## Data Architecture",
  "## Deployment Topology",
  "## Maintainability",
  "## Governance & Ownership",
  "## Assurance & Supply Chain",
  "## Development Practices",
];

const REGISTRY_CLAIMS = DIMENSION_REGISTRY.reduce(
  (sum, dimension) => sum + dimension.expectedClaimIds.length,
  0,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFixture(name, files, options = {}) {
  const repoPath = makeFixture(name, files);
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t226-out-"));
  const result = await runExpandedPipeline({
    repos: [repoPath],
    out: join(outDir, "NORMS.md"),
    clock: () => "2026-08-03",
    ...options,
  });
  return { result, repoPath, outDir };
}

async function runRepos(name, repoFiles, options = {}) {
  const paths = repoFiles.map((files, index) => makeFixture(`${name}-${index}`, files));
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t226-out-"));
  const result = await runExpandedPipeline({
    repos: paths,
    out: join(outDir, "NORMS.md"),
    clock: () => "2026-08-03",
    ...options,
  });
  return { result, paths, outDir };
}

async function cleanupRun({ repoPath, paths = null, outDir }) {
  if (paths !== null) for (const p of paths) cleanupFixture(p);
  else if (repoPath) cleanupFixture(repoPath);
  await rm(outDir, { recursive: true, force: true });
}

function perDimension(result) {
  return result.expectedClaimCoverage.repos[0].perDimension;
}

function newDimensionStatus(result) {
  const per = perDimension(result);
  return Object.fromEntries(
    SIX_NEW_DIMENSIONS.map((dimension) => [dimension, per[dimension].status]),
  );
}

function findingsFor(result, dimension) {
  return result.repos[0].deep.find((entry) => entry.dimension === dimension)?.findings;
}

function serializedDeep(result) {
  return JSON.stringify(result.repos[0].deep);
}

// ---------------------------------------------------------------------------
// Topic fixtures and the six new dimensions
// ---------------------------------------------------------------------------

const FIXTURES = Object.freeze([
  { name: "python", files: pythonFiles },
  { name: "javascript", files: javascriptFiles },
  { name: "typescript", files: typescriptFiles },
  { name: "shell", files: shellFiles },
  { name: "rust", files: rustFiles },
  { name: "unknown", files: unknownFiles },
  { name: "practices", files: practicesFiles },
]);

// Expected per-dimension coverage status per fixture (T202 contract mapping).
const EXPECTED_STATUS = Object.freeze({
  python: {
    api: "observed",
    data: "observed",
    deployment: "observed",
    maintainability: "observed",
    governance: "observed",
    assurance: "observed",
    practices: "observed",
  },
  javascript: {
    api: "observed",
    data: "observed",
    deployment: "observed",
    maintainability: "observed",
    governance: "not_detected",
    assurance: "observed",
    practices: "not_detected",
  },
  typescript: {
    api: "observed",
    data: "observed",
    deployment: "observed",
    maintainability: "observed",
    governance: "not_detected",
    assurance: "observed",
    practices: "not_detected",
  },
  shell: {
    api: "not_detected",
    data: "not_detected",
    deployment: "observed",
    maintainability: "observed",
    governance: "not_detected",
    assurance: "not_detected",
    practices: "observed",
  },
  rust: {
    api: "observed",
    data: "observed",
    deployment: "observed",
    maintainability: "observed",
    governance: "observed",
    assurance: "observed",
    practices: "not_detected",
  },
  unknown: {
    api: "not_detected",
    data: "not_detected",
    deployment: "not_detected",
    maintainability: "not_detected",
    governance: "not_detected",
    assurance: "observed",
    practices: "not_detected",
  },
  practices: {
    api: "observed",
    data: "not_detected",
    deployment: "not_detected",
    maintainability: "observed",
    governance: "observed",
    assurance: "observed",
    practices: "observed",
  },
});

test("T226 five built-ins preserve their established facts through the production pipeline", async (t) => {
  const expectations = Object.freeze({
    python: { language: "Python", ecosystem: "python", stackLanguage: "Python" },
    javascript: { language: "JavaScript", ecosystem: "javascript", stackLanguage: "JavaScript" },
    typescript: { language: "TypeScript", ecosystem: "typescript", stackLanguage: "TypeScript" },
    rust: { language: "Rust", ecosystem: "rust", stackLanguage: "Rust" },
    shell: { language: "Shell", ecosystem: "shell", stackLanguage: "Shell" },
  });
  for (const { name, files } of FIXTURES.slice(0, 5)) {
    const run = await runFixture(`t226-facts-${name}`, files);
    t.after(() => cleanupRun(run));
    const expected = expectations[name];
    const overview = run.result.repos[0].overview;
    assert.ok(
      overview.languages.includes(expected.language),
      `${name}: detected language must include ${expected.language}`,
    );
    assert.equal(
      overview.ecosystems.primary,
      expected.ecosystem,
      `${name}: primary ecosystem must be ${expected.ecosystem}`,
    );
    const stack = findingsFor(run.result, "stack");
    assert.equal(
      stack.language,
      expected.stackLanguage,
      `${name}: stack language must be ${expected.stackLanguage}`,
    );
    assert.equal(run.result.repos[0].deep.length, 17, `${name}: all 17 dimensions must scan`);
    for (const heading of SIX_NEW_HEADINGS) {
      assert.ok(run.result.markdown.includes(heading), `${name}: ${heading} must render`);
    }
    assert.equal(
      run.result.expectedClaimCoverage.expected,
      REGISTRY_CLAIMS,
      `${name}: coverage accounts every registry claim`,
    );
    assert.equal(
      run.result.markdown.includes("PRV-generic-artifacts-v1"),
      false,
      `${name}: the generic fallback must NOT fire for a built-in ecosystem`,
    );
  }
});

test("T226 every applicable new dimension has positive and negative cases across the matrix", async (t) => {
  const observed = new Set();
  const notDetected = new Set();
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-matrix-${name}`, files);
    t.after(() => cleanupRun(run));
    const statuses = newDimensionStatus(run.result);
    assert.deepEqual(
      statuses,
      EXPECTED_STATUS[name],
      `${name}: per-dimension status matrix must match the contract`,
    );
    for (const dimension of SIX_NEW_DIMENSIONS) {
      if (statuses[dimension] === "observed") observed.add(dimension);
      if (statuses[dimension] === "not_detected") notDetected.add(dimension);
    }
  }
  for (const dimension of SIX_NEW_DIMENSIONS) {
    assert.ok(observed.has(dimension), `${dimension}: must have a positive (observed) case`);
    assert.ok(notDetected.has(dimension), `${dimension}: must have a negative (not_detected) case`);
  }
});

test("T226 python fixture: API/data/deployment/governance/assurance facts, dynamic diagnostic, architecture edge", async (t) => {
  const run = await runFixture("t226-py", pythonFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, "api");
  assert.deepEqual(api.operations.map(({ signature }) => signature).toSorted(), [
    "GET:/api/items",
    "GET:/api/items/{item_id}",
    "GET:/api/v1",
    "POST:/api/items",
    "cli:click:deploy",
  ]);
  assert.ok(
    api.diagnostics.some(({ status, reason }) => status === "unverified" && reason === "DYNAMIC"),
    "dynamic route variable must be disclosed as an unverified DYNAMIC diagnostic",
  );

  const data = findingsFor(result, "data");
  assert.deepEqual(data.entities.map(({ signature }) => signature).toSorted(), [
    "players",
    "teams",
    "users",
  ]);
  assert.deepEqual(
    data.relations.map(({ signature }) => signature),
    ["users:teams:foreign_key"],
  );
  assert.deepEqual(
    data.migrations.map(({ signature }) => signature),
    ["0001_init.py"],
  );
  assert.ok(
    data.edges.some(
      (edge) =>
        edge.from === "entity@users" && edge.to === "entity@teams" && edge.kind === "foreign_key",
    ),
    "SQLAlchemy ForeignKey must produce a declaration-backed ER edge",
  );
  assert.ok(
    data.diagnostics.some(
      ({ status, reason }) => status === "unverified" && reason === "NAME_ONLY",
    ),
    "relationship without an FK must be disclosed as NAME_ONLY, never a fabricated edge",
  );

  const deployment = findingsFor(result, "deployment");
  assert.deepEqual(deployment.services.map(({ id }) => id).toSorted(), [
    "service@api",
    "service@db",
  ]);
  assert.deepEqual(deployment.images.map(({ reference }) => reference).toSorted(), [
    "postgres:16",
    "python:3.12",
  ]);

  const governance = findingsFor(result, "governance");
  assert.equal(governance.summary.entries, 3);
  assert.equal(
    governance.summary.byCategory.ownership,
    1,
    "CODEOWNERS contributes ownership evidence",
  );
  assert.equal(governance.summary.byCategory.decision, 1, "ADR contributes a decision record");
  assert.equal(
    governance.summary.byCategory.contribution,
    1,
    "CONTRIBUTING contributes contribution evidence",
  );

  const assurance = findingsFor(result, "assurance");
  assert.equal(
    assurance.manifest.length,
    2,
    "pyproject.toml and requirements.txt are assurance manifests",
  );

  const maintainability = findingsFor(result, "maintainability");
  assert.ok(maintainability.summary.filesMeasured >= 8, "python source files are measured");

  const architecture = findingsFor(result, "architecture");
  assert.deepEqual(
    architecture.importGraph.graph["src/api/app.py"],
    ["src/models.py", "src/cli.py"],
    "python absolute imports resolve to real internal edges",
  );

  // CONTRIBUTING.md is a static style_guide practice artifact (T002).
  assert.equal(
    newDimensionStatus(result).practices,
    "observed",
    "the python fixture carries CONTRIBUTING.md, so practices is observed",
  );
  const contributing = findingsFor(result, "practices").entries.find(
    (entry) => entry.matchedKey === "style_guide:contributing:CONTRIBUTING.md",
  );
  assert.ok(
    contributing,
    "CONTRIBUTING.md must classify as a static style_guide:contributing kind",
  );
});

test("T226 javascript fixture: route/event API, prisma ER edge, k8s deployment, dynamic import", async (t) => {
  const run = await runFixture("t226-js", javascriptFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, "api");
  assert.ok(api.operations.some(({ signature }) => signature === "GET:/api/users"));
  assert.ok(api.operations.some(({ signature }) => signature === "POST:/api/users"));
  assert.ok(
    api.operations.some(({ signature }) => signature === "event:emit:user.created"),
    "emitter.emit must produce an event operation",
  );
  assert.ok(
    api.diagnostics.some(({ status, reason }) => status === "unverified" && reason === "DYNAMIC"),
  );

  const data = findingsFor(result, "data");
  assert.deepEqual(data.entities.map(({ signature }) => signature).toSorted(), ["Post", "User"]);
  assert.deepEqual(
    data.relations.map(({ signature }) => signature),
    ["Post:User:foreign_key"],
  );
  assert.ok(data.edges.some((edge) => edge.from === "entity@Post" && edge.to === "entity@User"));

  const deployment = findingsFor(result, "deployment");
  assert.deepEqual(
    deployment.resources.map(({ id }) => id),
    ["deployment@api"],
  );
  assert.deepEqual(
    deployment.services.map(({ id }) => id),
    ["container@api:api"],
  );

  const architecture = findingsFor(result, "architecture");
  assert.deepEqual([...architecture.importGraph.graph["src/app.js"]].toSorted(), [
    "src/dynamic.js",
    "src/secret.js",
  ]);

  const assurance = findingsFor(result, "assurance");
  assert.equal(assurance.manifest.length, 1);
  assert.equal(assurance.lock.length, 1);
});

test("T226 typescript fixture: NestJS route, reflection/dynamic constructs, prisma relation, terraform resources", async (t) => {
  const run = await runFixture("t226-ts", typescriptFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, "api");
  assert.deepEqual(
    api.operations.map(({ signature }) => signature),
    ["GET:/api/health"],
  );

  const data = findingsFor(result, "data");
  assert.deepEqual(data.entities.map(({ signature }) => signature).toSorted(), [
    "Account",
    "Owner",
  ]);
  assert.deepEqual(
    data.relations.map(({ signature }) => signature),
    ["Account:Owner:foreign_key"],
  );

  const deployment = findingsFor(result, "deployment");
  assert.deepEqual(deployment.resources.map(({ id }) => id).toSorted(), [
    "bucket@assets",
    "database@primary",
  ]);

  const architecture = findingsFor(result, "architecture");
  assert.deepEqual(architecture.importGraph.graph["src/app.controller.ts"], ["src/app.service.ts"]);

  const maintainability = findingsFor(result, "maintainability");
  assert.ok(maintainability.summary.filesMeasured >= 3);
});

test("T226 rust fixture: axum/clap/pub API, diesel schema + migration, docker image, ADR, architecture edge", async (t) => {
  const run = await runFixture("t226-rs", rustFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const api = findingsFor(result, "api");
  assert.ok(api.operations.some(({ signature }) => signature === "GET:/api/users"));
  assert.ok(api.operations.some(({ signature }) => signature === "GET:/api/health"));
  assert.ok(api.operations.some(({ signature }) => signature === "cli:clap:t226"));
  assert.ok(api.operations.some(({ signature }) => signature === "cli:clap:subcommand:Build"));

  const data = findingsFor(result, "data");
  assert.deepEqual(data.entities.map(({ signature }) => signature).toSorted(), ["teams", "users"]);
  assert.deepEqual(
    data.migrations.map(({ signature }) => signature),
    ["up.sql"],
  );
  assert.ok(
    data.fields.length >= 4 && data.keys.length >= 2,
    "diesel schema + SQL migration produce fields and keys",
  );

  const deployment = findingsFor(result, "deployment");
  assert.deepEqual(
    deployment.images.map(({ reference }) => reference),
    ["rust:1.75"],
  );

  const governance = findingsFor(result, "governance");
  assert.equal(governance.summary.byCategory.decision, 1);

  const architecture = findingsFor(result, "architecture");
  assert.deepEqual(architecture.importGraph.graph["src/main.rs"], ["src/routes.rs"]);
});

test("T226 shell fixture: built-in negative new dimensions with complete search, positive deployment/maintainability", async (t) => {
  const run = await runFixture("t226-sh", shellFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const overview = result.repos[0].overview;
  assert.ok(overview.languages.includes("Shell"), "Shell must be detected as a built-in");
  assert.equal(overview.ecosystems.primary, "shell");
  assert.equal(
    result.markdown.includes("PRV-generic-artifacts-v1"),
    false,
    "a built-in shell fixture never uses the generic fallback",
  );

  for (const dimension of ["api", "data", "governance", "assurance"]) {
    const findings = findingsFor(result, dimension);
    assert.equal(
      findings.searchSpace.complete,
      true,
      `${dimension}: complete search space is required for a factual absence`,
    );
    assert.equal(
      newDimensionStatus(result)[dimension],
      "not_detected",
      `${dimension}: no evidence after a complete search`,
    );
  }
  assert.equal(newDimensionStatus(result).deployment, "observed");
  assert.equal(newDimensionStatus(result).maintainability, "observed");
  assert.equal(
    newDimensionStatus(result).practices,
    "observed",
    "the Makefile makes practices observed",
  );
  const practices = findingsFor(result, "practices");
  assert.equal(
    practices.searchSpace.complete,
    true,
    "practices observation rests on a complete search",
  );
  assert.ok(
    practices.entries.some((entry) => entry.matchedKey === "automation:makefile:Makefile"),
    "the static Makefile kind must be observed",
  );
  assert.ok(
    practices.entries.some((entry) => entry.matchedKey === "automation:make-targets:Makefile"),
    "make targets content must be observed",
  );
  assert.deepEqual(
    findingsFor(result, "deployment").resources.map(({ id }) => id),
    ["namespace@t226-sh"],
  );
  assert.ok(findingsFor(result, "maintainability").summary.filesMeasured >= 3);

  const architecture = findingsFor(result, "architecture");
  assert.deepEqual(architecture.importGraph.graph["scripts/build.sh"], ["scripts/lib.sh"]);
});

// ---------------------------------------------------------------------------
// Practices fixture: all seven categories, hidden dirs, and craft source facts
// ---------------------------------------------------------------------------

test("T226 practices fixture: all seven categories, hidden artifacts, style values, and privacy-safe gates", async (t) => {
  const run = await runFixture("t226-practices", practicesFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const practices = findingsFor(result, "practices");
  assert.equal(newDimensionStatus(result).practices, "observed");
  assert.equal(practices.searchSpace.complete, true);
  assert.equal(practices.diagnostics.length, 0);

  // Every one of the seven practices categories is observed in the positive fixture.
  const byCategory = practices.summary.byCategory;
  for (const category of Object.keys(byCategory)) {
    assert.ok(byCategory[category] > 0, `practices fixture must produce ${category} evidence`);
  }

  // Hidden-directory artifacts that `rg --files` prunes are probed explicitly.
  const paths = practices.entries.map(({ path }) => path);
  for (const expected of [
    ".agents/plans/feature-csm.md",
    ".agents/docs/guide.md",
    ".opencode/config.json",
    "AGENTS.md",
    "CLAUDE.md",
    "opencode.jsonc",
    ".devcontainer/devcontainer.json",
    ".github/workflows/ci.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug.md",
    ".github/release-drafter.yml",
    "quality/gates.conf",
    "quality/remediation/notes.md",
  ]) {
    assert.ok(paths.includes(expected), `hidden practice artifact ${expected} must be probed`);
  }

  // Methodology signals: BDD feature, mutation config, hypothesis dependency.
  assert.ok(
    paths.includes("features/login.feature"),
    "a .feature file must be inventoried as methodology",
  );
  assert.ok(
    practices.entries.some(
      (entry) => entry.matchedKey === "methodology:mutation-config:pyproject.toml",
    ),
    "the [tool.mutmut] section must be detected",
  );
  const deps = practices.entries.find(
    (entry) => entry.matchedKey === "methodology:test-deps:pyproject.toml",
  );
  assert.ok(
    deps && deps.kinds.includes("hypothesis"),
    "the hypothesis dependency must be detected",
  );

  // New style.fact kinds: lefthook stages and declared-conventions headings.
  const hookStages = practices.entries.find(
    (entry) => entry.matchedKey === "enforcement:hook-stages:lefthook.yml",
  );
  assert.ok(
    hookStages && hookStages.kinds.includes("pre-commit"),
    "lefthook hook stages must be extracted from the fixture",
  );
  const declaredConventions = practices.entries.find(
    (entry) => entry.matchedKey === "style_guide:declared-conventions:AGENTS.md",
  );
  assert.ok(
    declaredConventions && declaredConventions.kinds.includes("agents"),
    "AGENTS.md headings must become declared-conventions kinds",
  );

  // Quality gates: allowlisted keys render as bounded per-key values (ints in
  // count, grades as slug kinds); the aggregated gate-thresholds entry is
  // replaced by the per-key gate-value structure.
  const gateValues = practices.entries.filter((entry) =>
    entry.matchedKey.startsWith("quality_gate:gate-value:"),
  );
  assert.ok(gateValues.length >= 4, "quality/gates.conf per-key threshold entries must be present");
  assert.equal(
    practices.entries.some(
      (entry) => entry.matchedKey === "quality_gate:gate-thresholds:quality/gates.conf",
    ),
    false,
    "the aggregated gate-thresholds entry is replaced by per-key entries",
  );
  const minCoverage = practices.entries.find(
    (entry) => entry.matchedKey === "quality_gate:gate-value:mincoverage:quality/gates.conf",
  );
  assert.ok(minCoverage, "the MIN_COVERAGE per-key entry must be present");
  assert.equal(minCoverage.count, 85, "MIN_COVERAGE=85 renders as a bounded count");
  const radonGrade = practices.entries.find(
    (entry) => entry.matchedKey === "quality_gate:gate-value:radonccgrade:quality/gates.conf",
  );
  assert.ok(radonGrade, "the RADON_CC_GRADE per-key entry must be present");
  assert.deepEqual(radonGrade.kinds, ["B"], "RADON_CC_GRADE=B renders as a slug kind");

  // Style guide: line-length values from ruff/black/prettier/rustfmt configs.
  const styles = practices.entries.find(
    (entry) => entry.matchedKey === "style_guide:style-values:pyproject.toml",
  );
  assert.ok(
    styles && styles.kinds.includes("line-length"),
    "ruff line-length value must be detected",
  );
  assert.ok(
    practices.entries.some(
      (entry) => entry.matchedKey === "style_guide:principles-doc:docs/principles.md",
    ),
    "a zen/principle document must be detected",
  );

  // Agent workflow: the plan document declares Control/Status headers.
  const planState = practices.entries.find(
    (entry) => entry.matchedKey === "agent_workflow:plan-state:.agents/plans/feature-csm.md",
  );
  assert.ok(
    planState && planState.kinds.includes("control") && planState.kinds.includes("status"),
    "plan Control/Status headers must be retained as kinds",
  );

  // Release-drafter + changelog coupling is an inferred ritual fact.
  assert.ok(
    practices.entries.some((entry) => entry.matchedKey === "ritual:release-notes:CHANGELOG.md"),
    "the release-drafter + changelog coupling must be inferred",
  );
});

// ---------------------------------------------------------------------------
// Craft claims: dead-code, coupling, and design-pattern observed + not_detected
// ---------------------------------------------------------------------------

test("T226 craft claims: dead_code/coupling/design_pattern have observed and not_detected cases", async (t) => {
  const positive = await runFixture("t226-craft-positive", practicesFiles);
  t.after(() => cleanupRun(positive));
  const { result } = positive;

  // dead_code observed: the practices fixture carries unused-code markers
  // (vulture config/whitelist, a no-unused-vars suppression, an allow(dead_code)
  // attribute) in the maintainability findings.
  const maintainability = findingsFor(result, "maintainability");
  assert.ok(
    maintainability.deadCode.length > 0,
    "dead_code claim must be observed on the practices fixture",
  );
  const kinds = new Set(maintainability.deadCode.map(({ kind }) => kind));
  for (const expected of [
    "allow_dead_code",
    "unused_import",
    "vulture_config",
    "vulture_whitelist",
  ]) {
    assert.ok(kinds.has(expected), `dead-code kind ${expected} must be observed`);
  }

  // coupling/design_pattern observed: the provider-derived aggregates build on
  // the raw import graph, so the fixture must carry real internal edges.
  const architecture = findingsFor(result, "architecture");
  const graph = architecture.importGraph.graph;
  assert.ok(
    Object.keys(graph).length > 0,
    "coupling source data (import graph) must exist on the practices fixture",
  );
  assert.deepEqual(
    graph["src/app.js"],
    ["src/lib.js"],
    "an internal import edge feeds the coupling aggregates",
  );

  const negative = await runFixture("t226-craft-negative", shellFiles);
  t.after(() => cleanupRun(negative));
  const { result: negativeResult } = negative;

  // dead_code not_detected: the shell fixture has no unused-code markers.
  assert.equal(
    findingsFor(negativeResult, "maintainability").deadCode.length,
    0,
    "dead_code claim must be absent on the shell fixture",
  );

  // coupling/design_pattern not_detected: the unknown fixture has no internal
  // import edges, so no aggregate can be derived.
  const unknown = await runFixture("t226-craft-unknown", unknownFiles);
  t.after(() => cleanupRun(unknown));
  const { result: unknownResult } = unknown;
  const unknownGraph = findingsFor(unknownResult, "architecture").importGraph.graph;
  assert.equal(
    Object.keys(unknownGraph).length,
    0,
    "coupling/design_pattern source data must be absent on the unknown fixture",
  );
});

// ---------------------------------------------------------------------------
// Design boundary: no dimension re-asserts facts owned by another
// ---------------------------------------------------------------------------

test("T226 boundary: practices never re-asserts facts owned by git, config, or conventions", async (t) => {
  const run = await runFixture("t226-boundary", practicesFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;
  const practices = findingsFor(result, "practices");
  const entries = practices.entries;

  // git owns commit-style classification (branch naming, template presence,
  // commit-style vocabulary). Practices enforcement entries record declaration
  // and hook-command presence only and must never re-assert the classification.
  for (const entry of entries) {
    assert.ok(
      !/^git:|commit-style|commit_style/i.test(entry.matchedKey),
      `practices entry ${entry.matchedKey} re-asserts the git commit-style fact`,
    );
  }
  assert.equal(
    JSON.stringify(entries).includes("commitStyle"),
    false,
    "practices must not carry the git commitStyle field",
  );

  // config owns lint/format/type tool presence; practices style_guide owns
  // style VALUES (line-length, indent, quotes). For the same repository the
  // config tool names and the practices style-guide facts must be disjoint.
  const config = findingsFor(result, "config");
  const configToolNames = new Set([
    ...(config.linters ?? []).map((tool) => tool.name),
    ...(config.formatters ?? []).map((tool) => tool.name),
    ...(config.typeCheckers ?? []).map((tool) => tool.name),
  ]);
  assert.ok(
    configToolNames.has("ruff") && configToolNames.has("prettier"),
    "config must report lint/format tool presence",
  );
  const styleGuide = entries.filter((entry) => entry.category === "style_guide");
  assert.ok(styleGuide.length > 0, "the practices fixture must produce style_guide entries");
  for (const entry of styleGuide) {
    for (const kind of entry.kinds ?? []) {
      assert.ok(
        !configToolNames.has(kind),
        `style_guide kind ${kind} duplicates a config tool-presence fact`,
      );
    }
  }
  const styleValues = styleGuide.filter((entry) => entry.matchedKey.includes(":style-values:"));
  assert.ok(
    styleValues.length >= 3,
    "style values are extracted from ruff/black/prettier/rustfmt configs",
  );
  for (const entry of styleValues) {
    assert.ok(
      entry.kinds.length > 0,
      `style_values entry ${entry.matchedKey} carries concrete style values`,
    );
  }
  assert.equal(
    JSON.stringify(config).match(/line-length|line_length|printWidth/),
    null,
    "config must not re-assert practices style values",
  );

  // conventions owns standards presence (PEP 8 and per-language equivalents);
  // practices style_guide owns principle documents. The vocabularies are disjoint.
  const conventions = findingsFor(result, "conventions");
  assert.ok(
    (conventions.languageStandards?.standards ?? []).includes("PEP 8 (style guide)"),
    "conventions must own standards presence",
  );
  for (const entry of styleGuide) {
    assert.ok(
      !/standard|pep[ -]?8/i.test(entry.matchedKey),
      `style_guide entry ${entry.matchedKey} re-asserts a conventions standards fact`,
    );
  }
});

test("T226 boundary: automation make-targets carry content, operations owns Makefile presence", async (t) => {
  // The shell fixture carries a Makefile: operations records the presence
  // boolean while practices records target content. The two vocabularies must
  // never merge.
  const run = await runFixture("t226-boundary-makefile", shellFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;
  const operations = findingsFor(result, "operations");
  assert.equal(operations.hasMakefile, true, "operations owns Makefile presence");
  assert.equal(
    JSON.stringify(operations).includes("make-targets"),
    false,
    "operations must not re-assert make-target content",
  );

  const practices = findingsFor(result, "practices");
  const automation = practices.entries.filter((entry) => entry.category === "automation");
  assert.ok(
    automation.some((entry) => entry.matchedKey === "automation:makefile:Makefile"),
    "practices records the static Makefile kind",
  );
  const targets = automation.find(
    (entry) => entry.matchedKey === "automation:make-targets:Makefile",
  );
  assert.ok(targets, "practices records make-target content");
  assert.equal(
    JSON.stringify(automation).includes("hasMakefile"),
    false,
    "practices must not re-assert the operations presence boolean",
  );
  assert.deepEqual([...targets.kinds].toSorted(), [".PHONY", "build", "test"]);
});

// ---------------------------------------------------------------------------
// Unknown-language fixture: generic artifact-only evidence
// ---------------------------------------------------------------------------

test("T226 unknown-language fixture: generic artifact-only evidence, no first-class claims", async (t) => {
  const run = await runFixture("t226-unknown", unknownFiles);
  t.after(() => cleanupRun(run));
  const { result } = run;

  const overview = result.repos[0].overview;
  assert.deepEqual(overview.languages, ["Go"], "survey detects Go, a real non-built-in language");
  assert.equal(overview.ecosystems.primary, null);
  assert.deepEqual(overview.ecosystems.all, []);

  assert.ok(
    result.markdown.includes("PRV-generic-artifacts-v1"),
    "the generic artifact fallback must render in NORMS.md",
  );
  assert.ok(
    result.markdown.includes("### Provider Evidence"),
    "generic evidence must render a provider section",
  );

  const maintainability = findingsFor(result, "maintainability");
  const observations = maintainability.providerObservations ?? [];
  assert.ok(
    observations.length > 0,
    "generic file_metric observations must be merged into maintainability",
  );
  assert.ok(
    observations.every(({ providerId }) => providerId === "PRV-generic-artifacts-v1"),
    "only the generic provider contributes observations",
  );
  const categories = new Set(observations.map(({ category }) => category));
  assert.ok(
    categories.has("file_metric") && categories.has("measurement_universe"),
    "generic evidence is artifact-only (file_metric + measurement_universe)",
  );
  for (const observation of observations) {
    assert.deepEqual(
      Object.keys(observation).toSorted(),
      [
        "category",
        "details",
        "dimensionId",
        "matchedKey",
        "path",
        "plugin",
        "providerId",
        "sourceKind",
      ],
      "generic observations carry provider provenance only, never source claims",
    );
  }

  const statuses = newDimensionStatus(result);
  for (const dimension of ["api", "data", "deployment", "maintainability", "governance"]) {
    assert.equal(
      statuses[dimension],
      "not_detected",
      `${dimension}: the generic fallback never claims first-class semantics`,
    );
  }
  assert.equal(statuses.assurance, "observed", "assurance is observed from artifact presence only");

  const assurance = findingsFor(result, "assurance");
  assert.equal(assurance.manifest.length, 1, "go.mod is inventoried as an artifact");
  assert.equal(assurance.lock.length, 1, "go.sum is inventoried as an artifact");
  assert.equal(assurance.license.length, 1, "LICENSE is inventoried as an artifact");
});

// ---------------------------------------------------------------------------
// Statuses and coverage per the T202 contract
// ---------------------------------------------------------------------------

test("T226 statuses and coverage behave per contract for every fixture", async (t) => {
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-cov-${name}`, files);
    t.after(() => cleanupRun(run));
    const { result } = run;
    const coverage = result.expectedClaimCoverage;
    assert.equal(coverage.expected, REGISTRY_CLAIMS, `${name}: every registry claim is counted`);
    assert.equal(
      coverage.complete + coverage.incomplete + coverage.unsupported + coverage.excluded,
      coverage.expected,
      `${name}: every claim is counted exactly once`,
    );
    assert.equal(
      coverage.excluded,
      2,
      `${name}: the non-git fixture excludes the git dimension as not_applicable`,
    );
    assert.equal(
      coverage.eligible,
      coverage.complete + coverage.incomplete,
      `${name}: eligible counts only complete/incomplete`,
    );
    assert.equal(
      coverage.ratio,
      coverage.eligible === 0 ? null : coverage.complete / coverage.eligible,
      `${name}: ratio is complete/eligible`,
    );
    for (const entry of Object.values(coverage.repos[0].perDimension)) {
      assert.ok(
        CLAIM_STATUSES.includes(entry.status),
        `${name}: ${entry.status} is a registered status`,
      );
      assert.notEqual(
        entry.status,
        "inferred",
        `${name}: the pipeline never labels expected-claim coverage as inferred`,
      );
    }
    const per = coverage.repos[0].perDimension;
    assert.equal(
      per.git.status,
      "not_applicable",
      `${name}: git is proven not applicable by the is_git fact`,
    );
  }
});

test("T226 not_detected requires a complete search; incomplete searches are unverified", async (t) => {
  const empty = await runFixture("t226-empty", {});
  t.after(() => cleanupRun(empty));
  for (const dimension of SIX_NEW_DIMENSIONS) {
    assert.equal(
      newDimensionStatus(empty.result)[dimension],
      "not_detected",
      `${dimension}: empty repo is a factual absence`,
    );
    const findings = findingsFor(empty.result, dimension);
    if (dimension === "deployment") {
      // The deployment model carries counts instead of a search space; a
      // factual absence is proven by zero records on an unread empty repo.
      assert.deepEqual(findings.counts, {
        artifacts: 0,
        resources: 0,
        images: 0,
        services: 0,
        edges: 0,
        stubs: 0,
        indicators: 0,
        diagnostics: 0,
        crossArtifactEdges: 0,
      });
    } else {
      assert.equal(
        findings.searchSpace.complete,
        true,
        `${dimension}: empty repo search is complete`,
      );
    }
  }

  // >512 source files trip the API sampling cap -> incomplete search -> unverified.
  const capped = { "package.json": JSON.stringify({ name: "t226-capped", type: "module" }) };
  for (let index = 0; index < 560; index++)
    capped[`src/mod${index}.js`] = `export const v${index} = ${index};\n`;
  const cappedRun = await runFixture("t226-capped", capped);
  t.after(() => cleanupRun(cappedRun));
  const api = findingsFor(cappedRun.result, "api");
  assert.equal(api.searchSpace.complete, false);
  assert.equal(api.searchSpace.capped, true);
  assert.ok(api.searchSpace.omittedCount > 0, "skipped eligible source files must be disclosed");
  assert.equal(
    newDimensionStatus(cappedRun.result).api,
    "unverified",
    "a capped API search is unverified, never not_detected",
  );

  // A malformed/anchored OpenAPI contract yields an unsupported diagnostic
  // while the search itself stays complete and never invents operations.
  const unsupported = {
    "package.json": JSON.stringify({ name: "t226-unsupported", type: "module" }),
    "openapi.yaml": [
      "openapi: 3.0.0",
      "defaults: &base",
      "  x: 1",
      "paths:",
      "  /a:",
      "    get: *base",
      "",
    ].join("\n"),
  };
  const unsupportedRun = await runFixture("t226-unsupported", unsupported);
  t.after(() => cleanupRun(unsupportedRun));
  const unsupportedApi = findingsFor(unsupportedRun.result, "api");
  assert.deepEqual(unsupportedApi.operations, []);
  assert.ok(
    unsupportedApi.diagnostics.some(
      ({ status, reason }) => status === "unsupported" && reason === "PARSE_UNSUPPORTED",
    ),
    "unsupported template constructs are disclosed, never evaluated",
  );
  assert.equal(
    unsupportedApi.searchSpace.complete,
    true,
    "the read search stays complete; the format is what is unsupported",
  );
});

// ---------------------------------------------------------------------------
// Privacy hazards
// ---------------------------------------------------------------------------

test("T226 privacy hazards are sanitized or downgraded across all fixtures", async (t) => {
  const canaries = [
    "alice.smith@example.test",
    "t226-py-super-secret-token-value-42",
    "user:pass@db.example.test",
    "ghp_js_secret_fixture_token_99",
    "TSFixturePassw0rd",
    "rs-fixture-super-secret",
    "reviewer@example.test",
  ];
  for (const { name, files } of FIXTURES) {
    const run = await runFixture(`t226-privacy-${name}`, files);
    t.after(() => cleanupRun(run));
    const blob = `${serializedDeep(run.result)}\n${run.result.markdown}`;
    for (const canary of canaries) {
      assert.equal(
        blob.includes(canary),
        false,
        `${name}: ${canary} must never reach findings or NORMS.md`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-repository relationships
// ---------------------------------------------------------------------------

test("T226 cross-repo: shared exact reference is retained as ambiguity, never a fabricated edge", async (t) => {
  const run = await runRepos("t226-cross-shared", [repoA, repoB]);
  t.after(() => cleanupRun(run));
  const { result } = run;
  assert.equal(result.global.metrics.repositories, 2, "both repository identities are retained");
  assert.equal(
    result.global.metrics.crossRepositoryEdges,
    0,
    "an ambiguous exact reference never becomes an edge",
  );
  assert.equal(
    result.global.metrics.ambiguous,
    2,
    "the shared exact reference is disclosed as ambiguous from both sides",
  );
  assert.deepEqual(
    result.global.edges.edges,
    [],
    "no edge is fabricated from two identical candidates",
  );
  assert.ok(result.markdown.includes("## Cross-repository Architecture"));
});

test("T226 cross-repo: single-candidate exact references resolve to edges through the production pipeline", async (t) => {
  const run = await runRepos("t226-cross-single", [repoASingle, repoBSingle]);
  t.after(() => cleanupRun(run));
  const { result } = run;
  assert.equal(result.global.metrics.repositories, 2);
  assert.equal(
    result.global.metrics.edges,
    2,
    "each unique exact reference resolves to exactly one edge",
  );
  assert.equal(
    result.global.metrics.selfEdges,
    2,
    "a single candidate that is the owner is a self-edge",
  );
  assert.equal(result.global.metrics.crossRepositoryEdges, 0);
  assert.equal(result.global.metrics.ambiguous, 0);
});

test("T226 cross-repo: the production synthesis resolves an exact cross-repository reference into one edge", async () => {
  const snapshot = synthesizeCrossRepository({
    repositories: [
      {
        scanId: "scan-aaaaaaaaaaaaaaaaaaaaaaaa",
        vcs: "https://github.com/acme/consumer.git",
        contracts: ["ConsumerService"],
        events: [],
        componentRoots: [],
        manifests: [],
        workspaceNames: [],
        iac: [],
      },
      {
        scanId: "scan-bbbbbbbbbbbbbbbbbbbbbbbbbb",
        vcs: "https://github.com/acme/provider.git",
        contracts: ["OrderService"],
        events: [],
        componentRoots: [],
        manifests: [],
        workspaceNames: [],
        iac: [],
      },
    ],
    references: [
      {
        scanId: "scan-aaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "contract",
        value: "OrderService",
        path: "proto/order.proto",
        sourceKind: "contract",
      },
    ],
  });
  assert.equal(snapshot.metrics.repositories, 2);
  assert.equal(snapshot.metrics.edges, 1);
  assert.equal(
    snapshot.metrics.crossRepositoryEdges,
    1,
    "an exact unambiguous reference forms a cross-repository edge",
  );
  assert.equal(snapshot.edges.edges[0].targetKind, "repository");
  assert.equal(snapshot.edges.edges[0].self, false);
  assert.equal(snapshot.metrics.ambiguous, 0);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("T226 determinism: fixed clock produces byte-identical repeated runs", async (t) => {
  for (const { name, files } of FIXTURES) {
    const repoPath = makeFixture(`t226-det-${name}`, files);
    const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t226-det-out-"));
    t.after(() => cleanupFixture(repoPath));
    t.after(() => rm(outDir, { recursive: true, force: true }));
    const options = {
      repos: [repoPath],
      clock: () => "2026-08-03",
    };
    const first = await runExpandedPipeline({
      ...options,
      out: join(outDir, "first.md"),
      sink: (findings, _out, renderer) => renderNORMS(findings, renderer),
    });
    const second = await runExpandedPipeline({
      ...options,
      out: join(outDir, "second.md"),
      sink: (findings, _out, renderer) => renderNORMS(findings, renderer),
    });
    assert.equal(
      first.markdown,
      second.markdown,
      `${name}: repeated runs on the same fixture must be byte-identical`,
    );
    assert.equal(first.generated, "2026-08-03");
  }
  const crossA = makeFixture("t226-det-cross-a", repoA);
  const crossB = makeFixture("t226-det-cross-b", repoB);
  const outDir = await mkdtemp(join(tmpdir(), "csm-scan-t226-det-cross-out-"));
  t.after(() => {
    cleanupFixture(crossA);
    cleanupFixture(crossB);
  });
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = { repos: [crossA, crossB], clock: () => "2026-08-03" };
  const first = await runExpandedPipeline({ ...options, out: join(outDir, "first.md") });
  const second = await runExpandedPipeline({ ...options, out: join(outDir, "second.md") });
  assert.equal(
    first.markdown,
    second.markdown,
    "cross-repo: repeated runs on the same fixtures must be byte-identical",
  );
});

// ---------------------------------------------------------------------------
// Integration contract: the exported production pipeline only
// ---------------------------------------------------------------------------
