"use strict";

// Regression: the instruction corpus must not prime budget/context-exhaustion
// talk. Context exhaustion is harness-managed (automatic compaction), not a
// model-facing stop signal; token numbers and "context budget" framing must not
// reappear in the source skill corpus.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFile(join(ROOT, rel), "utf8");

test("AGENTS.md states compaction positively and drops the limit trigger", async () => {
  const agents = await read("AGENTS.md");
  assert.ok(
    agents.includes("context is compacted automatically"),
    "expected positive compaction policy",
  );
  assert.ok(!agents.includes("When context approaches limits"), "limit trigger must be gone");
});

test("csm-review no longer carries a literal token budget", async () => {
  const review = await read("csm-review/SKILL.md");
  assert.ok(!review.includes("16k tokens"), "literal token budget must be gone");
  assert.ok(review.includes("capped at 24 chunks"), "content scoping must remain");
});

test("csm-bdd-tdd renames the budget heading to content scoping", async () => {
  const bdd = await read("csm-bdd-tdd/SKILL.md");
  assert.ok(bdd.includes("## Subagent Context Scoping"), "expected renamed heading");
  assert.ok(!bdd.includes("## Context Budget Rules"), "budget heading must be gone");
});

test("no source skill or boilerplate names context-length-exceeded", async () => {
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const skills = dirs.filter((d) => d.isDirectory() && /^csm-/.test(d.name)).map((d) => d.name);
  assert.ok(skills.length >= 14, "expected the 14 csm source skills");
  for (const skill of skills) {
    const content = await read(`${skill}/SKILL.md`);
    assert.ok(
      !content.includes("context-length-exceeded"),
      `${skill}/SKILL.md must not name context-length-exceeded`,
    );
  }
  const boilerplate = await read("scripts/lib/boilerplate.mjs");
  assert.ok(
    !boilerplate.includes("context-length-exceeded"),
    "boilerplate must not name it either",
  );
});

test("context exhaustion is stated as harness-managed", async () => {
  assert.ok((await read("scripts/lib/boilerplate.mjs")).includes("harness-managed"));
  assert.ok((await read("csm-build/SKILL.md")).includes("harness-managed"));
});
