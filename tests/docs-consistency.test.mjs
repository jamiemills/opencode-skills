import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const registryEntries = JSON.parse(read("schemas/registry.json")).entries.length;

test("config-inventory registry count matches the live registry", () => {
  const doc = read("docs/config-inventory.md");
  assert.ok(!/\b57[- ]entry\b|\b57 entries\b/.test(doc), "the stale 57-entry count remains");
  assert.ok(doc.includes(`${registryEntries} entries`), `must state ${registryEntries} entries`);
});

test("config-inventory no longer denies the existing config resolver", () => {
  const doc = read("docs/config-inventory.md");
  assert.ok(
    !/no suite-wide configuration loader, no `\.csm-skills\.json`/.test(doc),
    "the false 'no .csm-skills.json consumer' claim remains",
  );
  assert.match(doc, /trace-config\.mjs/);
});

test("enforcement-evaluator-spike names a script that exists", () => {
  const doc = read("docs/enforcement-evaluator-spike.md");
  assert.ok(!doc.includes("scripts/loop-guard.mjs"), "names a nonexistent script");
  assert.match(doc, /csm-build\/lib\/loop-guard\.mjs/);
  assert.ok(
    existsSync(resolve(ROOT, "csm-build/lib/loop-guard.mjs")),
    "the named script must exist",
  );
});

test("config-inventory does not mislabel csm-ddd caps as a host ceiling", () => {
  const doc = read("docs/config-inventory.md");
  assert.ok(
    !/\*\*host ceiling\*\*; CLI can only shrink/.test(doc),
    "the false narrow-only host-ceiling claim remains",
  );
  assert.ok(!/Narrow-only scan caps mirroring `DEFAULT_LIMITS`/.test(doc));
  assert.match(doc, /overridable up to the schema `maximum`/);
});

test("typed-decisions does not call the registered enforcement ids unregistered", () => {
  const doc = read("docs/typed-decisions.md");
  assert.ok(
    !/none is registered in\s+`schemas\/registry\.json`/.test(doc),
    "the stale 'none is registered' line remains",
  );
});

test("Makefile .PHONY lists the documented test targets", () => {
  const phony = (read("Makefile").match(/^\.PHONY:.*$/m) ?? [""])[0];
  for (const target of [
    "test-osv-audit",
    "test-progress-tracker",
    "regen-check",
    "test-decision-live-parity",
  ]) {
    assert.ok(phony.includes(target), `.PHONY must list ${target}`);
  }
});
