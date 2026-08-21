import { test } from "node:test";
import assert from "node:assert/strict";
import { withFixture, surveyOverview } from "./harness.mjs";
import { resolveRealRepo } from "./helpers/real-repo.mjs";
import { scan } from "../lib/scan/deep/architecture.mjs";
import { renderArchitecture } from "../lib/scan/render/architecture.mjs";
import { files as pythonFiles } from "./fixtures/python.mjs";
import { files as javascriptFiles } from "./fixtures/javascript.mjs";
import { files as typescriptFiles } from "./fixtures/typescript.mjs";
import { files as shellFiles } from "./fixtures/shell.mjs";
import { files as rustFiles } from "./fixtures/rust.mjs";

// T010 (F-007): the real-repo target resolves from CSM_SCAN_REAL_REPO, or the
// checked-in pxcli-mini fallback fixture when unset (portable; never vacuous).
const { repo: PERPLEXITY, missing: missingRealRepo } = resolveRealRepo();

function edgeCount(r) {
  return Object.values(r.findings.importGraph.graph).reduce((a, b) => a + b.length, 0);
}

const FIXTURES = [
  ["python", pythonFiles],
  ["javascript", javascriptFiles],
  ["typescript", typescriptFiles],
  ["shell", shellFiles],
  ["rust", rustFiles],
];

for (const [name, files] of FIXTURES) {
  test(`architecture: ${name} fixture yields >=1 import edge and >=1 core module`, async () => {
    await withFixture(`arch-${name}`, files, async (dir) => {
      const r = await scan(dir);
      const edges = edgeCount(r);
      const core = r.findings.layers.coreModules;
      assert.ok(edges >= 1, `${name}: expected at least 1 import edge, got ${edges}`);
      assert.ok(
        core.length >= 1,
        `${name}: expected at least 1 core module, got ${core.length} (${JSON.stringify(core)})`,
      );
    });
  });
}

test("architecture: python fixture has cli.py -> core.py edge, no test entry points, Python tech", async () => {
  await withFixture("arch-py-specifics", pythonFiles, async (dir) => {
    const r = await scan(dir);
    const graph = r.findings.importGraph.graph;
    const fromCli = graph["src/demo/cli.py"] || [];
    assert.ok(
      fromCli.includes("src/demo/core.py"),
      `cli.py should import core.py; got ${JSON.stringify(fromCli)}`,
    );
    for (const ep of r.findings.layers.entryPoints) {
      assert.ok(!/test_|conftest/.test(ep), `entry point should not be a test: ${ep}`);
    }
    assert.ok(
      r.findings.c4Container.includes("Python"),
      `c4Container should mention Python: ${r.findings.c4Container}`,
    );
  });
});

test("architecture: real perplexity-cli yields edges>0, Python tech, no test/scripts entry points", async (t) => {
  if (missingRealRepo !== null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${missingRealRepo}`);
    return;
  }
  const overview = await surveyOverview(PERPLEXITY);
  const r = await scan(PERPLEXITY, overview);
  const edges = edgeCount(r);
  const tech = (r.findings.c4Container.match(/Container\(lib,[^,]*,\s*"([^"]*)"/) || [])[1];
  const ep = r.findings.layers.entryPoints;

  assert.ok(edges > 0, `edges should be positive, got ${edges}`);
  assert.equal(tech, "Python", `c4Container tech should be Python, got ${tech}`);
  assert.ok(
    JSON.stringify(r.findings.layers.coreModules).includes("perplexity_cli"),
    "coreModules should reference perplexity_cli",
  );
  for (const f of ep) {
    assert.ok(!/test_|conftest/.test(f), `entry point must not be a test: ${f}`);
    assert.ok(!f.startsWith("scripts/"), `entry point must not be a script: ${f}`);
  }

  console.log("  [perplexity-cli] edges       =", edges);
  console.log("  [perplexity-cli] tech        =", tech);
  console.log("  [perplexity-cli] signal      =", r.signal);
  console.log(
    "  [perplexity-cli] coreModules =",
    JSON.stringify(r.findings.layers.coreModules.slice(0, 6)),
  );
  console.log("  [perplexity-cli] entryPoints =", JSON.stringify(ep.slice(0, 8)));
  const c4 = r.findings.c4Context + "\n" + r.findings.c4Container;
  const dbNodes = c4.match(/(?:ContainerDb|System_Ext)\((\w+),/g) || [];
  console.log("  [perplexity-cli] c4 db/api nodes =", JSON.stringify(dbNodes));
});

// ---------------------------------------------------------------------------
// T104: per-language accuracy cases
// ---------------------------------------------------------------------------

function edgesFrom(r, file) {
  return r.findings.importGraph.graph[file] || [];
}

test("architecture: TS strips `import type` and excludes .d.ts from the source set", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "ts-typetest", dependencies: { typescript: "*" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "src/index.ts": `import type { T } from './types';\nimport { value } from './internal';\nexport const x: T = value;\n`,
    "src/internal.ts": `export const value = 1;\n`,
    "src/types.ts": `export type T = number;\n`,
    "src/global.d.ts": `declare module 'foo';\n`,
  };
  await withFixture("arch-ts-typeonly", files, async (dir) => {
    const r = await scan(dir);
    const fromIndex = edgesFrom(r, "src/index.ts");
    assert.ok(
      fromIndex.includes("src/internal.ts"),
      `runtime import must resolve; got ${JSON.stringify(fromIndex)}`,
    );
    assert.ok(
      !fromIndex.includes("src/types.ts"),
      `type-only import must NOT emit an edge; got ${JSON.stringify(fromIndex)}`,
    );
    assert.ok(
      !r.findings.modules.includes("src/global.d.ts"),
      `.d.ts must be excluded from modules; got ${JSON.stringify(r.findings.modules)}`,
    );
  });
});

test("architecture: TS resolves @/ path aliases via tsconfig paths", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "ts-alias", dependencies: { typescript: "*" } }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
    "src/app.ts": `import { h } from '@/utils';\nexport const run = h();\n`,
    "src/utils.ts": `export function h() { return 1; }\n`,
  };
  await withFixture("arch-ts-alias", files, async (dir) => {
    const r = await scan(dir);
    const fromApp = edgesFrom(r, "src/app.ts");
    assert.ok(
      fromApp.includes("src/utils.ts"),
      `@/utils alias must resolve to src/utils.ts; got ${JSON.stringify(fromApp)}`,
    );
  });
});

test("architecture: JS workspace bare import resolves an internal edge", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "ws-root", workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "pkg-a", main: "src/index.js" }),
    "packages/a/src/index.js": `import { x } from 'pkg-b';\nexport const run = x;\n`,
    "packages/b/package.json": JSON.stringify({ name: "pkg-b", main: "src/index.js" }),
    "packages/b/src/index.js": `export const x = 1;\n`,
  };
  await withFixture("arch-js-ws", files, async (dir) => {
    const r = await scan(dir);
    const fromA = edgesFrom(r, "packages/a/src/index.js");
    assert.ok(
      fromA.includes("packages/b/src/index.js"),
      `bare 'pkg-b' import must resolve to the workspace package entry; got ${JSON.stringify(fromA)}`,
    );
  });
});

test("architecture: Python multi-line parenthesized import resolves all names", async () => {
  const files = {
    "pyproject.toml": `[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n[project]\nname = "demopy"\n`,
    "demopy/__init__.py": ``,
    "demopy/pkg/__init__.py": ``,
    "demopy/pkg/a.py": `X = 1\n`,
    "demopy/pkg/b.py": `Y = 2\n`,
    "demopy/main.py": `from demopy.pkg import (\n    a,\n    b,\n)\n`,
  };
  await withFixture("arch-py-mlimport", files, async (dir) => {
    const r = await scan(dir);
    const fromMain = edgesFrom(r, "demopy/main.py");
    assert.ok(
      fromMain.includes("demopy/pkg/a.py") && fromMain.includes("demopy/pkg/b.py"),
      `multi-line import must resolve both names; got ${JSON.stringify(fromMain)}`,
    );
  });
});

test("architecture: Python PEP 420 namespace package (no __init__) yields edges", async () => {
  const files = {
    "pyproject.toml": `[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n[project]\nname = "nspy"\n`,
    "nspkg/sub.py": `Z = 1\n`,
    "nspkg/leaf.py": `W = 2\n`,
    "main.py": `from nspkg import sub\nimport nspkg.leaf\n`,
  };
  await withFixture("arch-py-ns", files, async (dir) => {
    const r = await scan(dir);
    const fromMain = edgesFrom(r, "main.py");
    assert.ok(
      fromMain.includes("nspkg/sub.py"),
      `namespace import 'from nspkg import sub' must resolve to nspkg/sub.py; got ${JSON.stringify(fromMain)}`,
    );
    assert.ok(
      fromMain.length > 0,
      `namespace package must yield >0 edges; got ${JSON.stringify(fromMain)}`,
    );
  });
});

test("architecture: Rust nested mod, use self::, and external crate discrimination", async () => {
  const files = {
    "Cargo.toml": `[package]\nname = "demors"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n\n[[bin]]\nname = "demors"\npath = "src/main.rs"\n`,
    "src/main.rs": `mod a;\n\nfn main() {\n    let _ = a::b::foo::x();\n}\n`,
    "src/a.rs": `pub mod b;\n`,
    "src/a/b.rs": `pub mod foo;\npub mod bar;\npub mod sibling;\n\nuse self::bar::thing;\nuse super::sibling;\nuse serde::Serialize;\n\npub fn marker() {}\n`,
    "src/a/b/foo.rs": `pub fn x() -> u32 { 1 }\n`,
    "src/a/b/bar.rs": `pub fn thing() -> u32 { 2 }\n`,
    "src/a/sibling.rs": `pub fn sibling() -> u32 { 3 }\n`,
  };
  await withFixture("arch-rust-nested", files, async (dir) => {
    const r = await scan(dir);
    const fromB = edgesFrom(r, "src/a/b.rs");
    assert.ok(
      fromB.includes("src/a/b/foo.rs"),
      `nested mod foo in src/a/b.rs must resolve to src/a/b/foo.rs; got ${JSON.stringify(fromB)}`,
    );
    assert.ok(
      !fromB.includes("src/a/foo.rs") && !r.findings.modules.includes("src/a/foo.rs"),
      `must NOT invent src/a/foo.rs (old pkgRoot fallback); got ${JSON.stringify(fromB)}`,
    );
    assert.ok(
      fromB.includes("src/a/b/bar.rs"),
      `use self::bar must resolve to src/a/b/bar.rs; got ${JSON.stringify(fromB)}`,
    );
    assert.ok(
      fromB.includes("src/a/sibling.rs"),
      `use super::sibling must resolve to src/a/sibling.rs; got ${JSON.stringify(fromB)}`,
    );
    assert.ok(
      !fromB.some((t) => /serde/i.test(t)),
      `external 'use serde::' must emit NO edge; got ${JSON.stringify(fromB)}`,
    );
  });
});

test("architecture: negative case — no false edges mixing external + internal specifiers", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "neg", dependencies: {} }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "src/internal.ts": `export const r = 1;\n`,
    "src/types.ts": `export type T = number;\n`,
    "src/app.ts":
      [
        `import { r } from './internal';`,
        `import type { T } from './types';`,
        `import { ext } from 'some-external-pkg';`,
        `export const v: T = r;`,
      ].join("\n") + "\n",
  };
  await withFixture("arch-neg", files, async (dir) => {
    const r = await scan(dir);
    const fromApp = edgesFrom(r, "src/app.ts");
    assert.deepEqual(
      fromApp.toSorted(),
      ["src/internal.ts"],
      `only the internal runtime import should produce an edge; got ${JSON.stringify(fromApp)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// T004: canonical declared-layer model (quality/architecture.toml)
// ---------------------------------------------------------------------------

const CANONICAL_TOML = [
  "[schema]",
  "version = 1",
  "",
  "[[layers]]",
  'name = "shared_pure"',
  'allowed_deps = ["shared_pure"]',
  'modules = ["utils.exceptions", "utils.version"]',
  "",
  "[[layers]]",
  'name = "domain"',
  'allowed_deps = ["shared_pure", "domain"]',
  'modules = ["models"]',
  "",
  "[[layers]]",
  'name = "ports"',
  'allowed_deps = ["shared_pure", "domain", "ports"]',
  'modules = ["contracts", "contracts.query", "ports"]',
  "",
  "[[layers]]",
  'name = "application"',
  'allowed_deps = ["shared_pure", "domain", "ports", "application"]',
  'modules = ["loader"]',
  "",
  "[[layers]]",
  'name = "adapter"',
  'allowed_deps = ["shared_pure", "domain", "ports", "adapter"]',
  'modules = ["api.app", "api.client"]',
  "",
  "[[layers]]",
  'name = "presentation"',
  'allowed_deps = ["shared_pure", "domain", "ports", "application", "presentation", "adapter"]',
  'modules = ["commands", "formatting"]',
  "",
  "[[layers]]",
  'name = "composition_root"',
  'allowed_deps = ["shared_pure", "domain", "ports", "application", "adapter", "presentation", "composition_root"]',
  'modules = ["cli"]',
  "",
  "[[adapter_independence]]",
  'name = "api_adapter"',
  'modules = ["api.app", "api.client"]',
  'may_import_from = ["shared_pure", "domain", "ports"]',
  "",
  "[[composition_roots]]",
  'modules = ["cli"]',
  "",
].join("\n");

const CANONICAL_FILES = {
  "pyproject.toml": `[project]\nname = "canonical-py"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n`,
  "src/models.py": "class Model:\n    pass\n",
  "src/loader.py": "X = 1\n",
  "src/cli.py": [
    "def _wire_query_runner_seam(name, collaborator):",
    "    if getattr(query_runner, name) is None:",
    "        setattr(query_runner, name, collaborator)",
    "",
    '_wire_query_runner_seam("handle_error", handle_error)',
    '_wire_query_runner_seam("get_logger", get_logger)',
    "",
  ].join("\n"),
  "quality/architecture.toml": CANONICAL_TOML,
};

test("architecture: canonical layer model parsed from quality/architecture.toml with exact counts and seam wiring", async () => {
  await withFixture("arch-canonical-scan", CANONICAL_FILES, async (dir) => {
    const r = await scan(dir);
    assert.ok(r.findings.canonical, "canonical model must be present in findings");
    assert.equal(r.findings.canonical.source, "quality/architecture.toml");
    assert.equal(r.findings.canonical.layers.length, 7);
    const byName = Object.fromEntries(
      r.findings.canonical.layers.map((layer) => [layer.name, layer]),
    );
    assert.equal(byName.shared_pure.moduleCount, 2);
    assert.deepEqual(byName.shared_pure.allowedDeps, ["shared_pure"]);
    assert.deepEqual(byName.shared_pure.modules, ["utils.exceptions", "utils.version"]);
    assert.equal(byName.domain.moduleCount, 1);
    assert.equal(byName.ports.moduleCount, 3);
    assert.equal(byName.application.moduleCount, 1);
    assert.equal(byName.adapter.moduleCount, 2);
    assert.equal(byName.presentation.moduleCount, 2);
    assert.equal(byName.composition_root.moduleCount, 1);
    assert.equal(r.findings.canonical.adapterIndependence.length, 1);
    assert.deepEqual(r.findings.canonical.adapterIndependence[0].name, "api_adapter");
    assert.deepEqual(r.findings.canonical.compositionRoots.modules, ["cli"]);
    assert.ok(
      r.findings.canonical.seamWirings.length >= 2,
      "seam wirings detected in the composition root",
    );
    const wiring = r.findings.canonical.seamWirings[0];
    assert.equal(wiring.file, "src/cli.py");
    assert.equal(wiring.seam, "query_runner");
    assert.ok(wiring.attribute.length > 0);
  });
});

test("architecture: canonical render is primary, shows exact counts, and labels the heuristic section", async () => {
  await withFixture("arch-canonical-render", CANONICAL_FILES, async (dir) => {
    const r = await scan(dir);
    const markdown = renderArchitecture("repo", r.findings);
    assert.ok(
      markdown.includes("### Canonical Layer Model — declared layer model"),
      "the canonical section must render as primary",
    );
    assert.ok(
      markdown.includes("| shared_pure | shared_pure | 2 |"),
      "the canonical table must carry the exact shared_pure count",
    );
    assert.ok(
      markdown.includes("| ports | shared_pure, domain, ports | 3 |"),
      "the canonical table must carry the exact ports count",
    );
    assert.ok(
      markdown.includes("**Adapter independence groups** — 1 group(s):"),
      "the adapter-independence groups must render",
    );
    assert.ok(
      markdown.includes("**Composition roots** — 1 declared module(s):"),
      "the composition-root fact must render",
    );
    assert.ok(
      markdown.includes("**Seam wiring** — 2 assignment(s):"),
      "the seam-wiring fact must render",
    );
    assert.ok(
      markdown.includes("### Module Graph (heuristic — import-derived)"),
      "the heuristic module graph must be labelled heuristic",
    );
    assert.ok(
      markdown.includes("### Layer Breakdown (heuristic — import-derived)"),
      "the heuristic layer breakdown must be labelled heuristic",
    );
    assert.ok(
      markdown.includes("### C4 — System Context (heuristic — import-derived)"),
      "the heuristic C4 diagram must be labelled heuristic",
    );
  });
});

test("architecture: heuristic render is unchanged when no architecture.toml exists", async () => {
  const files = { ...CANONICAL_FILES };
  delete files["quality/architecture.toml"];
  await withFixture("arch-heuristic-only", files, async (dir) => {
    const r = await scan(dir);
    assert.equal("canonical" in r.findings, false, "no canonical key when the artifact is absent");
    const markdown = renderArchitecture("repo", r.findings);
    assert.ok(markdown.includes("### Module Graph"), "the heuristic module graph must render");
    assert.ok(
      markdown.includes("### Layer Breakdown"),
      "the heuristic layer breakdown must render",
    );
    assert.ok(
      !markdown.includes("heuristic — import-derived"),
      "the legacy render must not be relabelled",
    );
    assert.ok(
      !markdown.includes("Canonical Layer Model"),
      "no canonical section when the artifact is absent",
    );
  });
});
