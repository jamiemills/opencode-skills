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

test("instruction-led durable artifacts use run identity and refuse terminal collisions", async () => {
  const contracts = [
    ["csm-deep-research", "research", "research.json", true],
    ["csm-make-tests", "tests", "tests-ledger.md", true],
    ["csm-plan", "plans", "csm.json", false],
    ["csm-review", "reviews", "review.json", true],
    ["csm-review-python", "doctrine", "python-doctrine-review.json", true],
  ];
  for (const [name, directory, suffix, includesRunId] of contracts) {
    const content = await skill(name);
    assert.match(content, /validated (?:immutable )?`run-id`/);
    assert.match(content, /yyyymmddthhmmssz-<12 lowercase hex>/);
    assert.match(content, /\^\[a-z0-9\]\[a-z0-9-\]\{7,63\}\$/);
    const escapedSuffix = suffix.replaceAll(".", "\\.");
    const pathPattern = includesRunId
      ? `\\.agents/${directory}/<date>-[^\\n]*<run-id>[^\\n]*${escapedSuffix}`
      : `\\.agents/${directory}/<date>-[^\\n]*${escapedSuffix}`;
    assert.match(content, new RegExp(pathPattern));
    assert.match(
      content,
      /match(?:es|ing)[^\n]*(?:owner|cursor)|owner-matching|matching ownership|ownership mismatch/,
    );
    assert.match(content, /terminal/i);
    assert.match(content, /immutable|refus/i);
    assert.match(content, /same-day[^\n]*same-slug|same-day duplicate slug/i);
    assert.match(content, /latest/);
    assert.match(
      content,
      /collision refusal|explicit collision refusal|never replaces|never overwrite/i,
    );
  }
});

test("delegated research ownership is explicit at both sides of the handoff", async () => {
  const plan = await skill("csm-plan");
  const research = await skill("csm-deep-research");
  assert.match(plan, /delegated skill owns its run-ID-suffixed/);
  assert.match(plan, /must not create, rename, delete, replace/);
  assert.match(research, /Subagents never write persistent artifacts/);
  assert.match(research, /parent `csm-plan` or `csm-grill` owns neither path/);
});
