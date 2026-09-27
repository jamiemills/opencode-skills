import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

test("the docs do not promise a CLI-written .agents/upload receipt", () => {
  for (const rel of ["csm-upload/SKILL.md", "README.md", "scripts/lib/contracts.mjs"]) {
    const text = read(rel);
    assert.ok(
      !text.includes(".agents/upload/<date>-<run-id>-publication.json"),
      `${rel} must not promise the .agents/upload receipt path`,
    );
    assert.ok(
      !/authoritative publication receipt/i.test(text),
      `${rel} must not claim an authoritative publication receipt`,
    );
  }
});

test("csm-upload documents the Pages projection as the deliverable", () => {
  assert.match(read("csm-upload/SKILL.md"), /Pages projection|external projection/);
});
