import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// T007: the durable build-state corpus under .agents/builds must be part of the
// validated corpus, not a blind spot. Previously only .agents/plans and
// .agents/csm-build-state were enumerated.
test("the corpus gate validates .agents/builds records", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-corpus-v2.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `validator failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    /\.agents\/builds\/2026-08-28-all-skills-config-production-assurance-build\.json/,
    "the .agents/builds record must appear in the validated corpus",
  );
  assert.match(result.stdout, /validate-corpus-v2: \d+ records, 0 failures/);
});
