import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readManifest } from "../lib/scan/shared/manifest.mjs";

// Fixture text modeled on perplexity-cli's relevant pyproject sections.
// (Single-quoted TOML strings to exercise literal-string parsing too.)
const PYPROJECT_FIXTURE = `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "pxcli"
version = "0.7.1"
requires-python = ">=3.12"
description = "CLI fixture"
dependencies = [
    "click>=8.0",
    "rich>=13.0",
    "httpx>=0.25",
    "mcp>=1.28.1,<2.0.0",
]

[project.scripts]
pxcli = "perplexity_cli.cli:main"

[tool.setuptools.packages.find]
where = ["src"]
`;

const PKG_FIXTURE = {
  name: "demo-pkg",
  version: "2.0.0",
  description: "a TS demo",
  dependencies: { express: "^4.18.0" },
  devDependencies: { typescript: "^5.4.0", "@types/node": "^20.0.0" },
  scripts: { build: "tsc" },
  bin: "dist/cli.js",
};

const CARGO_FIXTURE = `[package]
name = "mycrate"
version = "0.2.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"

[dev-dependencies]
proptest = "1.0"

[[bin]]
name = "mycli"
path = "src/bin/cli.rs"
`;

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "csm-scan-manifest-"));
  return dir;
}

test("readManifest: pyproject fixture (python ecosystem, hatchling, src-layout)", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "pyproject.toml"), PYPROJECT_FIXTURE);
    const m = readManifest(dir);

    assert.ok(m.ecosystems.includes("python"), `ecosystems: ${JSON.stringify(m.ecosystems)}`);
    assert.equal(m.name, "pxcli");
    assert.equal(m.version, "0.7.1");
    assert.equal(m.requiresPython, ">=3.12");
    assert.equal(m.buildBackend, "hatchling", "detected from build-system.requires");
    assert.equal(m.sourceLayout, "src-layout");

    for (const expected of ["click", "rich", "httpx", "mcp"]) {
      assert.ok(
        expected in m.dependencies,
        `dependencies missing ${expected}: ${JSON.stringify(m.dependencies)}`,
      );
    }
    assert.equal(m.dependencies.click, ">=8.0");
    assert.equal(m.dependencies.mcp, ">=1.28.1,<2.0.0", "multi-spec preserved");

    assert.ok(
      m.entrypoints.some((e) => e.startsWith("pxcli=")),
      `entrypoints missing pxcli script: ${JSON.stringify(m.entrypoints)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: buildBackend explicit wins / normalizes dotted form", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `# perplexity-cli-style: setuptools.build_meta
[build-system]
requires = ["setuptools>=77.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "x"
version = "0.1.0"
`,
    );
    const m = readManifest(dir);
    assert.equal(m.buildBackend, "setuptools", "dotted build-backend normalized to head segment");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: package.json fixture resolves to typescript ecosystem", () => {
  // DESIGN CHOICE: a package.json with typescript (or @types/*) or a tsconfig
  // resolves to the SINGLE ecosystem 'typescript' (NOT ['javascript','typescript']).
  // This matches survey.mjs's LANG_SIGNALS, which treats JS and TS as distinct
  // languages and lets TS (weight 5) win over JS when both signals are present.
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(PKG_FIXTURE, null, 2));
    const m = readManifest(dir);

    assert.deepEqual(m.ecosystems, ["typescript"], `ecosystems=${JSON.stringify(m.ecosystems)}`);
    assert.equal(m.name, "demo-pkg");
    assert.ok("express" in m.dependencies, "express dependency captured");
    assert.ok("typescript" in m.devDependencies, "typescript devDep captured");
    assert.ok("@types/node" in m.devDependencies, "@types/node devDep captured");
    assert.ok(
      m.entrypoints.some((e) => e.startsWith("demo-pkg=")),
      "bin captured as entrypoint",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: package.json without typescript -> javascript ecosystem", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "plain",
          version: "1.0.0",
          dependencies: { express: "^4.0.0" },
        },
        null,
        2,
      ),
    );
    const m = readManifest(dir);
    assert.deepEqual(m.ecosystems, ["javascript"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: Cargo.toml fixture -> rust ecosystem", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "Cargo.toml"), CARGO_FIXTURE);
    const m = readManifest(dir);

    assert.deepEqual(m.ecosystems, ["rust"]);
    assert.equal(m.name, "mycrate");
    assert.equal(m.version, "0.2.0");
    assert.equal(m.dependencies.tokio, "1");
    assert.equal(m.dependencies.serde, "1.0", "cargo table dep version extracted");
    assert.equal(m.devDependencies.proptest, "1.0");
    assert.ok(
      m.entrypoints.some((e) => e.startsWith("mycli=")),
      "cargo [[bin]] captured",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: missing manifests -> empty normalized object, no throw", () => {
  const dir = makeTempRepo();
  try {
    const m = readManifest(dir);
    assert.deepEqual(m.ecosystems, []);
    assert.equal(m.name, null);
    assert.equal(m.buildBackend, null);
    assert.deepEqual(m.dependencies, {});
    assert.deepEqual(m.entrypoints, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: polyglot repo (pyproject + package.json + Cargo) -> three ecosystems", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "pyproject.toml"), PYPROJECT_FIXTURE);
    writeFileSync(join(dir, "package.json"), JSON.stringify(PKG_FIXTURE, null, 2));
    writeFileSync(join(dir, "Cargo.toml"), CARGO_FIXTURE);

    const m = readManifest(dir);
    assert.deepEqual(m.ecosystems, ["python", "typescript", "rust"]);

    // name/version/description priority: pyproject > package.json > Cargo
    assert.equal(m.name, "pxcli", "pyproject name wins");
    assert.equal(m.version, "0.7.1", "pyproject version wins");

    // deps from all three coexist (different ecosystems)
    assert.ok("click" in m.dependencies, "python dep present");
    assert.ok("express" in m.dependencies, "js dep present");
    assert.ok("tokio" in m.dependencies, "rust dep present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: setup.py present (no pyproject) still flags python ecosystem", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "setup.py"), 'from setuptools import setup\nsetup(name="legacy")\n');
    const m = readManifest(dir);
    assert.ok(m.ecosystems.includes("python"));
    assert.equal(m.name, null, "setup.py not parsed (out of scope); name stays null");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T103: manifest normalization expansion (JS exports/engines/workspaces,
// Rust workspace + features + lib, PEP 735 dependency-groups, requirements.txt)
// ---------------------------------------------------------------------------

test("readManifest: package.json exports/engines/workspaces/peerDependencies surfaced", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "lib-pkg",
          version: "1.2.3",
          main: "dist/index.cjs",
          module: "dist/index.mjs",
          exports: {
            ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" },
            "./foo": "./dist/foo.js",
          },
          imports: { "#internal": "./src/internal.js" },
          engines: { node: ">=18.0.0" },
          peerDependencies: { react: "^18.0.0" },
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
    );
    const m = readManifest(dir);

    assert.equal(m.main, "dist/index.cjs");
    assert.equal(m.module, "dist/index.mjs");
    assert.ok(m.exports && typeof m.exports === "object", "exports map surfaced");
    assert.ok(m.exports["."] && typeof m.exports["."] === "object");
    assert.ok(m.imports && "#internal" in m.imports, "subpath imports surfaced");
    assert.ok(m.engines && m.engines.node === ">=18.0.0", "engines surfaced");
    assert.equal(m.nodeVersion, ">=18.0.0", "nodeVersion sourced from engines.node");
    assert.equal(m.peerDependencies.react, "^18.0.0", "peerDependencies surfaced");
    assert.deepEqual(m.workspaces, ["packages/*"], "workspaces surfaced");

    // entrypoints populated from main/module/exports.
    assert.ok(
      m.entrypoints.some((e) => e === "main=dist/index.cjs"),
      `main entrypoint: ${JSON.stringify(m.entrypoints)}`,
    );
    assert.ok(
      m.entrypoints.some((e) => e === "module=dist/index.mjs"),
      "module entrypoint",
    );
    // exports "." resolved to the import condition path.
    assert.ok(
      m.entrypoints.some((e) => e === "exports=./dist/index.mjs"),
      `exports "." resolved to import path: ${JSON.stringify(m.entrypoints)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: package.json string exports -> nodeVersion + single exports entrypoint", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "str-exp",
          version: "0.1.0",
          type: "module",
          exports: "./dist/index.js",
          engines: { node: ">=20" },
        },
        null,
        2,
      ),
    );
    const m = readManifest(dir);
    assert.equal(m.exports, "./dist/index.js", "string exports preserved");
    assert.equal(m.nodeVersion, ">=20");
    assert.ok(m.entrypoints.includes("exports=./dist/index.js"), "string exports -> entrypoint");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: Rust workspace root unions member deps + rustVersion from [workspace.package]", () => {
  const dir = makeTempRepo();
  try {
    mkdirSync(join(dir, "crate-a"));
    mkdirSync(join(dir, "crate-b"));
    writeFileSync(
      join(dir, "Cargo.toml"),
      `
[workspace]
members = ["crate-a", "crate-b"]
resolver = "2"

[workspace.package]
edition = "2021"
rust-version = "1.75"

[workspace.dependencies]
anyhow = "1.0"
`,
    );
    writeFileSync(
      join(dir, "crate-a", "Cargo.toml"),
      `
[package]
name = "crate-a"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = "1.0"
`,
    );
    writeFileSync(
      join(dir, "crate-b", "Cargo.toml"),
      `
[package]
name = "crate-b"
version = "0.2.0"

[dependencies]
tokio = { version = "1", features = ["full"] }
rand = "0.8"
`,
    );
    const m = readManifest(dir);

    assert.deepEqual(m.ecosystems, ["rust"]);
    assert.equal(m.name, null, "workspace root without [package] -> name stays null");
    assert.equal(m.version, null, "version stays null too");
    assert.equal(m.rustVersion, "1.75", "rustVersion from [workspace.package]");
    assert.equal(m.edition, "2021", "edition from [workspace.package]");
    // Unioned member deps.
    assert.ok(
      "serde" in m.dependencies,
      `crate-a serde unioned: ${JSON.stringify(m.dependencies)}`,
    );
    assert.ok("tokio" in m.dependencies, "crate-b tokio unioned");
    assert.ok("rand" in m.dependencies, "crate-b rand unioned");
    assert.ok("anyhow" in m.dependencies, "[workspace.dependencies].anyhow merged");
    assert.ok(m.workspace && m.workspace.members.includes("crate-a"), "workspace members surfaced");
    assert.deepEqual(m.workspace.members, ["crate-a", "crate-b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: Rust [features] + [lib] + build-dependencies + edition/rust-version", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "Cargo.toml"),
      `
[package]
name = "featlib"
version = "0.3.0"
edition = "2021"
rust-version = "1.74"

[features]
default = ["std"]
std = []
async = ["dep:tokio"]

[lib]
name = "featlib_core"
path = "src/lib.rs"
crate-type = ["cdylib", "rlib"]

[dependencies]
flate2 = "1.0"

[build-dependencies]
cc = "1.0"
`,
    );
    const m = readManifest(dir);

    assert.equal(m.edition, "2021", "edition captured");
    assert.equal(m.rustVersion, "1.74", "rustVersion (MSRV) captured");
    assert.ok(
      "default" in m.features && "std" in m.features && "async" in m.features,
      "features captured",
    );
    assert.deepEqual(m.features.default, ["std"], "feature list preserved");
    assert.ok(m.lib && m.lib.name === "featlib_core", "[lib] info captured");
    assert.equal(m.crateType, "cdylib,rlib", "crate-type normalized to comma-joined string");
    assert.equal(m.buildDependencies.cc, "1.0", "build-dependencies captured in buildDependencies");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: PEP 735 [dependency-groups] -> devDependencies", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "dg-test"
version = "0.1.0"
dependencies = ["click>=8.0"]

[dependency-groups]
dev = ["pytest", "bandit", "atheris>=3.1.0; sys_platform == 'linux' and platform_machine == 'x86_64'"]
`,
    );
    const m = readManifest(dir);

    assert.ok("pytest" in m.devDependencies, "pytest from dependency-groups.dev");
    assert.ok("bandit" in m.devDependencies, "bandit from dependency-groups.dev");
    assert.ok(
      "atheris" in m.devDependencies,
      "atheris (marker stripped) from dependency-groups.dev",
    );
    assert.equal(m.devDependencies.pytest, "", "bare name -> empty spec");
    assert.equal(
      m.devDependencies.atheris,
      ">=3.1.0",
      "environment marker stripped, version spec kept",
    );
    assert.ok("click" in m.dependencies, "runtime deps still routed to dependencies");
    assert.ok(!("pytest" in m.dependencies), "dev group not leaked into dependencies");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: requirements.txt + requirements-dev.txt parsed into deps/devDeps", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "requirements.txt"),
      [
        "# runtime requirements",
        "requests>=2.31.0",
        "numpy==1.26.0",
        "",
        "-r requirements-extra.txt",
        "-e git+https://example.com/repo.git",
        "rich  # pretty output",
        "https://example.com/wheel.whl",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "requirements-dev.txt"),
      ["pytest>=7.0", "ruff  # linter", ""].join("\n"),
    );
    const m = readManifest(dir);

    assert.ok(m.ecosystems.includes("python"), "python ecosystem flagged by requirements presence");
    assert.ok(
      Object.keys(m.dependencies).length > 0,
      "dependencies non-empty from requirements.txt",
    );
    assert.ok("requests" in m.dependencies, "requests parsed");
    assert.ok("numpy" in m.dependencies, "numpy parsed");
    assert.ok("rich" in m.dependencies, "rich parsed after inline comment stripped");
    assert.ok(!("-r" in m.dependencies), "-r option line skipped");
    assert.ok(!("-e" in m.dependencies), "-e option line skipped");
    assert.equal(m.dependencies.requests, ">=2.31.0");
    assert.equal(m.dependencies.numpy, "==1.26.0");
    assert.equal(
      m.devDependencies.pytest,
      ">=7.0",
      "requirements-dev.txt routed to devDependencies",
    );
    assert.equal(m.devDependencies.ruff, "", "ruff parsed, inline comment stripped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readManifest: pyproject entry-points groups + gui-scripts captured", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "ep-test"
version = "0.1.0"

[project.gui-scripts]
gui-app = "ep_test.gui:main"

[project.entry-points."pytest11"]
myplugin = "ep_test.plugin"
`,
    );
    const m = readManifest(dir);
    assert.ok(
      m.entrypoints.some((e) => e === "gui-app=ep_test.gui:main"),
      `gui-scripts captured: ${JSON.stringify(m.entrypoints)}`,
    );
    assert.ok(
      m.entrypoints.some((e) => e === "pytest11/myplugin=ep_test.plugin"),
      `entry-points group captured: ${JSON.stringify(m.entrypoints)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
