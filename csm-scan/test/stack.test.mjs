import { test } from "node:test";
import assert from "node:assert/strict";
import { withFixture } from "./harness.mjs";
import { resolveRealRepo } from "./helpers/real-repo.mjs";
import { scan } from "../lib/scan/deep/stack.mjs";
import { renderStack } from "../lib/scan/render/stack.mjs";
import { files as pythonFiles } from "./fixtures/python.mjs";
import { files as javascriptFiles } from "./fixtures/javascript.mjs";
import { files as rustFiles } from "./fixtures/rust.mjs";

test("python fixture: runtime is Python (never Node), pm=uv, frameworks Click+Rich", async () => {
  const files = { ...pythonFiles, "uv.lock": "" };

  await withFixture("stack-python", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;

    assert.equal(res.dimension, "stack");
    assert.equal(f.hasPackageJson, false);
    assert.ok(
      f.runtime.startsWith("Python"),
      `runtime should start with Python, got: ${f.runtime}`,
    );
    assert.ok(!f.runtime.includes("Node"), `runtime must not contain Node, got: ${f.runtime}`);
    assert.equal(f.packageManager, "uv");
    assert.ok(f.framework.includes("Click"), `framework should include Click, got: ${f.framework}`);
    assert.ok(f.framework.includes("Rich"), `framework should include Rich, got: ${f.framework}`);
    assert.ok(f.keyDeps.includes("click"), `keyDeps should include click, got: ${f.keyDeps}`);
    assert.ok(f.keyDeps.includes("rich"), `keyDeps should include rich, got: ${f.keyDeps}`);
  });
});

test("javascript fixture: runtime is Node, pm=npm, framework Express, keyDeps express", async () => {
  const files = { ...javascriptFiles, "package-lock.json": "{}" };

  await withFixture("stack-javascript", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;

    assert.equal(f.hasPackageJson, true);
    assert.ok(f.runtime.startsWith("Node"), `runtime should start with Node, got: ${f.runtime}`);
    assert.equal(f.packageManager, "npm");
    assert.ok(
      f.framework.includes("Express"),
      `framework should include Express, got: ${f.framework}`,
    );
    assert.ok(f.keyDeps.includes("express"), `keyDeps should include express, got: ${f.keyDeps}`);
  });
});

test("rust fixture: runtime indicates rust, pm=cargo", async () => {
  await withFixture("stack-rust", rustFiles, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;

    const rt = f.runtime.toLowerCase();
    assert.ok(
      rt.startsWith("rust") || rt.includes("rustc"),
      `runtime should indicate rust, got: ${f.runtime}`,
    );
    assert.equal(f.packageManager, "cargo");
    assert.equal(f.hasPackageJson, false);
  });
});

test("python fixture: [project.optional-dependencies].dev tools appear in rendered stack", async () => {
  const pyproject =
    pythonFiles["pyproject.toml"] +
    `
[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-mock>=3",
  "pytest-cov>=7",
  "pytest-asyncio>=1.2.0",
  "ruff>=0.1",
  "refurb>=2.0",
  "ty>=0.0.24",
  "lefthook>=2.1.6",
  "bandit>=1.7.7",
  "diff-cover>=9.0",
]
`;
  const files = { ...pythonFiles, "pyproject.toml": pyproject };

  await withFixture("stack-optional-deps", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;

    assert.ok(f.optionalDeps, "findings should include optionalDeps");
    assert.ok(f.optionalDeps.dev, "optionalDeps should be keyed by group name");
    const devExtra = [
      "pytest",
      "pytest-mock",
      "pytest-cov",
      "pytest-asyncio",
      "ruff",
      "refurb",
      "ty",
      "lefthook",
      "bandit",
      "diff-cover",
    ];
    for (const tool of devExtra) {
      assert.ok(tool in f.optionalDeps.dev, `dev extra should include ${tool}`);
    }

    const rendered = renderStack("demo", f);
    assert.ok(
      rendered.includes("### Dev Dependencies"),
      "rendered stack should include a Dev Dependencies section",
    );
    for (const tool of devExtra) {
      assert.ok(rendered.includes(`\`${tool}\``), `rendered stack should list ${tool}`);
    }
    assert.ok(
      rendered.includes("(extra: dev)"),
      "rendered stack should surface the dev extra provenance",
    );
  });
});

test("python fixture: optional deps dedupe against devDependencies with merged provenance", async () => {
  const pyproject =
    pythonFiles["pyproject.toml"] +
    `
[project.optional-dependencies]
dev = [
  "pytest>=8",
  "ruff>=0.1",
]
`;
  const files = {
    ...pythonFiles,
    "pyproject.toml": pyproject,
    "requirements-dev.txt": "pytest>=7\nhypothesis>=6\n",
  };

  await withFixture("stack-optional-dedupe", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;

    const byName = new Map(f.devTools.map((tool) => [tool.name, tool]));
    assert.ok(byName.has("pytest"), "devTools should include pytest exactly once");
    assert.ok(byName.has("ruff"), "devTools should include ruff");
    assert.ok(byName.has("hypothesis"), "devTools should include hypothesis from devDependencies");
    assert.deepEqual(byName.get("pytest").sources, ["devDependencies", "optionalDependencies:dev"]);
    assert.equal(
      byName.get("pytest").spec,
      ">=7",
      "devDependencies spec should outrank the optional group",
    );
    assert.deepEqual(byName.get("ruff").sources, ["optionalDependencies:dev"]);

    const rendered = renderStack("demo", f);
    assert.ok(
      rendered.includes("- `pytest` — \\>=7 (extra: dev)"),
      "rendered pytest should show merged provenance",
    );
  });
});

test("contract findings keys are preserved (superset of required keys)", async () => {
  const required = [
    "hasPackageJson",
    "name",
    "version",
    "type",
    "main",
    "language",
    "runtime",
    "framework",
    "packageManager",
    "keyDeps",
    "keyDevDeps",
    "deps",
    "devDeps",
    "scripts",
    "docker",
    "ci",
  ];
  await withFixture("stack-contract", javascriptFiles, async (dir) => {
    const res = await scan(dir, {});
    for (const k of required) {
      assert.ok(k in res.findings, `findings missing contract key: ${k}`);
    }
    assert.equal(res.dimension, "stack");
    assert.ok(typeof res.signal === "string");
  });
});

test("version pinning keys are always present on findings", async () => {
  await withFixture("stack-version-keys", javascriptFiles, async (dir) => {
    const res = await scan(dir, {});
    for (const k of ["nodeVersion", "rustVersion", "requiresPython"]) {
      assert.ok(k in res.findings, `findings missing version key: ${k}`);
    }
  });
});

test("JS fixture with engines.node surfaces nodeVersion", async () => {
  const pkgJson = {
    name: "demo",
    version: "0.1.0",
    type: "module",
    main: "src/index.js",
    engines: { node: ">=18.0.0" },
    dependencies: { express: "^4.18.0" },
  };
  const files = { ...javascriptFiles, "package.json": JSON.stringify(pkgJson, null, 2) };

  await withFixture("stack-engines-node", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;
    assert.equal(
      f.nodeVersion,
      ">=18.0.0",
      `nodeVersion should mirror engines.node, got: ${f.nodeVersion}`,
    );
    assert.ok(f.runtime.startsWith("Node"), `runtime should start with Node, got: ${f.runtime}`);
  });
});

test("JS fixture with .nvmrc surfaces nodeVersion when engines.node absent", async () => {
  const files = { ...javascriptFiles, ".nvmrc": "20.10.0\n" };

  await withFixture("stack-nvmrc", files, async (dir) => {
    const res = await scan(dir, {});
    assert.equal(
      res.findings.nodeVersion,
      "20.10.0",
      `nodeVersion should come from .nvmrc, got: ${res.findings.nodeVersion}`,
    );
  });
});

test("JS fixture with .node-version surfaces nodeVersion when engines.node absent", async () => {
  const files = { ...javascriptFiles, ".node-version": "18.20.0\n" };

  await withFixture("stack-node-version", files, async (dir) => {
    const res = await scan(dir, {});
    assert.equal(
      res.findings.nodeVersion,
      "18.20.0",
      `nodeVersion should come from .node-version, got: ${res.findings.nodeVersion}`,
    );
  });
});

test("Rust fixture with rust-version surfaces rustVersion (MSRV)", async () => {
  const cargoToml = `[package]
name = "demo"
version = "0.1.0"
edition = "2021"
rust-version = "1.70"

[dependencies]
serde = { version = "1", features = ["derive"] }
`;
  const files = { ...rustFiles, "Cargo.toml": cargoToml };

  await withFixture("stack-rust-msrv", files, async (dir) => {
    const res = await scan(dir, {});
    const f = res.findings;
    assert.equal(
      f.rustVersion,
      "1.70",
      `rustVersion should mirror rust-version, got: ${f.rustVersion}`,
    );
    assert.equal(f.packageManager, "cargo");
    // rustc/cargo probe falls through to the descriptor label on failure,
    // which still reads as "Rust ..." — runtime stays ecosystem-correct.
    const rt = f.runtime.toLowerCase();
    assert.ok(rt.startsWith("rust"), `runtime should start with rust, got: ${f.runtime}`);
  });
});

test("bun.lock-only JS fixture: packageManager is bun", async () => {
  const files = { ...javascriptFiles, "bun.lock": "" };

  await withFixture("stack-bun-lock", files, async (dir) => {
    const res = await scan(dir, {});
    assert.equal(
      res.findings.packageManager,
      "bun",
      `expected bun, got: ${res.findings.packageManager}`,
    );
  });
});

test("bun.lockb JS fixture: packageManager is bun", async () => {
  const files = { ...javascriptFiles, "bun.lockb": "" };

  await withFixture("stack-bun-lockb", files, async (dir) => {
    const res = await scan(dir, {});
    assert.equal(
      res.findings.packageManager,
      "bun",
      `expected bun, got: ${res.findings.packageManager}`,
    );
  });
});

test("pdm.lock Python fixture: packageManager is pdm", async () => {
  const files = { ...pythonFiles, "pdm.lock": "" };

  await withFixture("stack-pdm-lock", files, async (dir) => {
    const res = await scan(dir, {});
    assert.equal(
      res.findings.packageManager,
      "pdm",
      `expected pdm, got: ${res.findings.packageManager}`,
    );
    assert.ok(
      res.findings.requiresPython,
      `requiresPython should be populated, got: ${res.findings.requiresPython}`,
    );
  });
});

// T010 (F-007): CSM_SCAN_REAL_REPO when set, otherwise the checked-in
// pxcli-mini fallback fixture (Python runtime declared via requires-python,
// uv.lock selecting the uv package manager).
const RESOLVED_REAL_REPO = resolveRealRepo();
const PERPLEXITY = RESOLVED_REAL_REPO.repo;

test("real perplexity-cli: runtime Python, pm=uv (portable target: CSM_SCAN_REAL_REPO or the fallback fixture)", async (t) => {
  if (PERPLEXITY === null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${RESOLVED_REAL_REPO.missing}`);
    return;
  }
  const res = await scan(PERPLEXITY, {});
  const f = res.findings;
  assert.ok(f.runtime.startsWith("Python"), `runtime should start with Python, got: ${f.runtime}`);
  assert.ok(!f.runtime.includes("Node"), `runtime must not contain Node, got: ${f.runtime}`);
  assert.equal(f.packageManager, "uv", `expected uv, got: ${f.packageManager}`);
  assert.ok(f.requiresPython, `requiresPython should be populated, got: ${f.requiresPython}`);
  console.log("  [perplexity-cli] runtime       =", f.runtime);
  console.log("  [perplexity-cli] packageManager =", f.packageManager);
  console.log("  [perplexity-cli] requiresPython =", f.requiresPython);
  console.log("  [perplexity-cli] language       =", f.language);
});
