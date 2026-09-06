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

test("wt/** worktree branches never trigger the ordinary CI pipeline on push", async () => {
  const ci = await readFile(join(workflowRoot, "ci.yml"), "utf8");
  // branches-ignore must be in YAML block form (key on its own line, list
  // items indented) so the trigger is a literal pattern list, not a flow-map
  // accident that workflows parse differently.
  assert.match(
    ci,
    /\n  push:\n(?:[ \t]*#.*\n)*    branches-ignore:\n      - ['"]wt\/\*\*['"]\n/,
    "push must carry a block-form branches-ignore for wt/**",
  );
  assert.match(ci, /\n  pull_request:\n(?!\s+branches)/, "pull_request must stay unfiltered");
  // wt/** pushes must not silently disable pull_request triggers either: the
  // pull_request key must still be present as its own top-level trigger.
  assert.match(ci, /\n  pull_request:\n/);
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
