import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const skill = readFileSync(resolve(ROOT, "csm-deep-research/SKILL.md"), "utf8");

test("csm-deep-research does not claim pipeline states it does not have", () => {
  assert.ok(
    !skill.includes("BLOCKED -> RECOVER -> VALIDATE"),
    "the pipeline has no RECOVER/VALIDATE states",
  );
  assert.match(skill, /VERIFY -> SAVED/);
});

test("the research marker names the JSON schema authority", () => {
  const schema = JSON.parse(
    readFileSync(resolve(ROOT, "csm-deep-research/schemas/csm-research.schema.json"), "utf8"),
  );
  assert.equal(schema.$id, "csm-research/1");
  assert.match(skill, /schema: csm-research\/1/);
});
