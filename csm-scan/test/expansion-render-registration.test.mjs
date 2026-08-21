// T223 — inert renderer registration.
//
// Owned by T223. Tests the inert renderer registry module
// (`lib/scan/render/registry.mjs`) and the optional injected-registry seam in
// `lib/scan/write.mjs`:
//   - All 16 per-repo dimension renderers are registered in canonical T222
//     dimension order (ten established render functions plus six new via their
//     inert factories), followed by the Cross-repo global renderer.
//   - Labels, prose, and prose privacy are validated for every registered
//     renderer's static prose.
//   - Unknown, missing, and duplicate renderer registrations fail typed and
//     sanitized.
//   - Injected 17-dimension rendering is deterministic, renders all 17
//     dimensions, and performs exactly one write; injected missing/unknown
//     renderers fail before any write.
//   - The production default write path stays byte-identical (existing-ten
//     default; renderer.md baseline), and the registry remains inert: nothing
//     in production imports it.
//
// Scope (own-only): this test file, `lib/scan/render/registry.mjs`, and the
// optional injected-registry seam in `lib/scan/write.mjs`. Nothing else is
// edited.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareAscii } from "../lib/scan/contracts/evidence.mjs";
import { enrich } from "../lib/scan/enrich.mjs";
import { DEFAULT_SINK } from "../lib/scan/pipeline/run.mjs";
import { findVoiceHits } from "./helpers/voice-gate.mjs";
import {
  CROSS_REPO_GLOBAL_STAGE,
  DIMENSION_RENDERER_IDS,
  DIMENSION_RENDERER_MAP,
  DIMENSION_REGISTRY,
} from "../lib/scan/registry/dimensions.mjs";
import {
  EXISTING_TEN_RENDERER_MAP,
  EXISTING_TEN_RENDERER_ORDER,
} from "../lib/scan/render/existing-ten.mjs";
import {
  CROSS_REPO_RENDERER_ENTRY,
  DIMENSION_RENDERER_COUNT,
  DIMENSION_RENDERER_ENTRIES,
  DIMENSION_RENDERER_ORDER,
  RENDERER_SNAPSHOT,
  RENDERER_SNAPSHOT_COUNT,
  RenderRegistryError,
  createRenderRegistry,
  verifyRenderRegistry,
} from "../lib/scan/render/registry.mjs";
import { validate } from "../lib/scan/validate.mjs";
import { writeNORMS } from "../lib/scan/write.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_ROOT, "..");
const BASELINE_ROOT = join(TEST_ROOT, "baselines", "expansion");

const RENDERER_ID_PATTERN = /^RND-[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/;
const SIX_NEW_HEADINGS = [
  "## API Surface",
  "## Data Architecture",
  "## Deployment Topology",
  "## Maintainability",
  "## Governance & Ownership",
  "## Assurance & Supply Chain",
];

// ---------------------------------------------------------------------------
// Voice matcher — the shared helper (test/helpers/voice-gate.mjs). The third
// verbatim voice-gate copy was removed here for F-037; registry prose is
// checked with the same neutral-voice rules as every other voice gate.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixedOverview() {
  return {
    name: "synthetic-repository",
    path: ".",
    languages: ["JavaScript"],
    ecosystems: { primary: "javascript", all: ["javascript"] },
    packageManager: "npm",
    totalFiles: 2,
    isGit: false,
  };
}

// The authoritative ten-dimension fixed input shared with the T201/T204
// baselines (renderer.md byte parity).
function tenDeep() {
  return [
    {
      dimension: "structure",
      signal: "high",
      findings: {
        tree: ".\n├── package.json\n└── src/",
        fileCounts: { js: 1, json: 1 },
        totalFiles: 2,
      },
    },
    {
      dimension: "stack",
      signal: "high",
      findings: {
        runtime: "Node.js (declared)",
        language: "JavaScript",
        framework: "(none)",
        packageManager: "npm",
        name: "synthetic-package",
        version: "1.0.0",
      },
    },
    {
      dimension: "config",
      signal: "high",
      findings: {
        lint: { config: "eslint.config.mjs" },
        format: "prettier",
        markers: [".editorconfig"],
      },
    },
    {
      dimension: "testing",
      signal: "high",
      findings: {
        framework: ["node:test"],
        fileCount: 1,
        naming: ["*.test.mjs"],
        sampleFiles: ["test/example.test.mjs"],
        testDirs: ["test"],
      },
    },
    {
      dimension: "conventions",
      signal: "high",
      findings: {
        importStyle: {
          type: "ESM (import/export)",
          hasTypeImports: false,
          hasDynamicImports: false,
          samples: [],
        },
        fileNaming: { dominant: "kebab-case", total: 2, patterns: { "kebab-case": 2 } },
        errorHandling: { patterns: ["throw"] },
        moduleSystem: { inferred: "ESM" },
        commentDensity: "10.0% (1 comment / 10 code lines)",
      },
    },
    { dimension: "git", signal: "high", findings: { isGit: false } },
    {
      dimension: "architecture",
      signal: "high",
      findings: {
        layers: {
          totalFiles: 2,
          totalEdges: 1,
          entryPoints: ["src/index.js"],
          libModules: ["src/value.js"],
          shared: [],
          rest: [],
        },
        asciiGraph: "src/index.js -> src/value.js",
      },
    },
    {
      dimension: "documentation",
      signal: "high",
      findings: {
        readme: { present: true, path: "README.md", sections: 2, hasSetup: true },
        contributing: { present: false },
        license: { present: true, name: "MIT", path: "LICENSE" },
        commentRatio: { ratio: 10, commentLines: 1, codeLines: 10 },
        todoCount: 0,
      },
    },
    {
      dimension: "security",
      signal: "high",
      findings: {
        secrets: { count: 0, findings: [] },
        envExample: true,
        gitignoreEnvProtected: true,
        hasLockfile: true,
        dependabot: false,
      },
    },
    {
      dimension: "operations",
      signal: "high",
      findings: {
        dockerfiles: [],
        ci: [],
        healthChecks: { detected: false, references: [] },
        hasMakefile: true,
        hasJustfile: false,
      },
    },
  ];
}

// Minimal but renderable findings for all 17 dimensions in canonical order so
// the injected registry renders every dimension deterministically.
function sixteenDeep() {
  return [
    {
      dimension: "structure",
      signal: "high",
      findings: { tree: ".", fileCounts: {}, totalFiles: 0 },
    },
    {
      dimension: "stack",
      signal: "high",
      findings: {
        runtime: "Node.js (declared)",
        language: "JavaScript",
        framework: "(none)",
        packageManager: "npm",
      },
    },
    { dimension: "config", signal: "high", findings: {} },
    {
      dimension: "testing",
      signal: "high",
      findings: { framework: [], fileCount: 0, naming: [], sampleFiles: [], testDirs: [] },
    },
    { dimension: "conventions", signal: "high", findings: {} },
    { dimension: "git", signal: "high", findings: { isGit: false } },
    { dimension: "architecture", signal: "high", findings: { layers: null } },
    { dimension: "documentation", signal: "high", findings: {} },
    { dimension: "security", signal: "high", findings: {} },
    { dimension: "operations", signal: "high", findings: {} },
    {
      dimension: "api",
      signal: "high",
      findings: {
        summary: {
          operations: 0,
          routes: 0,
          contracts: 0,
          rpcs: 0,
          events: 0,
          cliCommands: 0,
          publicExports: 0,
          capped: {},
        },
        operations: [],
        searchSpace: { filesInspected: 1 },
        diagnostics: [],
      },
    },
    {
      dimension: "data",
      signal: "high",
      findings: {
        summary: {
          entities: 0,
          fields: 0,
          keys: 0,
          relations: 0,
          migrations: 0,
          stores: 0,
          caches: 0,
          queues: 0,
          edges: 0,
          capped: {},
        },
        searchSpace: { filesInspected: 1 },
        stores: [],
        schemas: [],
        entities: [],
        fields: [],
        keys: [],
        relations: [],
        migrations: [],
        caches: [],
        queues: [],
        edges: [],
        diagnostics: [],
      },
    },
    { dimension: "deployment", signal: "high", findings: { counts: { artifacts: 0 } } },
    {
      dimension: "maintainability",
      signal: "high",
      findings: {
        summary: {
          filesMeasured: 0,
          tokens: 0,
          dialects: [],
          branchPoints: 0,
          duplicateGroups: 0,
          generatedFiles: 0,
          toolEvidence: 0,
          eligibleFiles: 0,
          partialCoverage: false,
          capped: {},
        },
        measurementUniverse: {
          filesInspected: 0,
          bytesInspected: 0,
          recordsInspected: 0,
          measuredFiles: 0,
          eligibleFiles: 0,
          omittedCount: 0,
          excludedFiles: 0,
          supportedDialects: [],
          excludedLanguages: [],
        },
        searchSpace: { capped: false },
        sizeDistribution: [],
        branchPoints: [],
        duplicateGroups: [],
        generatedBoundaries: [],
        toolEvidence: [],
        files: [],
        diagnostics: [],
      },
    },
    {
      dimension: "governance",
      signal: "high",
      findings: {
        summary: { filesInspected: 0, isGit: false, defaultBranch: null, entries: 0, capped: {} },
        ownership: {
          files: 0,
          patterns: 0,
          assigneeCount: 0,
          assignmentCount: 0,
          rules: [],
          assignees: [],
        },
        searchSpace: {
          complete: true,
          supported: true,
          readable: true,
          capped: false,
          error: false,
          malformed: false,
          filesInspected: 0,
        },
        entries: [],
        diagnostics: [],
      },
    },
    {
      dimension: "assurance",
      signal: "high",
      findings: {
        summary: {
          manifests: 0,
          locks: 0,
          pins: 0,
          sources: 0,
          licenses: 0,
          sboms: 0,
          vexes: 0,
          sarifs: 0,
          configurations: 0,
          toolResults: 0,
          accessibility: 0,
          attestations: 0,
          standards: 0,
          records: 0,
          capped: {},
        },
        searchSpace: { filesInspected: 1 },
        diagnostics: [],
      },
    },
    {
      dimension: "practices",
      signal: "high",
      findings: {
        summary: { filesInspected: 0, isGit: false, defaultBranch: null, entries: 0, capped: {} },
        searchSpace: {
          complete: true,
          supported: true,
          readable: true,
          capped: false,
          error: false,
          malformed: false,
          filesInspected: 0,
        },
        entries: [],
        diagnostics: [],
      },
    },
  ];
}

function sixteenFindings() {
  return { generated: "2026-01-15", repos: [{ overview: fixedOverview(), deep: sixteenDeep() }] };
}

// The ten-dimension fixed input enriched and validated exactly like the T201
// baseline producer, so the default write path reproduces renderer.md bytes.
async function validatedTenFindings() {
  const overview = fixedOverview();
  const enriched = await enrich(tenDeep(), overview);
  const validated = await validate(enriched);
  return { overview, deep: validated.findings };
}

function entryFor(dimension, overrides = {}) {
  return {
    dimension,
    rendererId: `RND-${dimension}-v1`,
    label: "Neutral Label",
    prose: ["Neutral static prose line."],
    render: () => "",
    ...overrides,
  };
}

async function libScanFiles() {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
    }
  }
  await visit(join(ROOT, "lib"));
  return files.toSorted();
}

// ---------------------------------------------------------------------------
// Registry snapshot — all registered renderers in dimension order
// ---------------------------------------------------------------------------

test("T223 registry: snapshot registers all 17 dimensions in canonical order plus the global renderer", () => {
  assert.equal(DIMENSION_RENDERER_COUNT, 17);
  assert.equal(RENDERER_SNAPSHOT_COUNT, 18);
  assert.equal(DIMENSION_RENDERER_ORDER.length, 17);
  assert.equal(new Set(DIMENSION_RENDERER_ORDER).size, 17);

  assert.equal(RENDERER_SNAPSHOT.length, RENDERER_SNAPSHOT_COUNT);
  assert.deepEqual(
    RENDERER_SNAPSHOT.slice(0, 17).map(({ dimension }) => dimension),
    DIMENSION_RENDERER_ORDER,
  );

  // Canonical T222 dimension order: the shorts must match the validated
  // DIMENSION_REGISTRY exactly.
  const canonicalShorts = DIMENSION_REGISTRY.map(({ id }) =>
    id.replace(/^DIM-/, "").replace(/-v[1-9]\d*$/, ""),
  );
  assert.deepEqual(
    RENDERER_SNAPSHOT.slice(0, 17).map(({ dimension }) => dimension),
    canonicalShorts,
  );

  // Renderer IDs are stable RND-<short>-v1 identifiers matching the T222 map.
  for (const entry of RENDERER_SNAPSHOT.slice(0, 17)) {
    assert.match(entry.rendererId, RENDERER_ID_PATTERN);
    assert.equal(entry.rendererId, DIMENSION_RENDERER_MAP[`DIM-${entry.dimension}-v1`]);
  }
  assert.deepEqual(
    RENDERER_SNAPSHOT.slice(0, 17)
      .map(({ rendererId }) => rendererId)
      .slice()
      .toSorted(compareAscii),
    DIMENSION_RENDERER_IDS,
  );

  // Every per-repo entry carries a render function, a label, and prose.
  for (const entry of RENDERER_SNAPSHOT.slice(0, 17)) {
    assert.equal(
      typeof entry.render,
      "function",
      `${entry.dimension} must register a render function`,
    );
    assert.ok(
      typeof entry.label === "string" && entry.label.length > 0,
      `${entry.dimension} needs a label`,
    );
    assert.ok(
      Array.isArray(entry.prose) && entry.prose.length > 0,
      `${entry.dimension} needs prose`,
    );
  }

  // The global Cross-repo renderer is the 18th registration, data-only.
  const global = RENDERER_SNAPSHOT[17];
  assert.equal(global.dimension, "cross-repo-global");
  assert.equal(global.rendererId, "RND-cross-repo-global-v1");
  assert.match(global.rendererId, RENDERER_ID_PATTERN);
  assert.equal(global.module, CROSS_REPO_GLOBAL_STAGE.renderer.module);
  assert.equal(global.factory, CROSS_REPO_GLOBAL_STAGE.renderer.factory);
  assert.equal(global.exportName, CROSS_REPO_GLOBAL_STAGE.renderer.exportName);
  assert.ok(Array.isArray(global.prose) && global.prose.length > 0);

  // Renderer IDs are globally unique across the whole snapshot.
  assert.equal(
    new Set(RENDERER_SNAPSHOT.map(({ rendererId }) => rendererId)).size,
    RENDERER_SNAPSHOT.length,
  );
  assert.equal(DIMENSION_RENDERER_IDS.includes(global.rendererId), false);

  // The snapshot and default entries are deep-frozen.
  assert.throws(() => RENDERER_SNAPSHOT.pop(), TypeError);
  assert.throws(() => {
    RENDERER_SNAPSHOT[0].label = "mutated";
  }, TypeError);
  assert.throws(() => RENDERER_SNAPSHOT[0].prose.push("mutated"), TypeError);
});

test("T223 registry: verifyRenderRegistry is idempotent and byte-stable on the default entries", () => {
  const verified = verifyRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES });
  assert.equal(verified.length, DIMENSION_RENDERER_COUNT);
  assert.deepEqual(
    verified.map(({ dimension }) => dimension),
    DIMENSION_RENDERER_ORDER,
  );
  assert.equal(
    JSON.stringify(verifyRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES })),
    JSON.stringify(verified),
  );
  assert.deepEqual(DIMENSION_RENDERER_ENTRIES, RENDERER_SNAPSHOT.slice(0, 17));
  assert.equal(createRenderRegistry().snapshot.length, RENDERER_SNAPSHOT_COUNT);
  assert.equal(Object.isFrozen(createRenderRegistry().snapshot), true);
});

// ---------------------------------------------------------------------------
// Typed, sanitized failures for unknown / missing / duplicate renderers
// ---------------------------------------------------------------------------

const assertRegistryError = (fn, code, canary = "") => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof RenderRegistryError, `expected RenderRegistryError for ${code}`);
    assert.equal(error.code, code);
    if (canary)
      assert.equal(
        error.message.includes(canary),
        false,
        `${code} message must not echo ${canary}`,
      );
    return true;
  });
};

test("T223 registry: unknown, missing, and duplicate renderers fail typed and sanitized", () => {
  // Unknown dimension in the order.
  assertRegistryError(
    () => createRenderRegistry({ order: [...DIMENSION_RENDERER_ORDER, "private-canary"] }),
    "UNKNOWN_RENDERER",
    "private-canary",
  );
  // Duplicate dimension in the order.
  assertRegistryError(
    () => createRenderRegistry({ order: [...DIMENSION_RENDERER_ORDER.slice(0, -1), "structure"] }),
    "DUPLICATE_RENDERER",
  );
  // Missing entries (only 15 registered).
  assertRegistryError(
    () => createRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES.slice(0, 15) }),
    "MISSING_RENDERER",
  );
  // Duplicate entry (a registered dimension appears twice).
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [...DIMENSION_RENDERER_ENTRIES, DIMENSION_RENDERER_ENTRIES[0]],
      }),
    "DUPLICATE_RENDERER",
  );
  // Unknown dimension entry (16 entries, one is not a registered dimension).
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [...DIMENSION_RENDERER_ENTRIES.slice(1), entryFor("private-canary")],
      }),
    "UNKNOWN_RENDERER",
    "private-canary",
  );
  // Non-function render.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [
          ...DIMENSION_RENDERER_ENTRIES.slice(0, 15),
          entryFor("assurance", { render: null }),
        ],
      }),
    "INVALID_RENDERER",
  );
  // Invalid renderer ID.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [
          ...DIMENSION_RENDERER_ENTRIES.slice(0, 15),
          entryFor("assurance", { rendererId: "not-a-renderer" }),
        ],
      }),
    "INVALID_RENDERER",
  );
  // Empty label.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [...DIMENSION_RENDERER_ENTRIES.slice(0, 15), entryFor("assurance", { label: "" })],
      }),
    "INVALID_LABEL",
  );
  // Empty prose.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [...DIMENSION_RENDERER_ENTRIES.slice(0, 15), entryFor("assurance", { prose: [] })],
      }),
    "INVALID_PROSE",
  );
  // Judgmental prose.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [
          ...DIMENSION_RENDERER_ENTRIES.slice(0, 15),
          entryFor("assurance", { prose: ["This should be improved."] }),
        ],
      }),
    "VOICE_HIT",
  );
  // Privacy hazard in prose.
  assertRegistryError(
    () =>
      createRenderRegistry({
        entries: [
          ...DIMENSION_RENDERER_ENTRIES.slice(0, 15),
          entryFor("assurance", { prose: ["Contact admin@example.test for details."] }),
        ],
      }),
    "PRIVACY_HAZARD",
  );
  // Invalid global descriptor.
  assertRegistryError(
    () =>
      createRenderRegistry({ global: { ...CROSS_REPO_RENDERER_ENTRY, dimension: "not-global" } }),
    "UNKNOWN_RENDERER",
    "not-global",
  );
  assertRegistryError(
    () => createRenderRegistry({ global: { ...CROSS_REPO_RENDERER_ENTRY, rendererId: "nope" } }),
    "INVALID_RENDERER",
  );
});

test("T223 registry: injected findings with an unknown dimension fail typed and sanitized before rendering", () => {
  const registry = createRenderRegistry();
  assert.throws(
    () => registry.render([{ dimension: "private-canary", findings: {} }]),
    (error) => {
      assert.ok(error instanceof RenderRegistryError);
      assert.equal(error.code, "UNKNOWN_DIMENSION");
      assert.equal(error.message.includes("private-canary"), false);
      return true;
    },
  );
  assert.throws(
    () => registry.render(null),
    (error) => {
      assert.ok(error instanceof RenderRegistryError);
      assert.equal(error.code, "INVALID_FINDINGS");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Injected 17-dimension rendering — determinism and one write
// ---------------------------------------------------------------------------

test("T223 injected: 17-dimension rendering is deterministic, renders all 17 dimensions, and performs one write", async () => {
  const findings = sixteenFindings();
  const first = await mkdtemp(join(tmpdir(), "csm-scan-t223-reg-a-"));
  const second = await mkdtemp(join(tmpdir(), "csm-scan-t223-reg-b-"));
  try {
    const outA = join(first, "NORMS.md");
    const outB = join(second, "NORMS.md");
    const contentA = await writeNORMS(findings, outA, createRenderRegistry());
    const contentB = await writeNORMS(findings, outB, createRenderRegistry());
    assert.equal(contentA, contentB, "injected rendering must be deterministic across registries");
    assert.equal(contentA, await readFile(outA, "utf8"));
    assert.equal(contentB, await readFile(outB, "utf8"));
    assert.deepEqual(await readdir(first), ["NORMS.md"], "exactly one write per invocation");
    assert.deepEqual(await readdir(second), ["NORMS.md"], "exactly one write per invocation");

    // All 17 dimensions render.
    for (const dimension of DIMENSION_RENDERER_ORDER) {
      const heading =
        dimension === "structure"
          ? "## Repository Structure"
          : dimension === "stack"
            ? "## Technology Stack"
            : dimension === "config"
              ? "## Configuration"
              : dimension === "testing"
                ? "## Testing"
                : dimension === "conventions"
                  ? "## Code Conventions"
                  : dimension === "git"
                    ? "## Git Practices"
                    : dimension === "architecture"
                      ? "## Architecture"
                      : dimension === "documentation"
                        ? "## Documentation"
                        : dimension === "security"
                          ? "## Security"
                          : dimension === "operations"
                            ? "## Operations"
                            : dimension === "api"
                              ? "## API Surface"
                              : dimension === "data"
                                ? "## Data Architecture"
                                : dimension === "deployment"
                                  ? "## Deployment Topology"
                                  : dimension === "maintainability"
                                    ? "## Maintainability"
                                    : dimension === "governance"
                                      ? "## Governance & Ownership"
                                      : dimension === "assurance"
                                        ? "## Assurance & Supply Chain"
                                        : "## Development Practices";
      assert.ok(contentA.includes(heading), `${dimension} heading missing from injected rendering`);
    }
    assert.equal(contentA.includes("\r"), false);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("T223 injected: injected missing or unknown renderer fails before any write", async () => {
  const findings = sixteenFindings();
  const missing = await mkdtemp(join(tmpdir(), "csm-scan-t223-missing-"));
  try {
    // Missing renderer: registry creation fails before writeNORMS is invoked.
    assert.throws(
      () => createRenderRegistry({ entries: DIMENSION_RENDERER_ENTRIES.slice(0, 15) }),
      (error) => error instanceof RenderRegistryError && error.code === "MISSING_RENDERER",
    );

    // Unknown dimension in injected findings: rendering fails inside
    // writeNORMS, before the single write call.
    const badFindings = {
      ...findings,
      repos: [
        {
          ...findings.repos[0],
          deep: [...sixteenDeep().slice(0, 15), { dimension: "private-canary", findings: {} }],
        },
      ],
    };
    const out = join(missing, "NORMS.md");
    await assert.rejects(
      writeNORMS(badFindings, out, createRenderRegistry()),
      (error) => error instanceof RenderRegistryError && error.code === "UNKNOWN_DIMENSION",
    );
    assert.deepEqual(
      await readdir(missing),
      [],
      "no file may be written when injected rendering fails",
    );
  } finally {
    await rm(missing, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Default unchanged — byte-parity and inertness
// ---------------------------------------------------------------------------

test("T223 default: writeNORMS default stays byte-identical to the renderer.md baseline", async () => {
  const expected = await readFile(join(BASELINE_ROOT, "renderer.md"), "utf8");
  const { overview, deep } = await validatedTenFindings();
  const root = await mkdtemp(join(tmpdir(), "csm-scan-t223-parity-"));
  try {
    const out = join(root, "NORMS.md");
    const content = await writeNORMS({ generated: "2026-01-15", repos: [{ overview, deep }] }, out);
    assert.equal(content, expected);
    assert.equal(await readFile(out, "utf8"), content);
    assert.deepEqual(await readdir(root), ["NORMS.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  // The existing-ten definitions and the production sink are untouched.
  assert.deepEqual(EXISTING_TEN_RENDERER_ORDER, [
    "structure",
    "stack",
    "config",
    "testing",
    "conventions",
    "git",
    "architecture",
    "documentation",
    "security",
    "operations",
  ]);
  assert.deepEqual(Object.keys(EXISTING_TEN_RENDERER_MAP), EXISTING_TEN_RENDERER_ORDER);
  assert.equal(DEFAULT_SINK, writeNORMS);
});

test("T223 default: the six new renderers stay inert in the default write path", async () => {
  const root = await mkdtemp(join(tmpdir(), "csm-scan-t223-inert-"));
  try {
    const out = join(root, "NORMS.md");
    const content = await writeNORMS(
      { generated: "2026-01-15", repos: [{ overview: fixedOverview(), deep: tenDeep() }] },
      out,
    );
    for (const heading of SIX_NEW_HEADINGS) {
      assert.equal(content.includes(heading), false, `default path must not dispatch ${heading}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("T223 inert: no production module imports the renderer registry and the write seam stays minimal", async () => {
  const registryPath = join(ROOT, "lib", "scan", "render", "registry.mjs");
  const activatedConsumers = new Set([join(ROOT, "lib", "scan", "pipeline", "run.mjs")]);
  const consumers = [];
  for (const file of await libScanFiles()) {
    if (file === registryPath) continue;
    if (activatedConsumers.has(file)) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("render/registry.mjs")) consumers.push(file.replace(/\\/g, "/"));
  }
  assert.deepEqual(consumers, [], "only the activated pipeline may consume the renderer registry");

  const writeSource = await readFile(join(ROOT, "lib", "scan", "write.mjs"), "utf8");
  assert.equal(writeSource.includes("registry.mjs"), false, "write must not import the registry");
  assert.equal(
    writeSource.includes("registry/dimensions"),
    false,
    "write must not reference the dimension registry",
  );
  assert.equal(writeSource.includes("cross-repo"), false, "write must not reference cross-repo");
  // T010 (F-065-b reconciliation): the write seam is the atomic tmp+rename
  // writer (exactly one temp write and one rename), not the old direct write.
  assert.equal(
    writeSource.split("import { rename, unlink, writeFile } from 'node:fs/promises';").length - 1,
    1,
    "the write seam must import exactly the atomic writer statement",
  );
  assert.equal(
    writeSource.split("await writeFile(tmpPath, content, 'utf-8');").length - 1,
    1,
    "the write seam must perform exactly one temp write",
  );
  assert.equal(
    writeSource.split("await rename(tmpPath, outPath);").length - 1,
    1,
    "the write seam must rename the temp file over the target exactly once",
  );

  const existingTen = await readFile(
    join(ROOT, "lib", "scan", "render", "existing-ten.mjs"),
    "utf8",
  );
  assert.equal(
    existingTen.includes("registry"),
    false,
    "existing-ten must not reference the registry",
  );
});

// ---------------------------------------------------------------------------
// Voice, labels, and privacy on every registered renderer's static prose
// ---------------------------------------------------------------------------

test("T223 voice: every registered renderer label and static prose is neutral", () => {
  for (const entry of RENDERER_SNAPSHOT) {
    assert.ok(
      typeof entry.label === "string" && entry.label.length > 0,
      `${entry.dimension} needs a label`,
    );
    assert.ok(
      Array.isArray(entry.prose) && entry.prose.length > 0,
      `${entry.dimension} needs prose`,
    );
    const text = `${entry.label}\n${entry.prose.join("\n")}`;
    const hits = findVoiceHits(text);
    assert.deepEqual(
      hits,
      [],
      `${entry.dimension} static prose has judgmental voice:\n${JSON.stringify(hits, null, 2)}`,
    );
  }
});

test("T223 voice: registered renderer prose stays clean under the established neutral prose masking", () => {
  // Representative prose should never trip the gate even when embedded in a
  // full document with tables and code fences.
  for (const entry of RENDERER_SNAPSHOT.slice(0, 17)) {
    const markdown = [
      `# NORMS — synthetic`,
      "",
      "| Basis | Meaning |",
      "|-------|---------|",
      "| `observed` | Scanner fields reported directly from repository artifacts |",
      "",
      entry.label,
      entry.prose.join("\n"),
      "```text",
      "should must bad weak strong",
      "```",
      "",
    ].join("\n");
    assert.deepEqual(
      findVoiceHits(markdown),
      [],
      `${entry.dimension} prose fails the voice gate in context`,
    );
  }
});
