"use strict";

// T010: template-preserving capabilities digest regenerator contract tests.
// (i) A regen at a fresh manifest is a byte-identical no-op (git diff clean).
// (ii) After a SKILL.md byte change the regen updates only that skill's
//      digest + contentDigest and the loader accepts the result.
// (iii) A stale digest is caught by capabilities.mjs validation (the same rule
//       check-suite's capability-freshness check enforces).
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCapabilities } from "../scripts/gen-capabilities.mjs";
import { validateCapabilities } from "../csm-orchestrate/lib/capabilities.mjs";
import { digest } from "../lib/schema-runtime/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(root, "csm-orchestrate", "capabilities.json");

test("gen-capabilities: a regen at a fresh manifest is byte-identical (no-op diff)", async () => {
  const current = await readFile(MANIFEST_PATH, "utf8");
  const { text, changedDigests } = await buildCapabilities();
  assert.equal(text, current, "template regen must not change a fresh manifest");
  assert.deepEqual(changedDigests, []);
});

test("gen-capabilities: a SKILL.md byte change updates only that digest and contentDigest", async () => {
  const skillPath = join(root, "csm-build", "SKILL.md");
  const original = await readFile(skillPath, "utf8");
  try {
    const before = await buildCapabilities();
    const originalBuildDigest = before.manifest.skills.find(
      (capability) => capability.skill === "csm-build",
    ).digest;
    await writeFile(skillPath, `${original}\n`);
    const { manifest, changedDigests } = await buildCapabilities();
    const changedSkills = changedDigests.map((entry) => entry.skill);
    assert.deepEqual(
      changedSkills.filter((skill) => skill !== "csm-build" && skill !== "(contentDigest)"),
      [],
      "only the edited skill's digest (plus contentDigest) may change",
    );
    assert.ok(changedSkills.includes("csm-build"));
    assert.ok(changedSkills.includes("(contentDigest)"));
    const csmBuild = manifest.skills.find((capability) => capability.skill === "csm-build");
    assert.notEqual(
      csmBuild.digest,
      originalBuildDigest,
      "digest recomputed from the changed bytes",
    );
    await validateCapabilities(manifest, { verifySources: true });
  } finally {
    await writeFile(skillPath, original);
  }
});

test("gen-capabilities: a stale digest is caught by the loader (capability-freshness parity)", async () => {
  const { manifest } = await buildCapabilities();
  const stale = JSON.parse(JSON.stringify(manifest));
  stale.skills[0].digest = `sha256:${"0".repeat(64)}`;
  stale.contentDigest = digest(stale.skills);
  await assert.rejects(
    () => validateCapabilities(stale, { verifySources: true }),
    /source digest mismatch/,
  );
  const repaired = await buildCapabilities();
  assert.equal(repaired.manifest.skills[0].digest, manifest.skills[0].digest);
});
