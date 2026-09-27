import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

test("csm-scan documents the NORMS.json authority, not a phantom .agents/norms path", () => {
  const skill = read("csm-scan/SKILL.md");
  const contracts = read("scripts/lib/contracts.mjs");
  const descriptor = JSON.parse(read("csm-scan/norms-producer.json"));
  assert.equal(descriptor.canonicalPath, "NORMS.json");
  assert.ok(!/\.agents\/norms/.test(skill), "SKILL must not claim the .agents/norms path");
  assert.ok(!/\.agents\/norms/.test(contracts), "contracts must not claim the .agents/norms path");
  assert.match(skill, /NORMS\.json/);
  assert.match(contracts, /NORMS\.json/);
});

test("the csm-scan CLI default matches the documented output", () => {
  assert.match(read("csm-scan/scripts/scan.mjs"), /join\(cwd, "NORMS\.json"\)/);
});
