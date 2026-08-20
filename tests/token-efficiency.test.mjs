import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isEnabled, findToggleFile, parseToggle } from '../scripts/lib/token-efficiency.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fx = (...parts) => join(root, 'tests', 'fixtures', 'token-efficiency', ...parts);

test('parseToggle: valid {"enabled": true} and {"enabled": false} are ok', () => {
  assert.deepEqual(parseToggle('{"enabled": true}'), { enabled: true, ok: true });
  assert.deepEqual(parseToggle('{"enabled": false}'), { enabled: false, ok: true });
  assert.deepEqual(parseToggle('{"enabled": false}\n'), { enabled: false, ok: true });
});

test('parseToggle: malformed text, non-object JSON, and non-boolean values all fail closed to enabled', () => {
  assert.deepEqual(parseToggle('{ this is not json'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('true'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('{"enabled": "yes"}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('{"enabled": 1}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('{}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('null'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('[1, 2]'), { enabled: true, ok: false });
});

test('parseToggle: empty, whitespace, uppercase, JSONC, trailing-comma, and BOM forms all fail closed to enabled (strict JSON, documented)', () => {
  assert.deepEqual(parseToggle(''), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('   \n\t '), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('TRUE'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('// comment\n{"enabled": false}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('{"enabled": false,}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('\uFEFF{"enabled": false}'), { enabled: true, ok: false });
  assert.deepEqual(parseToggle('{"enabled": true} extra'), { enabled: true, ok: false });
});

test('absent toggle file -> enabled with no source and no warning', () => {
  const eff = isEnabled(fx('absent', 'work'));
  assert.equal(eff.enabled, true);
  assert.equal(eff.source, null);
  assert.equal(eff.warning, null);
  assert.equal(findToggleFile(fx('absent', 'work')), null);
});

test('{"enabled": true} -> enabled, source points at the toggle file', () => {
  const eff = isEnabled(fx('enabled', 'work'));
  assert.equal(eff.enabled, true);
  assert.equal(eff.warning, null);
  assert.equal(findToggleFile(fx('enabled', 'work')), join(fx('enabled'), '.agents', 'token-efficiency.json'));
});

test('{"enabled": false} -> disabled with source and no warning', () => {
  const eff = isEnabled(fx('disabled', 'work'));
  assert.equal(eff.enabled, false);
  assert.equal(eff.warning, null);
});

test('malformed JSON -> enabled (fail-closed) with a warning', () => {
  const eff = isEnabled(fx('malformed', 'work'));
  assert.equal(eff.enabled, true);
  assert.match(eff.warning, /malformed|non-boolean|fail-closed/);
  assert.match(eff.warning, /token-efficiency\.json/);
});

test('nearest-wins walk-up: a nested subdir toggle overrides the parent', () => {
  const eff = isEnabled(fx('nested', 'sub', 'work'));
  assert.equal(eff.enabled, false);
  assert.equal(eff.source, join(fx('nested', 'sub'), '.agents', 'token-efficiency.json'));
});

test('a subdir without its own toggle inherits the nearest toggle above it', () => {
  const eff = isEnabled(fx('inherited', 'sub', 'work'));
  assert.equal(eff.enabled, false);
  assert.equal(eff.source, join(fx('inherited'), '.agents', 'token-efficiency.json'));
});

test('the .git-as-DIRECTORY boundary stops the walk (no leakage past it)', () => {
  const base = fs.mkdtempSync(join(fx(), '.gitdir-test-'));
  try {
    fs.mkdirSync(join(base, '.agents'), { recursive: true });
    fs.mkdirSync(join(base, 'sub', 'work'), { recursive: true });
    fs.mkdirSync(join(base, 'sub', '.git'), { recursive: true });
    fs.writeFileSync(join(base, '.agents', 'token-efficiency.json'), '{"enabled": false}');
    fs.writeFileSync(join(base, 'sub', 'work', '.keep'), '');
    const eff = isEnabled(join(base, 'sub', 'work'));
    assert.equal(eff.enabled, true, 'a toggle ABOVE a .git-dir boundary must not be seen');
    assert.equal(eff.source, null);
    fs.mkdirSync(join(base, 'sub', '.agents'), { recursive: true });
    fs.writeFileSync(join(base, 'sub', '.agents', 'token-efficiency.json'), '{"enabled": false}');
    const inside = isEnabled(join(base, 'sub', 'work'));
    assert.equal(inside.enabled, false, 'a toggle INSIDE the boundary is found');
    assert.equal(inside.source, join(base, 'sub', '.agents', 'token-efficiency.json'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
