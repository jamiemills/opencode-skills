import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createBddPackage, validateBddPackage } from "../csm-bdd-tdd/lib/package.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(resolve(ROOT, "csm-bdd-tdd/SKILL.md"), "utf8");

test("csm-bdd-tdd's pipeline names the writer and the machine package it promises", () => {
  assert.match(skill, /specs\/<goal-slug>\/package\.json/);
  assert.match(skill, /createBddPackage/);
  assert.match(skill, /writeBddPackage/);
  assert.match(skill, /package\.schema\.json/);
});

test("createBddPackage emits a package validateBddPackage accepts (incl. a /2 source plan)", () => {
  assert.equal(validateBddPackage(createBddPackage()).valid, true);
  const fromV2 = createBddPackage({
    sourcePlan: {
      artifactId: "art-plan",
      runId: "run-plan",
      schema: "csm-plan/2",
      path: ".agents/plans/x-csm.json",
      digest: `sha256:${"0".repeat(64)}`,
    },
  });
  assert.equal(validateBddPackage(fromV2).valid, true);
});
