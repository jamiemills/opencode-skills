import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isEnabled, findToggleFile, parseToggle } from "../scripts/lib/token-efficiency.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fx = (...parts) => join(root, "tests", "fixtures", "token-efficiency", ...parts);

test('parseToggle: valid {"enabled": true} and {"enabled": false} are ok', () => {
  assert.deepEqual(parseToggle('{"enabled": true}'), { enabled: true, ok: true });
  assert.deepEqual(parseToggle('{"enabled": false}'), { enabled: false, ok: true });
  assert.deepEqual(parseToggle('{"enabled": false}\n'), { enabled: false, ok: true });
});

test("parseToggle: malformed text, non-object JSON, and non-boolean values all default to disabled", () => {
  assert.deepEqual(parseToggle("{ this is not json"), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("true"), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('{"enabled": "yes"}'), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('{"enabled": 1}'), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("{}"), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("null"), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("[1, 2]"), { enabled: false, ok: false });
});

test("parseToggle: empty, whitespace, uppercase, JSONC, trailing-comma, and BOM forms all default to disabled (strict JSON, documented)", () => {
  assert.deepEqual(parseToggle(""), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("   \n\t "), { enabled: false, ok: false });
  assert.deepEqual(parseToggle("TRUE"), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('// comment\n{"enabled": false}'), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('{"enabled": false,}'), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('\uFEFF{"enabled": false}'), { enabled: false, ok: false });
  assert.deepEqual(parseToggle('{"enabled": true} extra'), { enabled: false, ok: false });
});

test("absent toggle file -> disabled with no source and no warning (default off)", () => {
  const eff = isEnabled(fx("absent", "work"));
  assert.equal(eff.enabled, false);
  assert.equal(eff.source, null);
  assert.equal(eff.warning, null);
  assert.equal(findToggleFile(fx("absent", "work")), null);
});

test('{"enabled": true} -> enabled, source points at the toggle file', () => {
  const eff = isEnabled(fx("enabled", "work"));
  assert.equal(eff.enabled, true);
  assert.equal(eff.warning, null);
  assert.equal(
    findToggleFile(fx("enabled", "work")),
    join(fx("enabled"), ".agents", "token-efficiency.json"),
  );
});

test('{"enabled": false} -> disabled with source and no warning', () => {
  const eff = isEnabled(fx("disabled", "work"));
  assert.equal(eff.enabled, false);
  assert.equal(eff.warning, null);
});

test("malformed JSON -> disabled (default off) with a warning", () => {
  const eff = isEnabled(fx("malformed", "work"));
  assert.equal(eff.enabled, false);
  assert.match(eff.warning, /malformed|non-boolean|default off/);
  assert.match(eff.warning, /token-efficiency\.json/);
});

test("nearest-wins walk-up: a nested subdir toggle overrides the parent", () => {
  const eff = isEnabled(fx("nested", "sub", "work"));
  assert.equal(eff.enabled, false);
  assert.equal(eff.source, join(fx("nested", "sub"), ".agents", "token-efficiency.json"));
});

test("a subdir without its own toggle inherits the nearest toggle above it", () => {
  const eff = isEnabled(fx("inherited", "sub", "work"));
  assert.equal(eff.enabled, false);
  assert.equal(eff.source, join(fx("inherited"), ".agents", "token-efficiency.json"));
});

test("the .git-as-DIRECTORY boundary stops the walk (no leakage past it)", () => {
  const base = fs.mkdtempSync(join(fx(), ".gitdir-test-"));
  try {
    fs.mkdirSync(join(base, ".agents"), { recursive: true });
    fs.mkdirSync(join(base, "sub", "work"), { recursive: true });
    fs.mkdirSync(join(base, "sub", ".git"), { recursive: true });
    fs.writeFileSync(join(base, ".agents", "token-efficiency.json"), '{"enabled": false}');
    fs.writeFileSync(join(base, "sub", "work", ".keep"), "");
    const eff = isEnabled(join(base, "sub", "work"));
    assert.equal(
      eff.enabled,
      false,
      "a toggle ABOVE a .git-dir boundary must not be seen (default off)",
    );
    assert.equal(eff.source, null);
    fs.mkdirSync(join(base, "sub", ".agents"), { recursive: true });
    fs.writeFileSync(join(base, "sub", ".agents", "token-efficiency.json"), '{"enabled": false}');
    const inside = isEnabled(join(base, "sub", "work"));
    assert.equal(inside.enabled, false, "a toggle INSIDE the boundary is found");
    assert.equal(inside.source, join(base, "sub", ".agents", "token-efficiency.json"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
