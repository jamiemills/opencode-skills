import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { expandMapping, payloadData, skillManifest } from "../scripts/pack-bootstrap.mjs";

const root = join(import.meta.dirname, "..");
const guidanceFiles = ["AGENTS.md", "csm-plan/SKILL.md", "csm-build/SKILL.md"];
const requiredGuidance = [
  /re-read the full current target file immediately before patching/i,
  /never use truncated output as patch context/i,
  /use stable anchors and small conceptual hunks/i,
  /if `apply_patch` rejects expected lines, do not guess, fuzzy-match, or overwrite/i,
  /re-read the current file, inspect concurrent or formatter changes, and retry with a fresh smaller patch/i,
  /preserve exact-context failure semantics/i,
];

function visibleText(text) {
  let fenced = false;
  return text
    .split("\n")
    .filter((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .join("\n");
}

function assertPatchGuidance(text, label) {
  const visible = visibleText(text);
  assert.doesNotMatch(
    visible,
    /(?:use|allow|retry with|fall back to|accept)\s+(?:fuzzy(?:-|\s)?match(?:ing)?|overwrite)/i,
    `${label}: permissive fuzzy-match/overwrite guidance is not allowed`,
  );
  for (const marker of requiredGuidance) {
    assert.match(visible, marker, `${label}: required patch guidance is missing`);
  }
}

test("patch guidance is visible and fail-closed", async () => {
  for (const relativePath of guidanceFiles) {
    assertPatchGuidance(await readFile(join(root, relativePath), "utf8"), relativePath);
  }
});

test("contract rejects permissive fuzzy-match and overwrite wording", () => {
  assert.throws(
    () => assertPatchGuidance("Use fuzzy matching when the expected context changes.", "fuzzy"),
    /permissive fuzzy-match\/overwrite/,
  );
  assert.throws(
    () => assertPatchGuidance("Allow overwrite when applying a patch.", "overwrite"),
    /permissive fuzzy-match\/overwrite/,
  );
  assert.throws(
    () => assertPatchGuidance("Fall back to fuzzy matching after a context error.", "fallback"),
    /permissive fuzzy-match\/overwrite/,
  );
});

test("packaged skill guidance stays byte-identical to mapped root guidance", async () => {
  const entries = (await expandMapping()).filter(({ src }) =>
    skillManifest.skills.some((skill) => src === `${skill}/SKILL.md`),
  );
  assert.ok(entries.length > 0, "no packaged skill guidance was found in the mapping");
  for (const entry of entries) {
    const source = await readFile(join(root, entry.src));
    const packaged = await readFile(join(root, "bootstrap", "package", entry.dest));
    assert.deepEqual(packaged, payloadData(source, entry.dest), `${entry.src} payload drift`);
  }
});
