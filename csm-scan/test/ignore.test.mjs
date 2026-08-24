import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IGNORE_DIRS,
  IGNORE_NAME_GLOBS,
  rgIgnoreArgs,
  isIgnoredPath,
} from "../lib/scan/shared/ignore.mjs";

test("IGNORE_DIRS has >20 entries including all required", () => {
  assert.ok(IGNORE_DIRS.length > 20, `expected >20 dirs, got ${IGNORE_DIRS.length}`);
  const required = [
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".import_linter_cache",
    ".hypothesis",
    ".tox",
    ".nox",
    ".eggs",
    "htmlcov",
    "dist",
    "build",
    ".next",
    "target",
    "coverage",
    ".cache",
    ".nyc_output",
    ".dart_tool",
    ".gradle",
  ];
  for (const d of required) {
    assert.ok(IGNORE_DIRS.includes(d), `missing required dir: ${d}`);
  }
});

test("IGNORE_NAME_GLOBS excludes binary lock but not real lockfiles", () => {
  assert.ok(IGNORE_NAME_GLOBS.includes("*.lockb"));
  assert.ok(!IGNORE_NAME_GLOBS.some((g) => g.includes("uv.lock")));
  assert.ok(!IGNORE_NAME_GLOBS.some((g) => g.includes("package-lock")));
});

test("rgIgnoreArgs returns non-empty array of --glob ! entries", () => {
  const args = rgIgnoreArgs();
  assert.ok(Array.isArray(args));
  assert.ok(args.length > 0);
  for (const a of args) {
    assert.ok(a.startsWith("--glob !"), `bad entry: ${JSON.stringify(a)}`);
  }
});

test("isIgnoredPath detects cache dirs and source files", () => {
  assert.equal(isIgnoredPath("foo/.hypothesis/constants/x"), true);
  assert.equal(isIgnoredPath("src/pkg/mod.py"), false);
});

test("isIgnoredPath treats real lockfiles as kept, binary lockb as ignored", () => {
  assert.equal(isIgnoredPath("repo/uv.lock"), false, "uv.lock must NOT be ignored");
  assert.equal(isIgnoredPath("repo/bun.lockb"), true, "bun.lockb must be ignored");
});

test("F3-07 removes the unused find-shaped prune export", async () => {
  const module = await import("../lib/scan/shared/ignore.mjs");
  assert.equal("findPruneArgs" in module, false);
});
