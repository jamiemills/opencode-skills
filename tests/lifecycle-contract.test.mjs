import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

async function skill(name) {
  return readFile(join(root, name, "SKILL.md"), "utf8");
}

test("build lifecycle has explicit blocker recovery and clean review checkpoint", async () => {
  const content = await skill("csm-build");
  const normalized = content.replace(/\s+/g, " ");
  assert.match(content, /BLOCKED -> RECOVER -> VALIDATE/);
  assert.match(content, /REVIEW -> CHECKPOINT/);
  for (const field of [
    "Current CSM state",
    "Cycle",
    "Last checkpoint",
    "Last model/run",
    "Next transition",
    "Resume",
  ]) {
    const fieldPattern = new RegExp("`" + field + "`");
    assert.match(normalized, fieldPattern, `missing durable field: ${field}`);
  }
  assert.match(normalized, /task or batch, step, and artifact\/checkpoint/);
});

test("resumable test generation requires a durable cursor", async () => {
  const content = await skill("csm-make-tests");
  const normalized = content.replace(/\s+/g, " ");
  assert.match(content, /`BLOCKED` is recoverable only through `BLOCKED -> RECOVER -> VALIDATE`/);
  assert.match(content, /REVIEW -> CHECKPOINT/);
  for (const field of [
    "pinned commit",
    "scope",
    "mode",
    "current state",
    "cycle",
    "last completed artifact",
    "next transition",
  ]) {
    assert.match(normalized, new RegExp(field));
  }
});

test("intentionally non-resumable skills say so explicitly", async () => {
  const [grill, python] = await Promise.all([skill("csm-grill"), skill("csm-review-python")]);
  assert.match(grill, /intentionally non-resumable/);
  assert.match(grill, /does not claim\s+`BLOCKED -> RECOVER -> VALIDATE`/s);
  assert.match(python, /intentionally non-resumable/);
  assert.match(python, /does not claim\s+`BLOCKED -> RECOVER -> VALIDATE`/s);
});

test("deep research persists a cursor and constrains every research role by source mode", async () => {
  const content = await skill("csm-deep-research");
  const normalized = content.replace(/\s+/g, " ");
  assert.match(content, /BLOCKED -> RECOVER -> VALIDATE/);
  assert.match(content, /REVIEW -> CHECKPOINT/);
  assert.match(normalized, /Control.*durable cursor/);
  for (const role of [
    "Researchers",
    "challengers",
    "judges",
    "synthesizer",
    "verifier",
    "primary-led QUICK roles",
  ]) {
    assert.match(normalized, new RegExp(role));
  }
  assert.match(normalized, /`local` permits repository\/local docs and forbids web retrieval/);
  assert.match(normalized, /`web` permits web sources and forbids repository reads/);
  assert.match(normalized, /Browser retrieval is a web mechanism and is forbidden in `local` mode/);
});
