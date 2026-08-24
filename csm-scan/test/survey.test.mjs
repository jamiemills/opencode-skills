import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withFixture } from "./harness.mjs";
import { survey } from "../lib/scan/survey.mjs";
import { files as pythonFiles } from "./fixtures/python.mjs";
import { files as jsFiles } from "./fixtures/javascript.mjs";

const surveySrcPath = fileURLToPath(new URL("../lib/scan/survey.mjs", import.meta.url));

function expectedBytes(fixtureFiles, skip) {
  let total = 0;
  for (const [rel, content] of Object.entries(fixtureFiles)) {
    if (skip && skip(rel)) continue;
    total += Buffer.byteLength(content);
  }
  return total;
}

test("survey: python fixture -> uv, Python, real bytes, files, ecosystems, manifest", async () => {
  const UVLOCK = 'version = 1\n\n[[package]]\nname = "demo"\nversion = "0.1.0"\n';
  const fixtureFiles = { ...pythonFiles, "uv.lock": UVLOCK };

  await withFixture("py", fixtureFiles, async (dir) => {
    const ov = await survey(dir);

    assert.equal(ov.packageManager, "uv", `packageManager=${ov.packageManager}`);
    assert.equal(ov.languages[0], "Python", `languages=${JSON.stringify(ov.languages)}`);

    const expected = expectedBytes(fixtureFiles, (rel) => rel.startsWith(".hypothesis/"));
    assert.equal(ov.totalBytes, expected, "totalBytes must equal real byte sum");
    assert.notEqual(
      ov.totalBytes,
      ov.totalFiles * 1000,
      "totalBytes must not be the fabricated estimate",
    );

    assert.ok(Array.isArray(ov.files) && ov.files.length > 0, "files must be a non-empty array");
    assert.ok((ov.extCounts[".py"] || 0) >= 2, `extCounts['.py']>=2, got ${ov.extCounts[".py"]}`);

    assert.equal(ov.ecosystems.primary, "python", `ecosystems.primary=${ov.ecosystems.primary}`);
    assert.ok(ov.manifest, "manifest must be exposed");
    assert.equal(ov.manifest.name, "demo", `manifest.name=${ov.manifest && ov.manifest.name}`);
    assert.equal(ov.name, "demo", "overview name should resolve from manifest");
  });
});

test("survey: javascript fixture with package-lock.json -> npm", async () => {
  const LOCK = JSON.stringify({ name: "demo", lockfileVersion: 3, packages: {} }, null, 2) + "\n";
  const fixtureFiles = { ...jsFiles, "package-lock.json": LOCK };

  await withFixture("js", fixtureFiles, async (dir) => {
    const ov = await survey(dir);

    assert.ok(
      ["npm", "yarn", "pnpm", "bun"].includes(ov.packageManager),
      `packageManager should be a JS family tool, got ${ov.packageManager}`,
    );
    assert.equal(ov.packageManager, "npm", `forced via package-lock.json -> ${ov.packageManager}`);
    assert.ok(ov.languages.includes("JavaScript"), `languages=${JSON.stringify(ov.languages)}`);
  });
});

test("survey: javascript fixture without a lockfile falls back to unknown", async () => {
  await withFixture("js-nolock", jsFiles, async (dir) => {
    const ov = await survey(dir);
    assert.equal(ov.packageManager, "unknown", `no lockfile -> unknown, got ${ov.packageManager}`);
  });
});

test("survey: preserves required return keys and exposes new keys", async () => {
  const fixtureFiles = { ...pythonFiles, "uv.lock": "version = 1\n" };
  await withFixture("keys", fixtureFiles, async (dir) => {
    const ov = await survey(dir);
    for (const k of [
      "path",
      "gitRoot",
      "isGit",
      "name",
      "description",
      "languages",
      "languageScores",
      "packageManager",
      "totalFiles",
      "totalBytes",
    ]) {
      assert.ok(k in ov, `preserved key missing: ${k}`);
    }
    for (const k of ["files", "extCounts", "ecosystems", "manifest"]) {
      assert.ok(k in ov, `new key missing: ${k}`);
    }
    assert.equal(typeof ov.totalFiles, "number");
    assert.equal(typeof ov.totalBytes, "number");
  });
});

test("survey: source contains no host-leak shell-outs (test -f / node --version)", () => {
  const src = readFileSync(surveySrcPath, "utf-8");
  assert.ok(!src.includes("test -f"), "survey.mjs must not shell out to `test -f`");
  assert.ok(!src.includes("node --version"), "survey.mjs must not leak `node --version`");
});

test("F3-07 removes the unused detectLanguages export", async () => {
  const module = await import("../lib/scan/survey.mjs");
  assert.equal("detectLanguages" in module, false);
});
