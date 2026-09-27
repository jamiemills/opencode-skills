import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAYLOAD = "bootstrap/package/payload/skills/csm-browse";

test("csm-browse ships guidance-only (no scripts, no package.json, no deps)", () => {
  const entries = readdirSync(resolve(ROOT, PAYLOAD)).toSorted();
  assert.deepEqual(entries, ["SKILL.md", "lib", "schemas"], `${PAYLOAD} must be guidance-only`);
});

test("pack-bootstrap declares exactly the lib + schemas trees for csm-browse", () => {
  const packer = readFileSync(resolve(ROOT, "scripts/pack-bootstrap.mjs"), "utf8");
  assert.match(packer, /join\("csm-browse", "lib"\)/);
  assert.match(packer, /join\("csm-browse", "schemas"\)/);
  assert.doesNotMatch(packer, /"csm-browse",\s*"scripts"/);
});

test("no csm-browse doc hardcodes a $HOME path (source or payload)", () => {
  for (const rel of ["csm-browse/SKILL.md", `${PAYLOAD}/SKILL.md`]) {
    const text = readFileSync(resolve(ROOT, rel), "utf8");
    assert.ok(!text.includes("$HOME/.config/opencode"), `${rel} hardcodes a $HOME path`);
  }
});

test("the port allocator exposes an injectable host probe (hermetic unit seam)", () => {
  const lib = readFileSync(resolve(ROOT, "csm-browse/lib/ports.mjs"), "utf8");
  assert.match(lib, /export const hostPortProbe/);
  assert.match(lib, /hostPortProbe\.isFree\(pub\)/);
  const unit = readFileSync(resolve(ROOT, "csm-browse/tests/unit/ports.test.mjs"), "utf8");
  assert.match(unit, /setHostPortProbeForTests/);
  assert.doesNotMatch(unit, /\.listen\(92\d\d/, "ports test must not bind a fixed host port");
});

test("the shipped lib mirror is present and non-empty", () => {
  assert.ok(existsSync(resolve(ROOT, PAYLOAD, "lib/ports.mjs")));
  const port = readFileSync(resolve(ROOT, PAYLOAD, "lib/ports.mjs"), "utf8");
  assert.match(port, /hostPortProbe/);
});
