"use strict";

// T008/N2: wire the Anthropic id-mapping staleness guard into the suite so a
// stale mapping fails CI instead of only failing on manual invocation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-anthropic-mapping.mjs", import.meta.url));

test("T008: the Anthropic id-mapping guard reports a dated, gate-free mapping", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /re-verified/i);
  assert.match(result.stdout, /no pinned version/i);
});
