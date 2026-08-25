import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const workflowRoot = join(root, ".github", "workflows");

test("ordinary CI triggers cannot reach a publication command", async () => {
  const ci = await readFile(join(workflowRoot, "ci.yml"), "utf8");
  assert.match(ci, /\n  push:\n/);
  assert.match(ci, /\n  pull_request:\n/);
  assert.doesNotMatch(ci, /npm\s+publish|pnpm\s+publish|yarn\s+publish|pages deploy/i);
  assert.doesNotMatch(ci, /\bpublish\b/i);
  assert.match(ci, /contents:\s*read/);
});

test("any future workflow containing publication is manually triggerable only", async () => {
  for (const name of await readdir(workflowRoot)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const content = await readFile(join(workflowRoot, name), "utf8");
    if (!/npm\s+publish|pnpm\s+publish|yarn\s+publish|pages deploy/i.test(content)) continue;
    assert.match(content, /\n  workflow_dispatch:\s*(?:#.*)?\n/);
    assert.doesNotMatch(content, /\n  push:\s*(?:#.*)?\n|\n  pull_request:\s*(?:#.*)?\n/);
  }
});
