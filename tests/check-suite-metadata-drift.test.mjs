import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkMetadataDrift } from "../scripts/check-suite.mjs";

// A metadata-mapped source (payload/lib/**) that changes without re-running
// pack-bootstrap must surface as drift. This is the T006 blind spot: only
// scripts/regen.mjs verifyPayloadParity previously caught it.
test("a metadata-mapped source change is reported as payload drift", () => {
  const root = mkdtempSync(join(tmpdir(), "csm-metadata-drift-"));
  const srcRel = join("lib", "consumer-adapters");
  const destRel = join("bootstrap", "package", "payload", "lib", "consumer-adapters");
  mkdirSync(join(root, srcRel), { recursive: true });
  mkdirSync(join(root, destRel), { recursive: true });
  writeFileSync(join(root, srcRel, "index.mjs"), "export const a = 1;\n");
  writeFileSync(join(root, destRel, "index.mjs"), "export const a = 1;\n");

  const freshDiffs = checkMetadataDrift(root).filter((issue) => issue.startsWith("DIFF"));
  assert.deepEqual(freshDiffs, [], "no drift when the payload matches the source");

  writeFileSync(join(root, srcRel, "index.mjs"), "export const a = 2;\n");
  const staleDiffs = checkMetadataDrift(root).filter((issue) => issue.startsWith("DIFF"));
  assert.ok(
    staleDiffs.some((issue) => issue.includes("payload/lib/consumer-adapters/index.mjs")),
    `expected a DIFF for the changed metadata source, got: ${JSON.stringify(staleDiffs)}`,
  );
});

test("a missing metadata payload file is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "csm-metadata-missing-"));
  const srcRel = join("lib", "consumer-adapters");
  mkdirSync(join(root, srcRel), { recursive: true });
  writeFileSync(join(root, srcRel, "index.mjs"), "export const a = 1;\n");
  const missing = checkMetadataDrift(root).filter((issue) =>
    issue.startsWith("MISSING-IN-PAYLOAD"),
  );
  assert.ok(
    missing.some((issue) => issue.includes("payload/lib/consumer-adapters/index.mjs")),
    `expected a MISSING-IN-PAYLOAD, got: ${JSON.stringify(missing)}`,
  );
});
