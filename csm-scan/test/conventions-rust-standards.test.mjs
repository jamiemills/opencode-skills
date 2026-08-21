import { test } from "node:test";
import assert from "node:assert/strict";

import { withFixture } from "./harness.mjs";
import { scan } from "../lib/scan/deep/conventions.mjs";

async function rustStandards(name, files) {
  return withFixture(name, files, async (dir) => {
    const result = await scan(dir, {
      path: dir,
      languages: ["Rust"],
      ecosystems: { primary: "rust", all: ["rust"] },
      files: Object.keys(files),
    });
    return result.findings.languageStandards;
  });
}

test("Cargo.toml and Rust source alone imply no Rust tooling standards", async () => {
  const result = await rustStandards("rust-standards-cargo-only", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(!result.standards.includes("rustfmt (formatting)"));
  assert.ok(!result.standards.includes("clippy (linting)"));
});

test("rustfmt.toml implies rustfmt but not clippy", async () => {
  const result = await rustStandards("rust-standards-rustfmt", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    "rustfmt.toml": 'edition = "2021"\n',
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.standards.includes("rustfmt (formatting)"));
  assert.ok(!result.standards.includes("clippy (linting)"));
  assert.ok(result.inferred.includes("rustfmt.toml present"));
});

test("clippy.toml implies clippy but not rustfmt", async () => {
  const result = await rustStandards("rust-standards-clippy", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    "clippy.toml": 'msrv = "1.75"\n',
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(!result.standards.includes("rustfmt (formatting)"));
  assert.ok(result.standards.includes("clippy (linting)"));
  assert.ok(result.inferred.includes("clippy.toml present"));
});

test("CI cargo fmt and cargo clippy references imply both standards", async () => {
  const result = await rustStandards("rust-standards-ci", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/checks.yml": [
      "jobs:",
      "  checks:",
      "    steps:",
      "      - run: cargo fmt --check",
      "      - run: cargo clippy -- -D warnings",
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.deepEqual(
    result.standards.filter((item) => /rustfmt|clippy/.test(item)),
    ["rustfmt (formatting)", "clippy (linting)"],
  );
  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(result.inferred.includes("cargo clippy referenced"));
});

test("Rust tooling strings outside automation files do not imply standards", async () => {
  const result = await rustStandards("rust-standards-irrelevant", {
    "Cargo.toml":
      '[package]\nname = "demo"\nversion = "0.1.0"\ndescription = "cargo fmt and cargo clippy"\n',
    "README.md": "Run cargo fmt and cargo clippy before submitting.\n",
    "src/lib.rs":
      "// cargo fmt; cargo clippy; rustfmt; clippy-driver\npub fn value() -> u8 { 1 }\n",
  });

  assert.ok(!result.standards.includes("rustfmt (formatting)"));
  assert.ok(!result.standards.includes("clippy (linting)"));
  assert.deepEqual(
    result.inferred.filter((item) => /rustfmt|clippy/.test(item)),
    [],
  );
});

test("comment-only workflow, Makefile, and script do not imply Rust standards", async () => {
  const result = await rustStandards("rust-standards-comments", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml":
      "# cargo fmt is not used here\n# clippy-driver is not installed\n",
    Makefile: "# cargo clippy is intentionally absent\n# rustfmt is not configured\n",
    "scripts/check.sh": "#!/bin/sh\n# cargo fmt\n# cargo clippy\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.deepEqual(
    result.standards.filter((item) => /rustfmt|clippy/.test(item)),
    [],
  );
});

test("quoted commands and JS line comments do not imply Rust standards", async () => {
  const result = await rustStandards("rust-standards-quoted", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml":
      "name: \"cargo fmt and cargo clippy\"\nrun-name: 'clippy-driver and rustfmt'\n",
    "scripts/check.sh": 'message="cargo fmt"\nprintf "%s\\n" \'cargo clippy\'\n',
    "tasks/check.mjs": [
      'const url = "https://example.test/cargo/fmt";',
      "// cargo fmt",
      'const note = "clippy-driver"; // cargo clippy',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.deepEqual(
    result.standards.filter((item) => /rustfmt|clippy/.test(item)),
    [],
  );
});

test("executable YAML run commands remain Rust standard evidence", async () => {
  const result = await rustStandards("rust-standards-yaml-commands", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml":
      "steps:\n  - run: cargo fmt --check\n  - run: cargo clippy -- -D warnings\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(result.inferred.includes("cargo clippy referenced"));
});

test("double-quoted YAML run scalar remains rustfmt evidence", async () => {
  const result = await rustStandards("rust-standards-yaml-double-quote", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml": 'steps:\n  - run: "cargo fmt --check"\n',
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(!result.standards.includes("clippy (linting)"));
});

test("single-quoted YAML run scalar remains clippy evidence", async () => {
  const result = await rustStandards("rust-standards-yaml-single-quote", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml": "steps:\n  - run: 'cargo clippy -- -D warnings'\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(!result.standards.includes("rustfmt (formatting)"));
  assert.ok(result.inferred.includes("cargo clippy referenced"));
});

test("quoted YAML metadata and inline comments are not command evidence", async () => {
  const result = await rustStandards("rust-standards-yaml-inline-comments", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml": [
      'name: "cargo clippy"',
      "env:",
      '  TOOL: "clippy-driver"',
      "steps:",
      "  - run: echo checking # cargo clippy is not invoked",
      "  - run: cargo fmt --check # rustfmt formatting check",
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(!result.standards.includes("clippy (linting)"));
});

test("YAML block scalar run commands remain Rust standard evidence", async () => {
  const result = await rustStandards("rust-standards-yaml-block", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    ".github/workflows/check.yml":
      "steps:\n  - run: |\n      cargo fmt --check\n      cargo clippy -- -D warnings\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(result.inferred.includes("cargo clippy referenced"));
});

test("executable shell commands remain Rust standard evidence", async () => {
  const result = await rustStandards("rust-standards-shell-commands", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    "scripts/check.sh": "#!/bin/sh\ncargo fmt --check\nexec cargo clippy -- -D warnings\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("cargo fmt referenced"));
  assert.ok(result.inferred.includes("cargo clippy referenced"));
});

test("executable Make recipes remain Rust standard evidence", async () => {
  const result = await rustStandards("rust-standards-make-commands", {
    "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n',
    Makefile: "check:\n\t@rustfmt --check src/lib.rs\n\tclippy-driver --version\n",
    "src/lib.rs": "pub fn value() -> u8 { 1 }\n",
  });

  assert.ok(result.inferred.includes("rustfmt referenced"));
  assert.ok(result.inferred.includes("clippy-driver referenced"));
});
