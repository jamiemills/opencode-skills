import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseToml, parseYamlShallow } from "../lib/scan/shared/parse.mjs";
import { resolveRealRepo } from "./helpers/real-repo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// T010 (F-007): the real pyproject.toml resolves from CSM_SCAN_REAL_REPO or
// the checked-in pxcli-mini fallback fixture, whose pyproject.toml carries the
// same declared sections under test (this used to be an unguarded read of a
// hardcoded author path — a hard suite failure on any other machine).
const RESOLVED_REAL = resolveRealRepo();
const REAL_PYPROJECT =
  RESOLVED_REAL.repo === null ? null : join(RESOLVED_REAL.repo, "pyproject.toml");

// ---------------------------------------------------------------------------
// TOML: synthetic pyproject-style document exercising every required construct
// ---------------------------------------------------------------------------

const SYNTHETIC_PYPROJECT = `# leading comment
[build-system]
requires = ["hatchling"]      # inline comment after value
build-backend = "hatchling.build"

[project]
name = "demo"
version = "1_000.0"            # not a real version; tests int-with-underscore parsing path is separate
description = """multi
line"""
requires-python = ">=3.12"
keywords = ["cli", "demo"]
dependencies = [
    "click>=8.0",     # comment inside array
    "rich>=13.0",
    "httpx>=0.25",
]
dynamic = false

[project.scripts]
demo = "demo.cli:main"

[project.urls]
Homepage = "https://example.com"
"Bug Tracker" = "https://example.com/bugs"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.setuptools.packages.find]
where = ["src"]
`;

test("parseToml: synthetic pyproject produces expected structure", () => {
  const p = parseToml(SYNTHETIC_PYPROJECT);

  assert.equal(p["build-system"].buildBackend, undefined, "build-backend key is name as written");
  assert.equal(p["build-system"]["build-backend"], "hatchling.build");
  assert.deepEqual(p["build-system"].requires, ["hatchling"]);

  assert.equal(p.project.name, "demo");
  assert.equal(p.project["requires-python"], ">=3.12");
  assert.equal(p.project.dynamic, false, "boolean value");
  assert.equal(p.project.description, "multi\nline", "multi-line basic string with newline");
  assert.deepEqual(p.project.keywords, ["cli", "demo"]);
  assert.deepEqual(
    p.project.dependencies,
    ["click>=8.0", "rich>=13.0", "httpx>=0.25"],
    "multiline array of strings with inline comments and trailing comma",
  );

  assert.deepEqual(p.project.scripts, { demo: "demo.cli:main" });
  assert.deepEqual(
    p.project.urls,
    {
      Homepage: "https://example.com",
      "Bug Tracker": "https://example.com/bugs",
    },
    "quoted keys are honored",
  );

  assert.equal(p.tool.ruff["line-length"], 100, "integer (and dashed bare key)");
  assert.equal(p.tool.ruff["target-version"], "py312");
  assert.deepEqual(
    p.tool.setuptools.packages.find.where,
    ["src"],
    "inline table inside dotted path",
  );
});

// ---------------------------------------------------------------------------
// TOML: synthetic Cargo.toml
// ---------------------------------------------------------------------------

const SYNTHETIC_CARGO = `[package]
name = "mycrate"
version = "0.2.0"
description = 'a literal-string description'
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"
rand = "0.8"

[dev-dependencies]
proptest = "1.0"

[[bin]]
name = "mycli"
path = "src/bin/cli.rs"

[[bin]]
name = "worker"
path = "src/bin/worker.rs"
`;

test("parseToml: synthetic Cargo.toml [package] + [dependencies] + [[bin]]", () => {
  const p = parseToml(SYNTHETIC_CARGO);

  assert.equal(p.package.name, "mycrate");
  assert.equal(p.package.version, "0.2.0");
  assert.equal(p.package.description, "a literal-string description");
  assert.equal(p.package.edition, "2021");

  assert.deepEqual(
    p.dependencies.serde,
    { version: "1.0", features: ["derive"] },
    "inline table with array value",
  );
  assert.equal(p.dependencies.tokio, "1");
  assert.equal(p.dependencies.rand, "0.8");
  assert.equal(p["dev-dependencies"].proptest, "1.0");

  assert.ok(Array.isArray(p.bin), "array-of-tables header produces an array");
  assert.equal(p.bin.length, 2);
  assert.equal(p.bin[0].name, "mycli");
  assert.equal(p.bin[0].path, "src/bin/cli.rs");
  assert.equal(p.bin[1].name, "worker");
});

// ---------------------------------------------------------------------------
// TOML: int/float/bool/date subset
// ---------------------------------------------------------------------------

test("parseToml: scalar value subset", () => {
  const p = parseToml(`
ints = [1_000, -42, 0]
floats = [3.14, -0.5, 1e9]
bools = [true, false]
date = 2024-01-15
datetime = 2024-01-15T10:30:00Z
hex = 0xFF
arr_inline = [1, 2, 3]
inline_table = { a = 1, b = "x", c = true }
`);
  assert.deepEqual(p.ints, [1000, -42, 0]);
  assert.deepEqual(p.floats, [3.14, -0.5, 1e9]);
  assert.deepEqual(p.bools, [true, false]);
  assert.equal(p.date, "2024-01-15");
  assert.equal(p.datetime, "2024-01-15T10:30:00Z");
  assert.equal(p.hex, 255);
  assert.deepEqual(p.arr_inline, [1, 2, 3]);
  assert.deepEqual(p.inline_table, { a: 1, b: "x", c: true });
});

// ---------------------------------------------------------------------------
// TOML: THROW on unsupported / invalid construct
// Chosen case: DUPLICATE KEY in the same table.
// This is explicitly INVALID per the TOML spec (section "Inline Tables" /
// "Keys" — keys must be unique within their table). Silent acceptance would
// let one dep silently shadow another, so we throw.
// ---------------------------------------------------------------------------

test("parseToml: throws on duplicate key in the same table", () => {
  const dupKeyToml = `[project]
name = "a"
name = "b"`;
  assert.throws(
    () => parseToml(dupKeyToml),
    /duplicate key "name"/,
    "duplicate bare key must throw",
  );
});

test("parseToml: throws on duplicate key via dotted path", () => {
  assert.throws(() => parseToml("a.b = 1\na.b = 2"), /duplicate key "b"/);
});

// ---------------------------------------------------------------------------
// TOML: parses the REAL perplexity-cli pyproject.toml
// ---------------------------------------------------------------------------

test("parseToml: real perplexity-cli pyproject.toml parses without throwing", (t) => {
  if (REAL_PYPROJECT === null) {
    t.skip(`CSM_SCAN_REAL_REPO is set but does not exist: ${RESOLVED_REAL.missing}`);
    return;
  }
  const text = readFileSync(REAL_PYPROJECT, "utf-8");
  const p = parseToml(text);

  // Required sections exist with expected shape
  assert.equal(p.project.name, "pxcli");
  assert.equal(p.project.version, "0.7.1");
  assert.equal(p.project["requires-python"], ">=3.12");
  assert.ok(Array.isArray(p.project.dependencies), "dependencies is an array");

  // Record the parsed dependencies array as evidence
  const deps = p.project.dependencies;
  assert.ok(
    deps.includes("click>=8.0"),
    `expected 'click>=8.0' in deps, got ${JSON.stringify(deps)}`,
  );
  assert.ok(
    deps.some((d) => d.startsWith("click")),
    'a dependency starting with "click" must be present',
  );

  // Other sections required by the spike
  assert.equal(p["build-system"]["build-backend"], "setuptools.build_meta");
  assert.equal(p.tool.ruff["line-length"], 100);
  assert.equal(p.tool.ruff["target-version"], "py312");
  assert.deepEqual(p.tool.pytest.ini_options.testpaths, ["tests"]);
  assert.deepEqual(p.tool.setuptools.packages.find.where, ["src"]);
});

// ---------------------------------------------------------------------------
// YAML: nesting + block sequence + inline flow
// ---------------------------------------------------------------------------

const YAML_FIXTURE = `name: lefthook
on:
  push:
    branches: [main, dev]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Lint
        run: make lint
config:
  mapping: {a: 1, b: 2}
  list: [x, y, z]
  flag: true
  empty: null
  version: '1.2.3'
`;

test("parseYamlShallow: nesting + block sequence + inline flow", () => {
  const y = parseYamlShallow(YAML_FIXTURE);
  assert.equal(y.name, "lefthook");
  assert.deepEqual(y.on.push.branches, ["main", "dev"]);
  assert.deepEqual(y.config.mapping, { a: 1, b: 2 });
  assert.deepEqual(y.config.list, ["x", "y", "z"]);
  assert.equal(y.config.flag, true);
  assert.equal(y.config.empty, null);
  assert.equal(y.config.version, "1.2.3", "single-quoted scalar stays a string");

  assert.deepEqual(y.jobs.lint.steps, [
    { name: "Checkout", uses: "actions/checkout@v4" },
    { name: "Lint", run: "make lint" },
  ]);
});

// ---------------------------------------------------------------------------
// YAML: THROW cases (anchors + block scalars)
// ---------------------------------------------------------------------------

test("parseYamlShallow: throws on anchor", () => {
  assert.throws(() => parseYamlShallow("foo: &anchor value"), /anchors\/aliases are not supported/);
});

test("parseYamlShallow: throws on alias", () => {
  assert.throws(() => parseYamlShallow("foo: *alias"), /anchors\/aliases are not supported/);
});

test("parseYamlShallow: throws on block scalar indicator", () => {
  assert.throws(() => parseYamlShallow("script: |\n  echo hi"), /block scalars/);
});

test("parseYamlShallow: comments are stripped, not inside quotes", () => {
  const y = parseYamlShallow(`
a: 1 # trailing comment
b: "value # not a comment"
c: 'another # not a comment'
`);
  assert.deepEqual(y, { a: 1, b: "value # not a comment", c: "another # not a comment" });
});
